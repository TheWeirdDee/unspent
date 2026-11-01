import { ExternalLink, ShieldCheck, ServerOff, Wallet } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { RECOVERY_URL } from "@/components/Layouts";
import { useBackendStatus } from "@/hooks/useHealth";
import { addressUrl, VAULT } from "@/lib/chains";
import { Notice, Pill } from "@/components/ui";

export default function Recover() {
  const loc = useLocation();
  const inApp = loc.pathname.startsWith("/app");
  const s = useBackendStatus();
  const url = RECOVERY_URL;
  return (
    <div className={inApp ? "space-y-8" : "mx-auto max-w-4xl space-y-10 px-4 py-12 sm:px-6 sm:py-16"}>
      <header className="max-w-2xl">
        <p className="label">Independent recovery</p>
        <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">Your funds, even if an app goes offline.</h1>
        <p className="mt-3 leading-relaxed text-muted">The recovery client is a separate static site. It reads the contract from an Arc RPC (directly, or through a read-only pass-through on its own host, which is not the UNSPENT API) and sends refund and release transactions from your own wallet. It has no login, no database, no indexer and no relayer, and it never calls the UNSPENT API.</p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <a className="btn btn-primary" href={url} target="_blank" rel="noopener noreferrer">Open the recovery client <ExternalLink size={15} aria-hidden /></a>
          <span className="text-sm text-muted">Billing backend now: {s.kind === "online" ? <Pill tone="ok">online</Pill> : s.kind === "simulated-outage" ? <Pill tone="warn">SIMULATED OUTAGE (demo)</Pill> : s.kind === "unreachable" ? <Pill tone="warn">unreachable</Pill> : <Pill>checking</Pill>}</span>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-3" aria-label="What it does">
        {[
          [Wallet, "Read your accounts", "Available, reserved, spent and refunded amounts, read from the contract at the latest block."],
          [ShieldCheck, "Refund available credits", "Withdraw to your own wallet. The contract sends funds only to the account owner."],
          [ServerOff, "Release expired reserves", "Anyone can release a reservation after its expiry. The credits return to your available balance."],
        ].map(([Icon, t, d]) => {
          const I = Icon as typeof Wallet;
          return <div key={t as string} className="card p-5"><I size={20} className="text-accent" aria-hidden /><h2 className="mt-3 text-base font-semibold">{t as string}</h2><p className="mt-1 text-sm leading-relaxed text-muted">{d as string}</p></div>;
        })}
      </section>

      <section className="card p-5 sm:p-6" aria-labelledby="how">
        <h2 id="how" className="text-lg font-semibold">How to use it when the app is down</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted">
          <li>Open the recovery client (the link above, or the copy you bookmarked or hosted yourself).</li>
          <li>Connect the same wallet you deposited from. Your balance appears within seconds. If no wallet is available, paste your address for a read-only view.</li>
          <li>Press <strong className="text-fg">Refund to my wallet</strong>, review the destination and amount, then confirm in your wallet.</li>
          <li>If a request was in flight, wait for its expiry time, press <strong className="text-fg">Release expired reserve</strong>, then refund.</li>
        </ol>
        <p className="mt-4 text-sm text-muted">No tool at all? Call <span className="mono">refund(providerId, amount)</span> on the contract from any wallet-capable block explorer or with <span className="mono">cast</span>. The contract address is {VAULT ? <a className="link mono break-all" href={addressUrl(VAULT)} target="_blank" rel="noopener noreferrer">{VAULT}</a> : "not yet deployed on this network"}.</p>
      </section>

      <Notice tone="info" title="What recovery cannot do">
        It cannot return credits that were already paid to a provider, guarantee the API worked, or move funds if USDC transfers to your address are blocked by the token issuer or the network. A small amount of USDC is needed for gas. <Link className="link" to="/docs#trust">Trust assumptions</Link>
      </Notice>
    </div>
  );
}
