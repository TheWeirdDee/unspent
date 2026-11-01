import { useSolvency, useProviderOnchain, PROVIDER_ID } from "@/hooks/useVault";
import { addressUrl, dep, shortAddr, VAULT } from "@/lib/chains";
import { formatUsdc } from "@/lib/money";
import { Freshness } from "@/components/ui";
import { ExternalLink } from "lucide-react";

/** Live, verified contract state plus an explicitly labelled schematic. No invented balances. */
export function HeroVisual() {
  const sol = useSolvency();
  const prov = useProviderOnchain();
  const d = sol.data;
  return (
    <div className="card overflow-hidden shadow-[0_1px_0_0_var(--border)]">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <p className="label">Live from {dep.name}</p>
        {VAULT ? <a className="link inline-flex items-center gap-1 text-xs" href={addressUrl(VAULT)} target="_blank" rel="noopener noreferrer">{shortAddr(VAULT)} <ExternalLink size={12} aria-hidden /></a> : null}
      </div>
      <div className="space-y-4 p-5">
        {!VAULT ? <p className="text-sm text-muted">No vault is deployed on this network yet.</p> : (
          <>
            <dl className="grid grid-cols-2 gap-4">
              <div><dt className="text-xs text-muted">Held by the vault</dt><dd className="money mt-0.5 font-display text-3xl font-semibold">{d ? formatUsdc(d.tokenBalance) : "—"}</dd><p className="text-xs text-faint">USDC</p></div>
              <div><dt className="text-xs text-muted">Owed to customers</dt><dd className="money mt-0.5 font-display text-3xl font-semibold">{d ? formatUsdc(d.liability) : "—"}</dd><p className="text-xs text-faint">USDC, available + reserved</p></div>
            </dl>
            <p className="text-sm text-muted" role="status">
              {sol.isError ? "Could not read the contract right now." : !d ? "Reading the contract…" : d.tokenBalance >= d.liability ? `Backed: held funds cover everything owed, at block ${d.block.toString()}.` : "Held funds are below what is owed. Investigate before using."}
            </p>
            <Freshness updatedAt={sol.dataUpdatedAt} isError={sol.isError} isFetching={sol.isFetching} />
            {prov.data ? <p className="text-xs text-faint">Provider {PROVIDER_ID?.toString()} pays out to <a className="link mono" href={addressUrl(prov.data.payoutWallet)} target="_blank" rel="noopener noreferrer">{shortAddr(prov.data.payoutWallet)}</a>.</p> : null}
          </>
        )}
        <figure className="rounded-xl border border-dashed border-line2 p-4">
          <figcaption className="label">Schematic: one account, three balances</figcaption>
          <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-surface2" role="img" aria-label="Schematic bar divided into Available, Reserved and Spent. No real amounts.">
            <span className="w-[62%] bg-accent" /><span className="w-[14%] bg-accent/45" /><span className="w-[24%] bg-faint" />
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <li><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-accent" />Available: refundable now</li>
            <li><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-accent/45" />Reserved: locked for a request</li>
            <li><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-faint" />Spent: paid to the provider</li>
          </ul>
        </figure>
      </div>
    </div>
  );
}
