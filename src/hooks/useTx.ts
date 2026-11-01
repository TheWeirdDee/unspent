import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePublicClient, useWriteContract } from "wagmi";
import type { Abi, Hex } from "viem";
import { arcChain } from "@/lib/chains";

export type TxPhase = "idle" | "awaiting-wallet" | "submitted" | "confirmed" | "reverted" | "rejected" | "error";
export interface TxState {
  phase: TxPhase;
  hash?: Hex;
  message?: string;
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
      try {
        const receipt = await publicClient!.waitForTransactionReceipt({ hash, timeout: 90_000 });
        if (receipt.status === "success") {
          setState({ phase: "confirmed", hash });
          await qc.invalidateQueries();
          return receipt;
        }
        setState({ phase: "reverted", hash, message: "The transaction was included but reverted. No funds moved." });
      } catch (e) {
        setState({ phase: "error", hash, message: `Could not confirm the transaction yet (${describeError(e).message}). Check the explorer before retrying.` });
      }
      return undefined;
    },
    [writeContractAsync, publicClient, qc],
  );

  const reset = useCallback(() => setState({ phase: "idle" }), []);
  return { state, run, reset, busy: state.phase === "awaiting-wallet" || state.phase === "submitted" };
}
