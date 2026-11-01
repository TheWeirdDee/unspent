import { formatUsdc } from "@/lib/money";
import { Freshness } from "@/components/ui";
import type { UseQueryResult } from "@tanstack/react-query";
import type { AccountState } from "@/hooks/useVault";

export function BalanceCard({ q }: { q: UseQueryResult<AccountState & { block: bigint }> }) {
  const d = q.data;
  const stale = q.isError;
  const v = (x?: bigint) => (d ? formatUsdc(x ?? 0n) : "—");
  return (
    <section aria-labelledby="bal-title" className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="bal-title" className="label">Refundable now</h2>
        <Freshness updatedAt={q.dataUpdatedAt} isError={stale} isFetching={q.isFetching} />
      </div>
      <p className={`mt-2 font-display text-5xl font-semibold money sm:text-6xl ${stale ? "opacity-60" : ""}`}>
        {v(d?.available)} <span className="text-2xl font-medium text-faint">USDC</span>
      </p>
      <p className="mt-1 text-sm text-muted">Available credits you can use or withdraw. Backed by USDC held in the contract.</p>
      <dl className={`mt-5 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line ${stale ? "opacity-60" : ""}`}>
        {[
          ["Reserved", d?.reserved, "Locked for in-flight requests"],
          ["Spent", d?.totalSettled, "Paid to the provider"],
          ["Deposited", d?.totalDeposited, "Lifetime total"],
        ].map(([label, val, hint]) => (
          <div key={label as string} className="bg-surface p-3.5">
            <dt className="text-xs text-muted">{label as string}</dt>
            <dd className="money mt-0.5 text-lg font-medium">{v(val as bigint | undefined)}</dd>
            <p className="mt-0.5 hidden text-xs text-faint sm:block">{hint as string}</p>
          </div>
        ))}
      </dl>
      {d && d.totalRefunded > 0n ? <p className="mt-3 text-xs text-faint">Previously refunded to your wallet: <span className="money">{formatUsdc(d.totalRefunded)}</span> USDC</p> : null}
      {d ? (
        <p className="mt-1 text-xs text-faint tnum">Available + Reserved + Spent + Refunded = Deposited ({formatUsdc(d.available + d.reserved + d.totalSettled + d.totalRefunded, 6)} = {formatUsdc(d.totalDeposited, 6)}).</p>
      ) : null}
    </section>
  );
}
