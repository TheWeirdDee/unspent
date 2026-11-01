import type { Address, Hex } from "viem";
import { getAbiItem } from "viem";
import { unspentVaultAbi } from "@/contracts/abi";
import { dep, publicClient, VAULT } from "@/lib/chains";

export type ActivityKind = "deposit" | "reserve" | "settle" | "release" | "refund";
export interface ActivityEvent {
  kind: ActivityKind;
  providerId: bigint;
  customer: Address;
  amount: bigint;
  reservationId?: bigint;
  requestHash?: Hex;
  responseHash?: Hex;
  expiry?: bigint;
  payoutWallet?: Address;
  txHash: Hex;
  blockNumber: bigint;
  logIndex: number;
  timestamp?: number;
}

const ev = (name: "CreditsDeposited" | "UsageReserved" | "UsageSettled" | "ReservationReleased" | "CreditsRefunded") =>
  getAbiItem({ abi: unspentVaultAbi, name });
const EVENTS = [ev("CreditsDeposited"), ev("UsageReserved"), ev("UsageSettled"), ev("ReservationReleased"), ev("CreditsRefunded")] as const;

interface RawLog { eventName: string; args: Record<string, unknown>; transactionHash: Hex; blockNumber: bigint; logIndex: number }

let chunk = 20_000n;

/**
 * Reads vault logs straight from the RPC, oldest block = the contract deployment block (never genesis).
 * Ordered by (blockNumber, logIndex), newest first.
 */
type ActivityResult = { events: ActivityEvent[]; head: bigint; fromBlock: bigint };
// The first call walks from the deployment block; later calls read only blocks not yet scanned, and
// concurrent callers share one in-flight scan. Keeps public-RPC traffic low (the RPC rate-limits).
const cache: { events: ActivityEvent[]; next: bigint | null } = { events: [], next: null };
let inflight: Promise<ActivityResult> | null = null;

export function fetchVaultActivity(): Promise<ActivityResult> {
  inflight ??= scanVault().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function scanVault(): Promise<ActivityResult> {
  if (!VAULT || !dep.deploymentBlock) return { events: [], head: 0n, fromBlock: 0n };
  const head = await publicClient.getBlockNumber();
  const fromBlock = BigInt(dep.deploymentBlock);
  const out: ActivityEvent[] = cache.events;
  let start = cache.next ?? fromBlock;
  while (start <= head) {
    const end = start + chunk - 1n > head ? head : start + chunk - 1n;
    let logs: RawLog[];
    try {
      logs = (await publicClient.getLogs({ address: VAULT, events: EVENTS, fromBlock: start, toBlock: end })) as unknown as RawLog[];
    } catch (e) {
      if (chunk > 1_000n) {
        chunk = chunk / 2n; // RPC rejected the range: shrink and retry this window
        continue;
      }
      throw e;
    }
    for (const l of logs) {
      const a = l.args;
      const base = { providerId: a.providerId as bigint, customer: a.customer as Address, txHash: l.transactionHash, blockNumber: l.blockNumber, logIndex: l.logIndex };
      switch (l.eventName) {
        case "CreditsDeposited": out.push({ ...base, kind: "deposit", amount: a.amount as bigint }); break;
        case "UsageReserved": out.push({ ...base, kind: "reserve", amount: a.amount as bigint, reservationId: a.reservationId as bigint, requestHash: a.requestHash as Hex, expiry: a.expiry as bigint }); break;
        case "UsageSettled": out.push({ ...base, kind: "settle", amount: a.amount as bigint, reservationId: a.reservationId as bigint, responseHash: a.responseHash as Hex, payoutWallet: a.payoutWallet as Address }); break;
        case "ReservationReleased": out.push({ ...base, kind: "release", amount: a.amount as bigint, reservationId: a.reservationId as bigint }); break;
        case "CreditsRefunded": out.push({ ...base, kind: "refund", amount: a.amount as bigint }); break;
      }
    }
    start = end + 1n;
    cache.next = start;
  }
  out.sort((x, y) => (x.blockNumber === y.blockNumber ? y.logIndex - x.logIndex : x.blockNumber < y.blockNumber ? 1 : -1));
  return { events: [...out], head, fromBlock };
}

const stampCache = new Map<bigint, number>();

export async function withTimestamps(events: ActivityEvent[], limit = 60): Promise<ActivityEvent[]> {
  const blocks = [...new Set(events.slice(0, limit).map((e) => e.blockNumber))];
  const stamps = stampCache;
  await Promise.all(
    blocks.filter((b) => !stamps.has(b)).map(async (b) => {
      try {
        stamps.set(b, Number((await publicClient.getBlock({ blockNumber: b })).timestamp));
      } catch {
        /* timestamp is convenience only */
      }
    }),
  );
  return events.map((e) => ({ ...e, timestamp: stamps.get(e.blockNumber) }));
}

export interface OpenReservation { reservationId: bigint; providerId: bigint; amount: bigint; expiry: bigint; requestHash: Hex; txHash: Hex }

/** Reservations that have neither settled nor released in the event history. */
export function openReservations(events: ActivityEvent[]): OpenReservation[] {
  const closed = new Set(events.filter((e) => e.kind === "settle" || e.kind === "release").map((e) => e.reservationId!.toString()));
  return events
    .filter((e) => e.kind === "reserve" && !closed.has(e.reservationId!.toString()))
    .map((e) => ({ reservationId: e.reservationId!, providerId: e.providerId, amount: e.amount, expiry: e.expiry!, requestHash: e.requestHash!, txHash: e.txHash }));
}
