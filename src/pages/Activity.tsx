import { useMemo, useState } from "react";
import { useActivity } from "@/hooks/useActivity";
import { useAccountState, useWalletReady } from "@/hooks/useVault";
import { ActivityList } from "@/components/ActivityList";
import { Notice } from "@/components/ui";
import { WalletButton } from "@/components/WalletButton";
import { formatUsdc } from "@/lib/money";
import type { ActivityKind } from "@/lib/activity";
import { dep } from "@/lib/chains";

const FILTERS: { id: "all" | ActivityKind; label: string }[] = [
  { id: "all", label: "All" }, { id: "deposit", label: "Deposits" }, { id: "reserve", label: "Reservations" },
  { id: "settle", label: "Usage" }, { id: "release", label: "Releases" }, { id: "refund", label: "Refunds" },
];

export default function Activity() {
  const { address, isConnected } = useWalletReady();
  const act = useActivity(address);
  const acct = useAccountState(address);
  const [filter, setFilter] = useState<"all" | ActivityKind>("all");
  const rows = useMemo(() => (act.data?.events ?? []).filter((e) => filter === "all" || e.kind === filter), [act.data, filter]);
  if (!isConnected) return <div className="mx-auto max-w-lg py-10 text-center"><h1 className="text-3xl font-semibold">Activity</h1><p className="mt-3 text-muted">Connect a wallet to see its onchain history on {dep.name}.</p><div className="mt-6 flex justify-center"><WalletButton /></div></div>;
  const d = acct.data;
  return (
    <div className="space-y-6">
      <header><h1 className="text-3xl font-semibold">Activity</h1><p className="mt-1 text-sm text-muted">Every row is a contract event, ordered by block and log index. Times are for convenience only.</p></header>
      {d ? (
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-5">
          {([["Deposited", d.totalDeposited], ["Settled", d.totalSettled], ["Refunded", d.totalRefunded], ["Available", d.available], ["Reserved", d.reserved]] as const).map(([l, v]) => (
            <div key={l} className="bg-surface p-3.5"><dt className="text-xs text-muted">{l}</dt><dd className="money text-lg font-medium">{formatUsdc(v)}</dd></div>
          ))}
        </dl>
      ) : null}
      {d ? <p className="text-xs text-faint tnum">Reconciles: Available + Reserved + Settled + Refunded = {formatUsdc(d.available + d.reserved + d.totalSettled + d.totalRefunded, 6)} = Deposited {formatUsdc(d.totalDeposited, 6)}.</p> : null}
      <div role="tablist" aria-label="Filter activity" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => <button key={f.id} role="tab" aria-selected={filter === f.id} className={`btn btn-sm ${filter === f.id ? "btn-primary" : "btn-secondary"}`} onClick={() => setFilter(f.id)}>{f.label}</button>)}
      </div>
      <section className="card px-5 py-2" aria-live="polite">
        {act.isPending ? <p className="py-8 text-sm text-faint">Reading events from the chain…</p>
          : act.isError ? <div className="py-4"><Notice tone="bad" title="Could not read onchain history">The RPC request failed. This list may be missing events; it is not current. <button className="link" onClick={() => act.refetch()}>Retry</button></Notice></div>
          : rows.length === 0 ? <p className="py-8 text-sm text-muted">{filter === "all" ? "No onchain activity for this wallet yet." : "No events of this type yet."}</p>
          : <ActivityList events={rows} detail />}
      </section>
      {act.data ? <p className="text-xs text-faint tnum">Scanned blocks {act.data.fromBlock.toString()} to {act.data.head.toString()} (from the contract's deployment block).</p> : null}
    </div>
  );
}
