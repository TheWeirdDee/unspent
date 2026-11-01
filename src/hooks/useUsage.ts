import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, useSignTypedData } from "wagmi";
import type { Address, Hex } from "viem";
import { unspentVaultAbi } from "@/contracts/abi";
import { arcChain, publicClient, VAULT, dep } from "@/lib/chains";
import { ACCEPT_TYPES, RESERVE_TYPES, canonicalRequestHash, inputHash, vaultDomain } from "@/lib/protocol";
import { describeError } from "@/hooks/useTx";
import { apiUrl } from "@/lib/api";

export type Step = "authorise" | "reserve" | "run" | "accept" | "pay";
export type Phase =
  | "idle" | "quoting" | "signing-reserve" | "reserving" | "running" | "delivered"
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
}

class ApiFail extends Error {
  constructor(public code: string, message: string, public status: number, public backendDown = false) { super(message); }
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), { method: body ? "POST" : "GET", headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
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

const rand = () => BigInt("0x" + [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join(""));

export function useUsage(providerId: bigint | undefined) {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const qc = useQueryClient();
  const [flow, setFlow] = useState<Flow>({ phase: "idle" });
  const ref = useRef<Flow>(flow);
  const set = useCallback((patch: Partial<Flow>) => { ref.current = { ...ref.current, ...patch }; setFlow(ref.current); }, []);
  const textRef = useRef("");

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
    set({ quote, phase: "signing-reserve" });

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
  }, [address, providerId, signTypedDataAsync, set, fail, refreshChain]);

  const accept = useCallback(async () => {
    const f = ref.current;
    if (!address || !VAULT || !f.quote || !f.reservationId || !f.result) return;
    set({ phase: "signing-accept", error: undefined });
    const nonce = rand();
    const deadline = BigInt(f.quote.reservationDeadline - 1);
    let signature: Hex;
    try {
      signature = await signTypedDataAsync({
        domain: vaultDomain(arcChain.id, VAULT), types: ACCEPT_TYPES, primaryType: "DeliveryAcceptance",
        message: { customer: address, reservationId: BigInt(f.reservationId), responseHash: f.result.responseHash, amount: BigInt(f.result.usageAmountMicrounits), nonce, deadline },
      });
    } catch (e) { return fail("accept", e, "delivered"); }
    set({ phase: "settling" });
    try {
      const r = await api<{ settleTx: Hex }>(`/api/v1/usage/${f.quote.requestId}/accept`, { accessToken: f.quote.accessToken, signature, nonce: nonce.toString(), deadline: deadline.toString() });
      const onchain = await publicClient.readContract({ address: VAULT, abi: unspentVaultAbi, functionName: "getReservation", args: [BigInt(f.reservationId)] });
      if (onchain.status !== 2) throw new ApiFail("NOT_SETTLED", "The contract does not show this reservation as settled yet.", 0);
      set({ settleTx: r.settleTx, phase: "paid" });
      await refreshChain();
    } catch (e) { fail("pay", e, "delivered"); }
  }, [address, signTypedDataAsync, set, fail, refreshChain]);

  const reset = useCallback(() => { ref.current = { phase: "idle" }; setFlow(ref.current); }, []);
  return { flow, start, accept, reset };
}
