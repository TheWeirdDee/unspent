import { parseEventLogs, type Address, type Hex } from "viem";
import { unspentVaultAbi } from "../src/contracts/abi";
import { RESERVATION_STATUS } from "../src/lib/protocol";
import { publicClient, relayerClient, relayerAccount, VAULT } from "./config";

export function requireVault(): Address {
  if (!VAULT) throw new ApiError(503, "NOT_DEPLOYED", "No vault is configured for this network");
  return VAULT;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

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
export async function relay(functionName: "reserveWithSignature" | "acceptAndSettle", args: readonly unknown[]) {
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
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== "success") throw new ApiError(502, "TX_REVERTED", "Transaction reverted onchain", { txHash: hash });
    return { hash, receipt, logs: parseEventLogs({ abi: unspentVaultAbi, logs: receipt.logs }) };
  });
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
