// Request lifecycle for the sample API: execution (one model call per reservation), relayer submissions whose hash is
// persisted the moment it is broadcast, and reconciliation of interrupted records. Dependencies are injected so the
// behaviour can be tested without a chain, a model or a database. Financial truth is always the contract; this file only
// decides what the non-authoritative service record says and never re-runs paid work silently.
import type { Hex } from "viem";
import { ApiError } from "./errors";
import type { RequestRecord } from "./store";

// ---- output retention: in memory only, a strict 30-minute limit enforced on every read, lost on restart ----
export const OUTPUT_TTL_MS = 30 * 60_000;
export class OutputCache {
  private m = new Map<string, { output: string; at: number }>();
  constructor(private now: () => number = Date.now) {}
  set(id: string, output: string) {
    this.sweep();
    this.m.set(id, { output, at: this.now() });
  }
  get(id: string): string | undefined {
    const v = this.m.get(id);
    if (!v) return undefined;
    if (this.now() - v.at > OUTPUT_TTL_MS) {
      this.m.delete(id);
      return undefined;
    }
    return v.output;
  }
  sweep() {
    for (const [k, v] of this.m) if (this.now() - v.at > OUTPUT_TTL_MS) this.m.delete(k);
  }
}

export interface LifecycleStore {
  put(r: RequestRecord): void;
  /** Resolves only after the write has been acknowledged; rejects if it failed. */
  putDurable(r: RequestRecord): Promise<void>;
  all(): RequestRecord[];
  usageToday(customer: string): { global: number; customer: number };
  bumpUsage(customer: string): Promise<void>;
}

const durable = async (store: LifecycleStore, rec: RequestRecord) => {
  try {
    await store.putDurable(rec);
  } catch (e) {
    console.error("state write failed:", (e as Error).message);
    throw new ApiError(503, "STORAGE_UNAVAILABLE", "The service could not record this step durably, so it was not performed. Nothing was charged.");
  }
};

// ---- execution: at most one model call per reservation ----
export interface ExecDeps {
  store: LifecycleStore;
  cache: OutputCache;
  inputHashOf(text: string): string;
  responseHashOf(output: string): Hex;
  readReservation(id: bigint): Promise<{ statusName: string; customer: string; providerId: bigint; maxAmount: bigint; requestHash: string; expiry: bigint }>;
  chainNow(): Promise<number>;
  summarise(text: string): Promise<{ output: string; model: string; latencyMs: number }>;
  errorCodeOf(e: unknown): string;
  limits: { dailyGlobal: number; dailyPerCustomer: number; executeSafetyMarginSec: number };
}

/** Process-local claim set. A single API instance is the supported deployment; see docs/hosting.md. */
const inflight = new Set<string>();

export async function runExecute(rec: RequestRecord, text: string, d: ExecDeps): Promise<{ output: string; replay: boolean }> {
  if (rec.state === "delivered" || rec.state === "settling" || rec.state === "settled") {
    const output = d.cache.get(rec.requestId);
    if (output === undefined) {
      throw new ApiError(410, "OUTPUT_UNAVAILABLE", "This response is no longer retained (it is kept in memory for 30 minutes and cleared on restart). Nothing was charged for it; if you already hold the text and its hash you can still accept it, otherwise release the reservation after it expires.");
    }
    return { output, replay: true };
  }
  if (rec.state === "executing" || inflight.has(rec.requestId)) throw new ApiError(409, "IN_PROGRESS", "This request is already executing. Poll its status instead of calling again.");
  if (rec.state !== "reserved") throw new ApiError(409, "INVALID_STATE", `Request is ${rec.state}; a reservation must be confirmed first`);
  if (!rec.reservationId) throw new ApiError(409, "INVALID_STATE", "No reservation");

  // Claim synchronously: nothing awaits between the state check above and this line, so a concurrent call cannot pass the check.
  inflight.add(rec.requestId);
  try {
    if (d.inputHashOf(text) !== rec.inputHash) throw new ApiError(400, "INPUT_MISMATCH", "Text does not match the quoted input hash");
    // Execute only if the CONTRACT confirms an open reservation matching this exact request.
    const r = await d.readReservation(BigInt(rec.reservationId));
    const now = await d.chainNow();
    if (r.statusName !== "Reserved") throw new ApiError(409, r.statusName === "Settled" ? "ALREADY_SETTLED" : "RESERVATION_NOT_OPEN", `Reservation is ${r.statusName}`);
    if (r.customer.toLowerCase() !== rec.customer.toLowerCase() || r.providerId.toString() !== rec.providerId || r.maxAmount.toString() !== rec.maxAmount || r.requestHash !== rec.requestHash) {
      throw new ApiError(409, "RESERVATION_MISMATCH", "Onchain reservation does not match the quoted request");
    }
    if (now + d.limits.executeSafetyMarginSec >= Number(r.expiry)) throw new ApiError(409, "RESERVATION_EXPIRED", "Too little time remains before the reservation expires");
    const use = d.store.usageToday(rec.customer);
    if (use.global >= d.limits.dailyGlobal || use.customer >= d.limits.dailyPerCustomer) {
      throw new ApiError(429, "BUDGET_EXHAUSTED", "Sample model budget exhausted for today. Your reserved credit stays safe and is releasable after expiry.");
    }

    // The intent is recorded durably BEFORE the paid model call, so a crash cannot leave an unrecorded call.
    rec.state = "executing";
    try {
      await durable(d.store, rec);
      await d.store.bumpUsage(rec.customer); // counted before the call: a verified reservation is never charged to a second model call
    } catch (e) {
      rec.state = "reserved";
      throw e;
    }
    try {
      const out = await d.summarise(text);
      rec.responseHash = d.responseHashOf(out.output);
      rec.serviceModel = out.model;
      rec.latencyMs = out.latencyMs;
      rec.state = "delivered";
      d.cache.set(rec.requestId, out.output);
      d.store.put(rec);
      return { output: out.output, replay: false };
    } catch (e) {
      rec.state = "service_failed";
      rec.errorCode = d.errorCodeOf(e);
      d.store.put(rec);
      throw new ApiError(502, rec.errorCode, `No completed result: ${(e as Error).message}. Your reserved credit stays reserved until it expires, then you can release it.`, { requestId: rec.requestId, reservationId: rec.reservationId, expiry: rec.expiry });
    }
  } finally {
    inflight.delete(rec.requestId);
  }
}

// ---- relayer submissions: record intent first, record the hash the moment it is broadcast ----
export interface RelayResult { hash: Hex; logs: { eventName?: string; args?: Record<string, unknown> }[] }
export interface SubmitDeps {
  store: LifecycleStore;
  relay(fn: "reserveWithSignature" | "acceptAndSettle", args: readonly unknown[], opts: { onBroadcast: (hash: Hex) => Promise<void> }): Promise<RelayResult>;
}

export async function submitReservation(rec: RequestRecord, message: unknown, signature: Hex, d: SubmitDeps): Promise<void> {
  rec.state = "reserving";
  rec.pendingTx = undefined;
  await durable(d.store, rec); // intent first: nothing is broadcast if this cannot be recorded
  try {
    const { hash, logs } = await d.relay("reserveWithSignature", [message, signature], { onBroadcast: async (h) => { rec.pendingTx = h; await d.store.putDurable(rec); } });
    const ev = logs.find((l) => l.eventName === "UsageReserved");
    if (!ev?.args) throw new ApiError(502, "TX_REVERTED", "UsageReserved event missing");
    rec.reservationId = String(ev.args.reservationId);
    rec.reserveTx = hash;
    rec.pendingTx = undefined;
    rec.state = "reserved";
    d.store.put(rec);
  } catch (e) {
    if (e instanceof ApiError && e.code === "TX_PENDING") throw e; // submitted, outcome not yet seen: stays "reserving" with its hash; reconcile later
    rec.state = "failed_before_service";
    rec.errorCode = e instanceof ApiError ? e.code : "UNKNOWN";
    d.store.put(rec);
    throw e;
  }
}

export async function submitSettlement(rec: RequestRecord, message: unknown, signature: Hex, d: SubmitDeps): Promise<void> {
  rec.state = "settling";
  rec.pendingTx = undefined;
  await durable(d.store, rec);
  try {
    const { hash } = await d.relay("acceptAndSettle", [message, signature], { onBroadcast: async (h) => { rec.pendingTx = h; await d.store.putDurable(rec); } });
    rec.settleTx = hash;
    rec.pendingTx = undefined;
    rec.state = "settled";
    d.store.put(rec);
  } catch (e) {
    if (e instanceof ApiError && e.code === "TX_PENDING") throw e;
    rec.state = "delivered"; // still deliverable: the same signed acceptance can be retried while valid
    d.store.put(rec);
    throw e;
  }
}

// ---- reconciliation of records left in a transitional state (restart, receipt timeout) ----
export interface ReconcileDeps {
  store: LifecycleStore;
  receiptOf(hash: Hex): Promise<{ status: string; logs: { eventName?: string; args?: Record<string, unknown> }[] } | null>;
  readReservation(id: bigint): Promise<{ statusName: string }>;
  findReserved(customer: string, requestHash: string): Promise<{ reservationId: string; txHash: Hex } | null>;
}

/** Brings one transitional record in line with the chain. Returns true if it changed. Never calls the model or the relayer. */
export async function reconcileRecord(rec: RequestRecord, d: ReconcileDeps): Promise<boolean> {
  const before = rec.state;
  if (rec.state === "executing") {
    // The model call was in flight when the process stopped; its result is gone and a paid call is never silently repeated.
    rec.state = "service_failed";
    rec.errorCode = "EXECUTION_INTERRUPTED";
  } else if (rec.state === "reserving") {
    if (rec.pendingTx) {
      const rc = await d.receiptOf(rec.pendingTx);
      if (!rc) return false; // not seen yet
      if (rc.status === "success") {
        const ev = rc.logs.find((l) => l.eventName === "UsageReserved");
        if (ev?.args) {
          rec.reservationId = String(ev.args.reservationId);
          rec.reserveTx = rec.pendingTx;
          rec.state = "reserved";
        } else {
          rec.state = "failed_before_service";
          rec.errorCode = "TX_NO_RESERVATION";
        }
      } else {
        rec.state = "failed_before_service";
        rec.errorCode = "TX_REVERTED";
      }
      rec.pendingTx = undefined;
    } else {
      const hit = await d.findReserved(rec.customer, rec.requestHash);
      if (hit) {
        rec.reservationId = hit.reservationId;
        rec.reserveTx = hit.txHash;
        rec.state = "reserved";
      } else {
        rec.state = "failed_before_service";
        rec.errorCode = "INTERRUPTED_BEFORE_BROADCAST";
      }
    }
  } else if (rec.state === "settling") {
    if (rec.pendingTx) {
      const rc = await d.receiptOf(rec.pendingTx);
      if (!rc) return false;
      if (rc.status === "success") {
        rec.settleTx = rec.pendingTx;
        rec.state = "settled";
      } else {
        rec.state = "delivered";
      }
      rec.pendingTx = undefined;
    } else if (rec.reservationId) {
      const r = await d.readReservation(BigInt(rec.reservationId));
      rec.state = r.statusName === "Settled" ? "settled" : "delivered";
    } else {
      rec.state = "delivered";
    }
  }
  if (rec.state === before) return false;
  await d.store.putDurable(rec);
  return true;
}

export async function reconcileAll(d: ReconcileDeps): Promise<{ checked: number; changed: number }> {
  let checked = 0;
  let changed = 0;
  for (const rec of d.store.all()) {
    if (rec.state !== "executing" && rec.state !== "reserving" && rec.state !== "settling") continue;
    checked++;
    try {
      if (await reconcileRecord(rec, d)) changed++;
    } catch (e) {
      console.error(`reconcile ${rec.requestId} failed:`, (e as Error).message); // left as is; retried on the next status read
    }
  }
  return { checked, changed };
}
