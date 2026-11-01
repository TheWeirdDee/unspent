import { Link } from "react-router-dom";
import { useState } from "react";
import { ArrowRight, ShieldCheck, X } from "lucide-react";
import { useAccountState, useWalletReady, useProviderOnchain, PROVIDER_ID } from "@/hooks/useVault";
import { useActivity } from "@/hooks/useActivity";
import { BalanceCard } from "@/components/BalanceCard";
import { ActivityList } from "@/components/ActivityList";
import { WithdrawPanel } from "@/components/Withdraw";
import { Notice } from "@/components/ui";
import { WalletButton } from "@/components/WalletButton";
import { dep, shortAddr, VAULT } from "@/lib/chains";

export default function Overview() {
  const { address, isConnected, ready } = useWalletReady();
  const acct = useAccountState(address);
  const act = useActivity(address);
  const provider = useProviderOnchain();
  const [withdrawing, setWithdrawing] = useState(false);

  if (!VAULT || PROVIDER_ID === undefined) {
    return <Notice tone="warn" title={`UNSPENT is not deployed on ${dep.name} yet`}>No vault or provider is configured for this network, so no balances can be shown.</Notice>;
  }
  if (!isConnected) {
    return (
      <div className="mx-auto max-w-lg py-10 text-center">
        <h1 className="text-3xl font-semibold">Your credits</h1>
        <p className="mt-3 text-muted">Connect a wallet to read your balance directly from the contract on {dep.name}.</p>
        <div className="mt-6 flex justify-center"><WalletButton /></div>
        <p className="mt-10 text-sm text-faint">No wallet? <Link className="link" to="/proof">Inspect the public proof</Link> without connecting.</p>
      </div>
    );
  }
  const d = acct.data;
  const firstRun = d && d.totalDeposited === 0n;
  const step = !d ? 0 : d.totalSettled > 0n ? 3 : d.totalDeposited > 0n ? 2 : 1;
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Your credits</h1>
          <p className="mt-1 text-sm text-muted">Backed by USDC on Arc · wallet <span className="mono">{address ? shortAddr(address) : ""}</span> · {provider.data ? "TextLab API (provider 1)" : "Provider 1"}</p>
        </div>
      </header>

      {acct.isError && !d ? <Notice tone="bad" title="Cannot verify your balance right now">The RPC did not answer. Nothing is shown rather than a guess, and no funds have moved. <button className="link" onClick={() => acct.refetch()}>Retry</button></Notice> : null}

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-4">
          <BalanceCard q={acct} />
          <div className="flex flex-wrap gap-3">
            <Link to="/app/deposit" className="btn btn-primary">Buy credits</Link>
            <button className="btn btn-secondary" disabled={!ready || !d || d.available === 0n} onClick={() => setWithdrawing(true)} title={!d || d.available === 0n ? "No available credits to withdraw" : undefined}>Withdraw unused</button>
            <Link to="/app/use" className="btn btn-ghost">Use the API <ArrowRight size={16} aria-hidden /></Link>
          </div>
          {d && d.available === 0n && d.reserved === 0n ? <p className="text-xs text-faint">Withdraw is disabled because you have no available credits.</p> : null}
        </div>

        <aside className="space-y-4">
          <section className="card p-5" aria-label="Journey">
            <h2 className="label">Your path</h2>
            <ol className="mt-3 space-y-3 text-sm">
              {[
                ["Deposit", "Add USDC to create credits in one transaction.", "/app/deposit"],
                ["Use the API", "Reserve 0.10, get a real response, accept it.", "/app/use"],
                ["Recover", "Withdraw what remains, even if apps go offline.", "/app/recover"],
              ].map(([t, s, to], i) => (
                <li key={t} className="flex gap-3">
                  <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold tnum ${step === i + 1 ? "bg-accent text-onaccent" : step > i + 1 ? "bg-accentsoft text-accent" : "bg-surface2 text-faint"}`}>{i + 1}</span>
                  <div><Link to={to} className="font-medium hover:underline">{t}</Link><p className="text-muted">{s}</p></div>
                </li>
              ))}
            </ol>
          </section>
          <section className="card p-5">
            <h2 className="flex items-center gap-2 text-base font-semibold"><ShieldCheck size={17} className="text-accent" aria-hidden /> If an app goes down</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">Your available credits are held by the contract, not a provider database. You can read and withdraw them with the <Link className="link" to="/app/recover">independent recovery client</Link>, which needs no login or backend. It does not recover credits already paid to a provider.</p>
          </section>
        </aside>
      </div>

      {firstRun ? <Notice tone="info" title="No credits yet">Add USDC to try the sample API. <Link className="link" to="/app/deposit">Buy 1 USDC of credits</Link>.</Notice> : null}

      <section aria-labelledby="latest" className="card p-5">
        <div className="flex items-center justify-between"><h2 id="latest" className="text-base font-semibold">Latest activity</h2><Link className="link text-sm" to="/app/activity">See all</Link></div>
        {act.isPending ? <p className="py-6 text-sm text-faint">Reading events from the chain…</p>
          : act.isError ? <Notice tone="bad" title="Could not read activity">The RPC call failed, so history may be incomplete. <button className="link" onClick={() => act.refetch()}>Retry</button></Notice>
          : act.data.events.length === 0 ? <p className="py-6 text-sm text-muted">No onchain activity for this wallet yet.</p>
          : <ActivityList events={act.data.events.slice(0, 3)} />}
      </section>

      {withdrawing && d ? (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/60 p-3 sm:place-items-center" onMouseDown={(e) => e.target === e.currentTarget && setWithdrawing(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="wd-title" className="card w-full max-w-md p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between"><div><h2 id="wd-title" className="text-lg font-semibold">Withdraw unused credits</h2><p className="text-sm text-muted">USDC returns to your connected wallet.</p></div><button className="btn btn-ghost btn-sm !px-2" aria-label="Close" onClick={() => setWithdrawing(false)}><X size={18} /></button></div>
            <WithdrawPanel account={d} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
