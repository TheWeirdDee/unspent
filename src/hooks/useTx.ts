import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePublicClient, useWriteContract } from "wagmi";
import type { Abi, Hex } from "viem";
import { arcChain } from "@/lib/chains";

export type TxPhase = "idle" | "awaiting-wallet" | "submitted" | "confirmed" | "reverted" | "rejected" | "error";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export interface TxState {
  phase: TxPhase;
  hash?: Hex;
  message?: string;
  /** True while the chain could not be read (for example an RPC rate limit) but the transaction was already submitted. */
  readIssue?: boolean;
  /** True once reconciliation has run for a long time without finding the receipt. */
  longWait?: boolean;
}

export function describeError(e: unknown): { rejected: boolean; message: string } {
  const err = e as { code?: number; name?: string; shortMessage?: string; message?: string; cause?: { code?: number; name?: string } };
  const text = `${err.shortMessage ?? ""} ${err.message ?? ""}`.toLowerCase();
  if (err.code === 4001 || err.cause?.code === 4001 || err.name === "UserRejectedRequestError" || text.includes("user rejected") || text.includes("user denied")) {
    return { rejected: true, message: "You rejected the request in your wallet. Nothing was sent." };
  }
  if (text.includes("insufficient funds") || text.includes("exceeds the balance")) {
    return { rejected: false, message: "Not enough USDC for gas. Arc uses USDC for gas, so add a small amount of USDC and retry." };
  }
  if (text.includes("insufficientavailable")) return { rejected: false, message: "Not enough available credits for this amount." };
  if (text.includes("reservationnotexpired")) return { rejected: false, message: "This reservation has not reached its expiry time yet." };
  if (text.includes("reservationnotopen")) return { rejected: false, message: "This reservation was already settled or released." };
  if (text.includes("providerinactive")) return { rejected: false, message: "This provider is not accepting new deposits right now. Refunds are unaffected." };
  if (text.includes("transferamountmismatch")) return { rejected: false, message: "The token transferred a different amount than requested, so the deposit was refused." };
  if (text.includes("network") || text.includes("fetch") || text.includes("timeout")) return { rejected: false, message: "Network or RPC problem. No funds moved. Retry in a moment." };
  return { rejected: false, message: (err.shortMessage ?? err.message ?? "The transaction failed.").split("\n")[0] };
}

/** One explicit transaction lifecycle: wallet prompt -> submitted -> confirmed | reverted | rejected. */
export function useTx() {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: arcChain.id });
  const qc = useQueryClient();
  const [state, setState] = useState<TxState>({ phase: "idle" });

  const run = useCallback(
    async (req: { address: Hex; abi: Abi | readonly unknown[]; functionName: string; args: readonly unknown[] }) => {
      setState({ phase: "awaiting-wallet" });
      let hash: Hex;
      try {
        hash = await writeContractAsync({ ...req, chainId: arcChain.id } as never);
      } catch (e) {
        const d = describeError(e);
        setState({ phase: d.rejected ? "rejected" : "error", message: d.message });
        return undefined;
      }
      setState({ phase: "submitted", hash });
      // The transaction is already submitted. From here we only ever reconcile by hash against the chain:
      // a failed read (for example HTTP 429) must never read as success, failure or "not sent", and the
      // action stays locked (busy) so it cannot be submitted a second time while the first is unresolved.
      const started = Date.now();
      let readIssue = false;
      for (;;) {
        try {
          const receipt = await publicClient!.getTransactionReceipt({ hash });
          if (receipt.status === "success") {
            setState({ phase: "confirmed", hash });
            await qc.invalidateQueries();
            return receipt;
          }
          setState({ phase: "reverted", hash, message: "The transaction was included but reverted. No funds moved." });
          return undefined;
        } catch (e) {
          const notFound = (e as { name?: string }).name === "TransactionReceiptNotFoundError";
          if (!notFound !== readIssue) {
            readIssue = !notFound;
            setState((st) => ({ ...st, phase: "submitted", hash, readIssue }));
          }
        }
        const waited = Date.now() - started;
        if (waited > 120_000) setState((st) => (st.longWait ? st : { ...st, phase: "submitted", hash, longWait: true }));
        await sleep(waited < 30_000 ? 2_000 : 8_000);
        if (waited > 30 * 60_000) return undefined;
      }
    },
    [writeContractAsync, publicClient, qc],
  );

  const reset = useCallback(() => setState({ phase: "idle" }), []);
  return { state, run, reset, busy: state.phase === "awaiting-wallet" || state.phase === "submitted" };
}
