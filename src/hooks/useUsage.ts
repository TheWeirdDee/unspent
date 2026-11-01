import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, useSignTypedData } from "wagmi";
import type { Address, Hex } from "viem";
import { unspentVaultAbi } from "@/contracts/abi";
import { arcChain, publicClient, VAULT, dep } from "@/lib/chains";
import { ACCEPT_TYPES, RESERVE_TYPES, canonicalRequestHash, inputHash, vaultDomain } from "@/lib/protocol";
import { signAcceptance } from "@/lib/delivery";
import { describeError } from "@/hooks/useTx";
import { apiUrl } from "@/lib/api";

export type Step = "authorise" | "reserve" | "run" | "accept" | "pay";
export type Phase =
  | "idle" | "reserved" | "quoting" | "signing-reserve" | "reserving" | "running" | "delivered"
  | "signing-accept" | "settling" | "paid" | "failed";

interface Quote {
  requestId: string; accessToken: string; providerId: string; requestHash: Hex; nonce: string;
  authDeadline: number; reservationDeadline: number; payoutWallet: Address; payoutVersion: number;
  chainId: number; contract: Address; maxAmountMicrounits: string; displayAmountUsdc: string;
}
export interface Result { output: string; responseHash: Hex; latencyMs: number; serviceModel: string; usageAmountMicrounits: string }
export interface Flow {
  phase: Phase;
  failedAt?: Step;
  error?: { code: string; message: string; backendDown?: boolean };
  quote?: Quote;
  reserveTx?: Hex;
  reservationId?: string;
  result?: Result;
  settleTx?: Hex;
  /** True when this journey was restored after a refresh or navigation rather than started in this view. */
  resumed?: boolean;
}

class ApiFail extends Error {
  constructor(public code: string, message: string, public status: number, public backendDown = false) { super(message); }
}

async function api<T>(path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), { method: body ? "POST" : "GET", headers: { ...(body ? { "content-type": "application/json" } : {}), ...extraHeaders }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  } catch {
    throw new ApiFail("BACKEND_UNREACHABLE", "The billing backend is unreachable. Nothing was charged.", 0, true);
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { /* non-JSON gateway error */ }
  if (!res.ok) {
    const down = res.status === 503 || res.status === 504 || !text.startsWith("{");
    throw new ApiFail(String(json.code ?? "HTTP_" + res.status), String(json.message ?? "The billing backend returned an error."), res.status, down && json.code !== "NOT_DEPLOYED");
  }
  return json as T;
}

// A minimal handle to an in-flight request, kept only for this browser tab (sessionStorage) and scoped to the network,
// vault and wallet. It holds the quote and its bearer token, never the prompt text or the model output.
interface PendingHandle { quote: Quote; savedAt: number }
const PENDING_MAX_AGE_MS = 60 * 60_000;
const pending = {
  save(key: string, h: PendingHandle) { try { sessionStorage.setItem(key, JSON.stringify(h)); } catch { /* storage unavailable: the journey simply cannot be resumed */ } },
  load(key: string): PendingHandle | null {
    try {
      const h = JSON.parse(sessionStorage.getItem(key) ?? "null") as PendingHandle | null;
      return h?.quote?.requestId && h.quote.accessToken && Date.now() - h.savedAt < PENDING_MAX_AGE_MS ? h : null;
    } catch { return null; }
  },
  clear(key: string) { try { sessionStorage.removeItem(key); } catch { /* ignore */ } },
};
interface ServerRecord { state: string; reservationId: string | null; reserveTx: Hex | null; settleTx: Hex | null; responseHash: Hex | null; maxAmountMicrounits: string; serviceModel: string | null; latencyMs: number | null; errorCode: string | null; output: string | null }

const rand = () => BigInt("0x" + [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join(""));

export function useUsage(providerId: bigint | undefined) {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const qc = useQueryClient();
  const [flow, setFlow] = useState<Flow>({ phase: "idle" });
  const ref = useRef<Flow>(flow);
  const set = useCallback((patch: Partial<Flow>) => { ref.current = { ...ref.current, ...patch }; setFlow(ref.current); }, []);
  const textRef = useRef("");
  const storageKey = address && VAULT ? `unspent:pending:${dep.chainId}:${VAULT.toLowerCase()}:${address.toLowerCase()}` : null;

  const fail = useCallback((step: Step, e: unknown, phase: Phase = "failed") => {
    if (e instanceof ApiFail) set({ phase, failedAt: step, error: { code: e.code, message: e.message, backendDown: e.backendDown } });
    else { const d = describeError(e); set({ phase, failedAt: step, error: { code: d.rejected ? "REJECTED" : "ERROR", message: d.message } }); }
  }, [set]);

  const refreshChain = useCallback(() => qc.invalidateQueries(), [qc]);

  const start = useCallback(async (text: string) => {
    if (!address || !VAULT || providerId === undefined) return;
    textRef.current = text;
    ref.current = { phase: "quoting" };
    setFlow(ref.current);
    let quote: Quote;
    try {
      quote = await api<Quote>("/api/v1/usage/quote", { customer: address, providerId: providerId.toString(), inputHash: inputHash(text) });
      const expected = canonicalRequestHash({ requestId: quote.requestId, providerId: quote.providerId, customer: address, inputHash: inputHash(text) });
      const onchain = await publicClient.readContract({ address: VAULT, abi: unspentVaultAbi, functionName: "getProvider", args: [providerId] });
      if (expected !== quote.requestHash || quote.chainId !== dep.chainId || quote.contract.toLowerCase() !== VAULT.toLowerCase()
        || quote.maxAmountMicrounits !== "100000" || quote.payoutWallet.toLowerCase() !== onchain.payoutWallet.toLowerCase() || quote.payoutVersion !== onchain.payoutVersion
        || quote.reservationDeadline <= quote.authDeadline) {
        throw new ApiFail("QUOTE_MISMATCH", "The quote does not match the contract (price, payout wallet, chain or hash). Nothing was signed.", 0);
      }
    } catch (e) { return fail("authorise", e); }
    set({ quote, phase: "signing-reserve", resumed: false });
    if (storageKey) pending.save(storageKey, { quote, savedAt: Date.now() });

    let signature: Hex;
    try {
      signature = await signTypedDataAsync({
        domain: vaultDomain(arcChain.id, VAULT), types: RESERVE_TYPES, primaryType: "ReserveAuthorisation",
        message: { customer: address, providerId, payoutWallet: quote.payoutWallet, payoutVersion: quote.payoutVersion, requestHash: quote.requestHash,
          maxAmount: BigInt(quote.maxAmountMicrounits), nonce: BigInt(quote.nonce), authDeadline: BigInt(quote.authDeadline), expiry: BigInt(quote.reservationDeadline) },
      });
    } catch (e) { return fail("authorise", e); }

    set({ phase: "reserving" });
    try {
      const r = await api<{ reservationId: string; reserveTx: Hex }>("/api/v1/usage/reservations", { requestId: quote.requestId, accessToken: quote.accessToken, signature });
      // Confirm against the contract itself before spending anything.
      const onchain = await publicClient.readContract({ address: VAULT, abi: unspentVaultAbi, functionName: "getReservation", args: [BigInt(r.reservationId)] });
      if (onchain.status !== 1 || onchain.customer.toLowerCase() !== address.toLowerCase() || onchain.maxAmount !== 100_000n) throw new ApiFail("RESERVATION_MISMATCH", "The contract does not show the expected open reservation.", 0);
      set({ reservationId: r.reservationId, reserveTx: r.reserveTx });
      await refreshChain();
    } catch (e) { return fail("reserve", e); }

    set({ phase: "running" });
    try {
      const out = await api<Result>(`/api/v1/usage/${quote.requestId}/execute`, { accessToken: quote.accessToken, text });
      set({ result: out, phase: "delivered" });
    } catch (e) { fail("run", e); }
  }, [address, providerId, signTypedDataAsync, set, fail, refreshChain, storageKey]);

  const accept = useCallback(async () => {
    const f = ref.current;
    if (!address || !VAULT || providerId === undefined || !f.quote || !f.reservationId || !f.result) return;
    set({ phase: "signing-accept", error: undefined });
    const vault = VAULT;
    // The API is untrusted for this step. signAcceptance re-hashes the text shown on screen, bounds the amount by the quote
    // and the onchain reservation, checks the reservation is this customer's, and only then asks the wallet to sign.
    let signed: Awaited<ReturnType<typeof signAcceptance>>;
    try {
      const [reservation, block] = await Promise.all([
        publicClient.readContract({ address: vault, abi: unspentVaultAbi, functionName: "getReservation", args: [BigInt(f.reservationId)] }),
        publicClient.getBlock(),
      ]);
      signed = await signAcceptance(
        { result: f.result, customer: address, providerId, reservationId: f.reservationId, quote: f.quote, reservation, now: Number(block.timestamp), nonce: rand() },
        (message) => signTypedDataAsync({ domain: vaultDomain(arcChain.id, vault), types: ACCEPT_TYPES, primaryType: "DeliveryAcceptance", message }),
      );
    } catch (e) { return fail("accept", e, "delivered"); }
    if (!signed.ok) return fail("accept", new ApiFail(signed.code, signed.reason, 0), "delivered");
    const { message, signature } = signed;
    set({ phase: "settling" });
    try {
      const r = await api<{ settleTx: Hex }>(`/api/v1/usage/${f.quote.requestId}/accept`, { accessToken: f.quote.accessToken, signature, nonce: message.nonce.toString(), deadline: message.deadline.toString() });
      // Reconcile against the contract: it must show this reservation settled for the amount and response hash that were signed.
      const onchain = await publicClient.readContract({ address: VAULT, abi: unspentVaultAbi, functionName: "getReservation", args: [BigInt(f.reservationId)] });
      if (onchain.status !== 2) throw new ApiFail("NOT_SETTLED", "The contract does not show this reservation as settled yet.", 0);
      if (onchain.settledAmount !== message.amount || onchain.responseHash.toLowerCase() !== message.responseHash.toLowerCase()) {
        throw new ApiFail("SETTLEMENT_MISMATCH", "The contract settled a different amount or response than the one you signed. Check the transaction before relying on this result.", 0);
      }
      set({ settleTx: r.settleTx, phase: "paid" });
      if (storageKey) pending.clear(storageKey);
      await refreshChain();
    } catch (e) { fail("pay", e, "delivered"); }
  }, [address, providerId, signTypedDataAsync, set, fail, refreshChain, storageKey]);

  const reset = useCallback(() => {
    if (storageKey) pending.clear(storageKey);
    ref.current = { phase: "idle" };
    setFlow(ref.current);
  }, [storageKey]);

  /** Runs an already-confirmed reservation (after a refresh the text is not stored, so the customer pastes it again; the API checks its hash). */
  const run = useCallback(async (text: string) => {
    const f = ref.current;
    if (!f.quote || !f.reservationId) return;
    set({ phase: "running", error: undefined });
    try {
      const out = await api<Result>(`/api/v1/usage/${f.quote.requestId}/execute`, { accessToken: f.quote.accessToken, text });
      set({ result: out, phase: "delivered" });
    } catch (e) { fail("run", e, "reserved"); }
  }, [set, fail]);

  /** Re-reads a request from the API and the contract and moves the view to the step it has actually reached. */
  const syncFromServer = useCallback(async (quote: Quote, resumed: boolean) => {
    if (!VAULT || !storageKey) return;
    let rec: ServerRecord;
    try {
      rec = await api<ServerRecord>(`/api/v1/usage/${quote.requestId}`, undefined, { authorization: `Bearer ${quote.accessToken}` });
    } catch (e) {
      if (e instanceof ApiFail && !e.backendDown) pending.clear(storageKey); // unknown or no longer authorised: nothing to resume
      return;
    }
    let chainStatus: number | null = null;
    if (rec.reservationId) {
      try { chainStatus = (await publicClient.readContract({ address: VAULT, abi: unspentVaultAbi, functionName: "getReservation", args: [BigInt(rec.reservationId)] })).status; } catch { /* the API's view is used */ }
    }
    const base: Partial<Flow> = { quote, resumed, reservationId: rec.reservationId ?? undefined, reserveTx: rec.reserveTx ?? undefined, error: undefined, failedAt: undefined };
    const result: Result | undefined = rec.responseHash ? { output: rec.output ?? "", responseHash: rec.responseHash, latencyMs: rec.latencyMs ?? 0, serviceModel: rec.serviceModel ?? "", usageAmountMicrounits: rec.maxAmountMicrounits } : undefined;
    if (rec.state === "settled" || chainStatus === 2) {
      set({ ...base, phase: "paid", result, settleTx: rec.settleTx ?? undefined });
      pending.clear(storageKey);
    } else if (chainStatus === 3) {
      set({ ...base, phase: "failed", failedAt: "reserve", error: { code: "RESERVATION_RELEASED", message: "This reservation was released, so the credits are back in your available balance." } });
      pending.clear(storageKey);
    } else if (rec.state === "delivered" && result) {
      if (rec.output) set({ ...base, phase: "delivered", result });
      else set({ ...base, phase: "failed", failedAt: "run", error: { code: "OUTPUT_UNAVAILABLE", message: "The response is no longer retained (30-minute limit or a restart). Nothing was charged; release the reservation after it expires." } });
    } else if (rec.state === "reserved") {
      set({ ...base, phase: "reserved", result: undefined });
    } else if (rec.state === "reserving") set({ ...base, phase: "reserving" });
    else if (rec.state === "executing") set({ ...base, phase: "running" });
    else if (rec.state === "settling") set({ ...base, phase: "settling", result });
    else if (rec.state === "service_failed") set({ ...base, phase: "failed", failedAt: "run", error: { code: rec.errorCode ?? "SERVICE_FAILED", message: "No completed result. Your reserved credit stays reserved until it expires, then you can release it." } });
    else if (rec.state === "failed_before_service") set({ ...base, phase: "failed", failedAt: "reserve", error: { code: rec.errorCode ?? "RESERVE_FAILED", message: "The reservation did not complete. Nothing was charged." } });
    else pending.clear(storageKey); // "quoted": nothing was signed
  }, [set, storageKey]);

  // Restore an in-flight journey when this view opens (refresh, or navigating away and back). Switching wallet or network starts clean.
  useEffect(() => {
    ref.current = { phase: "idle" };
    setFlow(ref.current);
    if (!storageKey) return;
    const h = pending.load(storageKey);
    if (!h) return;
    void syncFromServer(h.quote, true); // stays idle until the API and the contract say which step this request reached
  }, [storageKey, set, syncFromServer]);

  // While a restored journey is waiting on the server or the chain, keep it in step.
  useEffect(() => {
    if (!flow.resumed || !flow.quote || !(flow.phase === "reserving" || flow.phase === "running" || flow.phase === "settling")) return;
    const quote = flow.quote;
    const t = setInterval(() => void syncFromServer(quote, true), 3000);
    return () => clearInterval(t);
  }, [flow.resumed, flow.quote, flow.phase, syncFromServer]);

  return { flow, start, accept, reset, run };
}
