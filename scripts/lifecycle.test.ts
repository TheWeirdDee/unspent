// Tests for the API request lifecycle with stand-ins for the chain, the model and the database (no network, no keys).
// Run: bun test scripts/lifecycle.test.ts
import { describe, expect, test } from "bun:test";
import type { Hex } from "viem";
import { ApiError } from "../server/errors";
import { OUTPUT_TTL_MS, OutputCache, reconcileAll, reconcileRecord, runExecute, submitReservation, submitSettlement, type ExecDeps, type ReconcileDeps } from "../server/lifecycle";
import type { RequestRecord } from "../server/store";

const C = "0xE306b8ae6e958F7C8e3401f1f12d550E5DAecab6";
const H = ("0x" + "11".repeat(32)) as Hex;
const RH = ("0x" + "22".repeat(32)) as Hex;
const RESP = ("0x" + "33".repeat(32)) as Hex;
const TX1 = ("0x" + "aa".repeat(32)) as Hex;
const NOW = 1_800_000_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 0;

const mkRec = (over: Partial<RequestRecord> = {}): RequestRecord => ({
  requestId: `req_${++seq}`, accessTokenHash: "x", providerId: "1", customer: C, inputHash: H, requestHash: RH, maxAmount: "100000", nonce: "1",
  authDeadline: NOW, expiry: NOW + 1200, state: "reserved", reservationId: "1", createdAt: 0, updatedAt: 0, ...over,
});

const memStore = (opts: { failDurable?: boolean } = {}) => {
  const recs = new Map<string, RequestRecord>();
  const log: string[] = [];
  const fail = { on: opts.failDurable ?? false };
  return {
    log, fail,
    put: (r: RequestRecord) => { recs.set(r.requestId, r); },
    putDurable: async (r: RequestRecord) => { if (fail.on) throw new Error("db down"); recs.set(r.requestId, r); log.push(`${r.state}${r.pendingTx ? "+tx" : ""}`); },
    all: () => [...recs.values()],
    usageToday: () => ({ global: 0, customer: 0 }),
    bumpUsage: async () => {},
  };
};

const open = { statusName: "Reserved", customer: C, providerId: 1n, maxAmount: 100000n, requestHash: RH, expiry: BigInt(NOW + 1200) };
const execDeps = (store: ReturnType<typeof memStore>, over: Partial<ExecDeps> = {}) => {
  const calls = { model: 0 };
  const deps: ExecDeps = {
    store, cache: new OutputCache(), inputHashOf: () => H, responseHashOf: () => RESP,
    readReservation: async () => { await sleep(15); return open; },
    chainNow: async () => { await sleep(15); return NOW; },
    summarise: async () => { calls.model++; await sleep(30); return { output: `- result ${calls.model}`, model: "stub", latencyMs: 30 }; },
    errorCodeOf: () => "MODEL_UNAVAILABLE",
    limits: { dailyGlobal: 100, dailyPerCustomer: 10, executeSafetyMarginSec: 60 },
    ...over,
  };
  return { deps, calls };
};

describe("execution runs the model once per reservation", () => {
  test("two concurrent calls: one runs, the other is told it is in progress", async () => {
    const store = memStore(); const { deps, calls } = execDeps(store); const rec = mkRec();
    const [a, b] = await Promise.allSettled([runExecute(rec, "t", deps), runExecute(rec, "t", deps)]);
    expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = (a.status === "rejected" ? a : b) as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ApiError);
    expect((rejected.reason as ApiError).status).toBe(409);
    expect((rejected.reason as ApiError).code).toBe("IN_PROGRESS");
    expect(calls.model).toBe(1);
    expect(rec.state).toBe("delivered");
  });
  test("ten concurrent calls still make exactly one model call and the same output is served afterwards", async () => {
    const store = memStore(); const { deps, calls } = execDeps(store); const rec = mkRec();
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => runExecute(rec, "t", deps)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(calls.model).toBe(1);
    const again = await runExecute(rec, "t", deps);
    expect(again.replay).toBe(true);
    expect(again.output).toBe("- result 1");
    expect(calls.model).toBe(1);
  });
  test("a failed model call is not silently repeated", async () => {
    const store = memStore(); const { deps, calls } = execDeps(store, { summarise: async () => { await sleep(5); throw new Error("quota"); } }); const rec = mkRec();
    await expect(runExecute(rec, "t", deps)).rejects.toMatchObject({ status: 502 });
    expect(rec.state).toBe("service_failed");
    await expect(runExecute(rec, "t", deps)).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(calls.model).toBe(0);
  });
  test("if the intent cannot be recorded durably the model is never called and the claim is released", async () => {
    const store = memStore({ failDurable: true }); const { deps, calls } = execDeps(store); const rec = mkRec();
    await expect(runExecute(rec, "t", deps)).rejects.toMatchObject({ status: 503, code: "STORAGE_UNAVAILABLE" });
    expect(calls.model).toBe(0);
    expect(rec.state).toBe("reserved");
    store.fail.on = false;
    const ok = await runExecute(rec, "t", deps); // the lock was released, so a retry works
    expect(ok.replay).toBe(false);
    expect(calls.model).toBe(1);
  });
  test("the intent is recorded as executing BEFORE the model is called", async () => {
    const store = memStore();
    const seen: string[] = [];
    const { deps } = execDeps(store, { summarise: async () => { seen.push(store.log.join(",")); return { output: "- x", model: "stub", latencyMs: 1 }; } });
    await runExecute(mkRec(), "t", deps);
    expect(seen[0]).toBe("executing");
  });
  test("a reservation that is not open stops execution and releases the claim", async () => {
    const store = memStore(); const { deps, calls } = execDeps(store, { readReservation: async () => ({ ...open, statusName: "Settled" }) }); const rec = mkRec();
    await expect(runExecute(rec, "t", deps)).rejects.toMatchObject({ code: "ALREADY_SETTLED" });
    await expect(runExecute(rec, "t", deps)).rejects.toMatchObject({ code: "ALREADY_SETTLED" }); // not stuck as IN_PROGRESS
    expect(calls.model).toBe(0);
  });
  test("a mismatched onchain reservation is refused", async () => {
    const store = memStore(); const { deps, calls } = execDeps(store, { readReservation: async () => ({ ...open, requestHash: "0x" + "99".repeat(32) }) });
    await expect(runExecute(mkRec(), "t", deps)).rejects.toMatchObject({ code: "RESERVATION_MISMATCH" });
    expect(calls.model).toBe(0);
  });
});

describe("output retention is a strict limit enforced on read", () => {
  test("served inside the window, gone after it, even if nothing else happened in between", () => {
    let t = 1_000_000;
    const cache = new OutputCache(() => t);
    cache.set("a", "text");
    t += OUTPUT_TTL_MS - 1000;
    expect(cache.get("a")).toBe("text");
    t += 2000;
    expect(cache.get("a")).toBeUndefined();
  });
  test("a replay after expiry says the output is unavailable and does not call the model", async () => {
    let t = 5_000_000;
    const store = memStore(); const { deps, calls } = execDeps(store, { cache: new OutputCache(() => t) }); const rec = mkRec();
    await runExecute(rec, "t", deps);
    t += OUTPUT_TTL_MS + 1;
    await expect(runExecute(rec, "t", deps)).rejects.toMatchObject({ status: 410, code: "OUTPUT_UNAVAILABLE" });
    expect(calls.model).toBe(1);
  });
  test("a delivered record with no cached output (restart) is reported honestly, not as an empty success", async () => {
    const store = memStore(); const { deps } = execDeps(store);
    await expect(runExecute(mkRec({ state: "delivered", responseHash: RESP }), "t", deps)).rejects.toMatchObject({ status: 410 });
  });
});

describe("relayer submissions record intent first and the hash on broadcast", () => {
  const relayOk = (store: ReturnType<typeof memStore>, seenBefore: string[]) => async (_fn: string, _args: readonly unknown[], opts: { onBroadcast: (h: Hex) => Promise<void> }) => {
    seenBefore.push(store.log.join(","));
    await opts.onBroadcast(TX1);
    return { hash: TX1, logs: [{ eventName: "UsageReserved", args: { reservationId: 7n } }] };
  };
  test("reservation: 'reserving' is durable before the relay, the hash is durable before confirmation", async () => {
    const store = memStore(); const seen: string[] = []; const rec = mkRec({ state: "quoted", reservationId: undefined });
    await submitReservation(rec, {}, "0x00", { store, relay: relayOk(store, seen) });
    expect(seen[0]).toBe("reserving");
    expect(store.log).toEqual(["reserving", "reserving+tx"]);
    expect(rec.state).toBe("reserved");
    expect(rec.reservationId).toBe("7");
    expect(rec.reserveTx).toBe(TX1);
    expect(rec.pendingTx).toBeUndefined();
  });
  test("reservation: a confirmation timeout keeps the record 'reserving' with its hash instead of marking it failed", async () => {
    const store = memStore(); const rec = mkRec({ state: "quoted", reservationId: undefined });
    const relay = async (_f: string, _a: readonly unknown[], opts: { onBroadcast: (h: Hex) => Promise<void> }) => { await opts.onBroadcast(TX1); throw new ApiError(504, "TX_PENDING", "pending", { txHash: TX1 }); };
    await expect(submitReservation(rec, {}, "0x00", { store, relay })).rejects.toMatchObject({ code: "TX_PENDING" });
    expect(rec.state).toBe("reserving");
    expect(rec.pendingTx).toBe(TX1);
    expect(store.log).toContain("reserving+tx");
  });
  test("reservation: a failure before broadcast is final", async () => {
    const store = memStore(); const rec = mkRec({ state: "quoted", reservationId: undefined });
    const relay = async () => { throw new ApiError(409, "INSUFFICIENT_AVAILABLE", "no credits"); };
    await expect(submitReservation(rec, {}, "0x00", { store, relay })).rejects.toMatchObject({ code: "INSUFFICIENT_AVAILABLE" });
    expect(rec.state).toBe("failed_before_service");
  });
  test("reservation: if the intent cannot be recorded, nothing is broadcast", async () => {
    const store = memStore({ failDurable: true }); let called = false; const rec = mkRec({ state: "quoted", reservationId: undefined });
    const relay = async () => { called = true; return { hash: TX1, logs: [] }; };
    await expect(submitReservation(rec, {}, "0x00", { store, relay })).rejects.toMatchObject({ status: 503 });
    expect(called).toBe(false);
  });
  test("settlement: timeout keeps 'settling' with the hash; a clean failure returns to 'delivered'", async () => {
    const store = memStore(); const rec = mkRec({ state: "delivered", responseHash: RESP });
    const pend = async (_f: string, _a: readonly unknown[], opts: { onBroadcast: (h: Hex) => Promise<void> }) => { await opts.onBroadcast(TX1); throw new ApiError(504, "TX_PENDING", "pending"); };
    await expect(submitSettlement(rec, {}, "0x00", { store, relay: pend })).rejects.toMatchObject({ code: "TX_PENDING" });
    expect(rec.state).toBe("settling");
    expect(rec.pendingTx).toBe(TX1);
    const rec2 = mkRec({ state: "delivered", responseHash: RESP });
    await expect(submitSettlement(rec2, {}, "0x00", { store, relay: async () => { throw new ApiError(409, "RESERVATION_EXPIRED", "late"); } })).rejects.toMatchObject({ code: "RESERVATION_EXPIRED" });
    expect(rec2.state).toBe("delivered");
  });
});

describe("interrupted records are reconciled with the chain", () => {
  const deps = (over: Partial<ReconcileDeps> = {}, store = memStore()): ReconcileDeps => ({
    store, receiptOf: async () => null, readReservation: async () => ({ statusName: "Reserved" }), findReserved: async () => null, ...over,
  });
  test("executing at restart becomes service_failed (EXECUTION_INTERRUPTED); the paid call is not repeated", async () => {
    const rec = mkRec({ state: "executing" });
    expect(await reconcileRecord(rec, deps())).toBe(true);
    expect(rec.state).toBe("service_failed");
    expect(rec.errorCode).toBe("EXECUTION_INTERRUPTED");
  });
  test("reserving with a recorded hash and a successful receipt becomes reserved", async () => {
    const rec = mkRec({ state: "reserving", pendingTx: TX1, reservationId: undefined });
    await reconcileRecord(rec, deps({ receiptOf: async () => ({ status: "success", logs: [{ eventName: "UsageReserved", args: { reservationId: 9n } }] }) }));
    expect(rec.state).toBe("reserved");
    expect(rec.reservationId).toBe("9");
    expect(rec.reserveTx).toBe(TX1);
    expect(rec.pendingTx).toBeUndefined();
  });
  test("reserving with a reverted receipt fails; with no receipt yet it is left alone", async () => {
    const a = mkRec({ state: "reserving", pendingTx: TX1 });
    await reconcileRecord(a, deps({ receiptOf: async () => ({ status: "reverted", logs: [] }) }));
    expect(a.state).toBe("failed_before_service");
    const b = mkRec({ state: "reserving", pendingTx: TX1 });
    expect(await reconcileRecord(b, deps())).toBe(false);
    expect(b.state).toBe("reserving");
  });
  test("reserving with no recorded hash: found onchain -> reserved; not found -> failed (interrupted before broadcast)", async () => {
    const found = mkRec({ state: "reserving", reservationId: undefined });
    await reconcileRecord(found, deps({ findReserved: async () => ({ reservationId: "4", txHash: TX1 }) }));
    expect(found.state).toBe("reserved");
    expect(found.reservationId).toBe("4");
    const none = mkRec({ state: "reserving", reservationId: undefined });
    await reconcileRecord(none, deps());
    expect(none.state).toBe("failed_before_service");
    expect(none.errorCode).toBe("INTERRUPTED_BEFORE_BROADCAST");
  });
  test("settling: successful receipt -> settled; reverted -> delivered; no hash -> follows the contract", async () => {
    const ok = mkRec({ state: "settling", pendingTx: TX1 });
    await reconcileRecord(ok, deps({ receiptOf: async () => ({ status: "success", logs: [] }) }));
    expect(ok.state).toBe("settled");
    expect(ok.settleTx).toBe(TX1);
    const bad = mkRec({ state: "settling", pendingTx: TX1 });
    await reconcileRecord(bad, deps({ receiptOf: async () => ({ status: "reverted", logs: [] }) }));
    expect(bad.state).toBe("delivered");
    const settledOnchain = mkRec({ state: "settling" });
    await reconcileRecord(settledOnchain, deps({ readReservation: async () => ({ statusName: "Settled" }) }));
    expect(settledOnchain.state).toBe("settled");
    const notSettled = mkRec({ state: "settling" });
    await reconcileRecord(notSettled, deps({ readReservation: async () => ({ statusName: "Reserved" }) }));
    expect(notSettled.state).toBe("delivered");
  });
  test("settled, delivered and other final records are untouched", async () => {
    for (const state of ["quoted", "reserved", "delivered", "settled", "service_failed", "failed_before_service"] as const) {
      const rec = mkRec({ state });
      expect(await reconcileRecord(rec, deps())).toBe(false);
      expect(rec.state).toBe(state);
    }
  });
  test("reconcileAll visits only transitional records, counts changes and survives a failing record", async () => {
    const store = memStore();
    const recs = [mkRec({ state: "executing" }), mkRec({ state: "delivered" }), mkRec({ state: "reserving", pendingTx: TX1 }), mkRec({ state: "settling" })];
    for (const r of recs) store.put(r);
    const d = deps({ receiptOf: async () => { throw new Error("rpc down"); }, readReservation: async () => ({ statusName: "Settled" }) }, store);
    const out = await reconcileAll(d);
    expect(out.checked).toBe(3);
    expect(out.changed).toBe(2); // executing -> service_failed, settling -> settled; the reserving record is retried later
    expect(recs[2].state).toBe("reserving");
  });
});
