import { parseEventLogs, type Address, type Hex } from "viem";
import { unspentVaultAbi } from "../src/contracts/abi";
import { RESERVATION_STATUS } from "../src/lib/protocol";
import { publicClient, relayerClient, relayerAccount, VAULT } from "./config";
import { ApiError } from "./errors";

export function requireVault(): Address {
  if (!VAULT) throw new ApiError(503, "NOT_DEPLOYED", "No vault is configured for this network");
  return VAULT;
}

export { ApiError };

let queue: Promise<unknown> = Promise.resolve();
/** Serialises relayer transactions so nonces never collide. */
export function relayed<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

export async function readReservation(id: bigint) {
  const r = await publicClient.readContract({ address: requireVault(), abi: unspentVaultAbi, functionName: "getReservation", args: [id] });
  return { ...r, statusName: RESERVATION_STATUS[r.status] };
}

export async function readProvider(id: bigint) {
  return publicClient.readContract({ address: requireVault(), abi: unspentVaultAbi, functionName: "getProvider", args: [id] });
}

export async function chainNow(): Promise<number> {
  const b = await publicClient.getBlock();
  return Number(b.timestamp);
}

/** Simulates then submits a relayer transaction, waits for the receipt, and maps reverts to API errors. */
export async function relay(functionName: "reserveWithSignature" | "acceptAndSettle", args: readonly unknown[], opts: { onBroadcast?: (hash: Hex) => Promise<void> } = {}) {
  const wallet = relayerClient;
  const account = relayerAccount;
  if (!wallet || !account) throw new ApiError(503, "RELAYER_UNAVAILABLE", "Relayer key is not configured");
  return relayed(async () => {
    let hash: Hex;
    try {
      const { request } = await publicClient.simulateContract({
        address: requireVault(),
        abi: unspentVaultAbi,
        functionName,
        args: args as never,
        account,
      });
      hash = await wallet.writeContract(request);
    } catch (e) {
      throw mapRevert(e);
    }
    // The hash is recorded the moment the transaction is broadcast, before anything waits on it.
    try {
      await opts.onBroadcast?.(hash);
    } catch (e) {
      console.error("could not record the broadcast hash durably:", (e as Error).message); // the transaction is already sent
    }
    let receipt;
    try {
      receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    } catch {
      throw new ApiError(504, "TX_PENDING", "The transaction was submitted but its confirmation has not been seen yet. Check its status in a moment; do not sign again.", { txHash: hash });
    }
    if (receipt.status !== "success") throw new ApiError(502, "TX_REVERTED", "Transaction reverted onchain", { txHash: hash });
    return { hash, receipt, logs: parseEventLogs({ abi: unspentVaultAbi, logs: receipt.logs }) };
  });
}

/** Receipt of a previously broadcast transaction, or null if it is not (yet) visible. */
export async function receiptOf(hash: Hex) {
  try {
    const r = await publicClient.getTransactionReceipt({ hash });
    return { status: r.status as string, logs: parseEventLogs({ abi: unspentVaultAbi, logs: r.logs }) as { eventName?: string; args?: Record<string, unknown> }[] };
  } catch {
    return null;
  }
}

/** Finds the reservation (if any) created for this customer and request hash within the last ~9,000 blocks. */
export async function findReservedByRequest(customer: Address, requestHash: Hex): Promise<{ reservationId: string; txHash: Hex } | null> {
  const head = await publicClient.getBlockNumber();
  const logs = await publicClient.getContractEvents({ address: requireVault(), abi: unspentVaultAbi, eventName: "UsageReserved", args: { customer }, fromBlock: head > 9000n ? head - 9000n : 0n, toBlock: head });
  const hit = logs.find((l) => l.args.requestHash?.toLowerCase() === requestHash.toLowerCase());
  return hit && hit.args.reservationId !== undefined ? { reservationId: hit.args.reservationId.toString(), txHash: hit.transactionHash } : null;
}

const REVERT_CODES: Record<string, [number, string]> = {
  InsufficientAvailable: [409, "INSUFFICIENT_AVAILABLE"],
  AuthorisationExpired: [409, "RESERVATION_EXPIRED"],
  ReservationExpired: [409, "RESERVATION_EXPIRED"],
  AcceptanceExpired: [409, "RESERVATION_EXPIRED"],
  InvalidSignature: [400, "INVALID_SIGNATURE"],
  ProviderInactive: [409, "PROVIDER_INACTIVE"],
  PayoutConfigMismatch: [409, "PAYOUT_CONFIG_CHANGED"],
  ReservationNotOpen: [409, "ALREADY_SETTLED"],
  NonceUsed: [409, "NONCE_USED"],
  RequestAlreadyReserved: [409, "ALREADY_RESERVED"],
};

function mapRevert(e: unknown): ApiError {
  const err = e as { name?: string; shortMessage?: string; walk?: (f: (x: unknown) => boolean) => unknown };
  const named = err.walk?.((x) => typeof (x as { data?: { errorName?: string } }).data?.errorName === "string") as { data?: { errorName?: string } } | undefined;
  const name = named?.data?.errorName;
  if (name && REVERT_CODES[name]) {
    const [status, code] = REVERT_CODES[name];
    return new ApiError(status, code, `Contract rejected the request: ${name}`);
  }
  if (name) return new ApiError(409, "TX_REVERTED", `Contract rejected the request: ${name}`);
  return new ApiError(502, "RPC_UNAVAILABLE", err.shortMessage ?? "Could not submit the transaction");
}
