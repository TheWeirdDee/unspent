import { useEffect, useState } from "react";
import type { Address } from "viem";
import { useActivity } from "@/hooks/useActivity";
import { openReservations } from "@/lib/activity";
import { useTx } from "@/hooks/useTx";
import { useWalletReady } from "@/hooks/useVault";
import { unspentVaultAbi } from "@/contracts/abi";
import { VAULT, txUrl } from "@/lib/chains";
import { formatUsdc } from "@/lib/money";
import { Notice, TxStatus } from "@/components/ui";

function Countdown({ expiry }: { expiry: bigint }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => { const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000); return () => clearInterval(t); }, []);
  const left = Number(expiry) - now;
  if (left <= 0) return <span className="font-medium text-accent">Expired: releasable now</span>;
  const m = Math.floor(left / 60), s = left % 60;
  return <span className="tnum">Expires in {m}:{String(s).padStart(2, "0")}</span>;
}

/** Reservations that are neither settled nor released, with a direct release path once the expiry timestamp passes. */
export function OpenReservations({ customer }: { customer: Address | undefined }) {
  const act = useActivity(customer);
  const { ready } = useWalletReady();
  const tx = useTx();
  if (!customer || !act.data) return null;
  const open = openReservations(act.data.events);
  if (open.length === 0) return null;
  return (
    <section className="card p-5" aria-labelledby="open-res">
      <h2 id="open-res" className="text-base font-semibold">In-flight reservations</h2>
      <p className="mt-1 text-sm text-muted">Reserved credits are not refundable until the request is settled, or released after expiry. Release returns them to your available balance.</p>
      <ul className="mt-3 divide-y divide-line">
        {open.map((r) => {
          const expired = Math.floor(Date.now() / 1000) >= Number(r.expiry);
          return (
            <li key={r.reservationId.toString()} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="text-sm font-medium">Reservation #{r.reservationId.toString()} · <span className="money">{formatUsdc(r.amount)} USDC</span></p>
                <p className="text-xs text-muted"><Countdown expiry={r.expiry} /> · <a className="link" href={txUrl(r.txHash)} target="_blank" rel="noopener noreferrer">reserve tx</a></p>
              </div>
              <button className="btn btn-secondary btn-sm" disabled={!ready || tx.busy || !expired} title={!expired ? "Release is allowed once the expiry time has passed" : undefined}
                onClick={() => tx.run({ address: VAULT!, abi: unspentVaultAbi, functionName: "releaseExpired", args: [r.reservationId] })}>
                {tx.busy ? "Releasing…" : "Release expired reserve"}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-3"><TxStatus state={tx.state} onReset={tx.reset} confirmedText="The reservation was released back to your available credits." /></div>
      {act.isError ? <div className="mt-3"><Notice tone="warn" title="History may be incomplete">The last RPC read failed.</Notice></div> : null}
    </section>
  );
}
