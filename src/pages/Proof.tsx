import { BUILD_COMMIT } from "@/build";
import { useQueries } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CheckCircle2, ExternalLink, Loader2, XCircle } from "lucide-react";
import { PROOF_API, PROOF_MAINNET, PROOF_TESTNET, type ProofTx } from "@/lib/proof";
import { createLimiter } from "@/lib/limit";
import { clientFor, dep, txUrl } from "@/lib/chains";
import { deployments, type NetworkKey } from "@/contracts/deployments";
import { useSolvency } from "@/hooks/useVault";
import { formatUsdc } from "@/lib/money";
import { Notice, Pill } from "@/components/ui";

// Owner-only project URL (requires a Circle sign-in; not a public link). Recorded for provenance, not as a public demo link.
const STUDIO_PROJECT_URL = (import.meta.env.VITE_STUDIO_URL as string | undefined) || "https://studio.arc.io/app/73cba122-05a1-4d3e-9f91-afb6132479b4";
// Public share link generated from Arc Studio's share menu. Shown only when configured; never guessed.
const STUDIO_SHARE_URL = import.meta.env.VITE_STUDIO_SHARE_URL as string | undefined;

// One limiter per network for the whole page: receipts render in parallel but only four reads are in flight, so the
// page does not turn into a 429 burst against the public RPC (which then spills over to blocked direct hosts).
const readers = new Map<NetworkKey, ReturnType<typeof createLimiter>>();
const readerFor = (net: NetworkKey) => {
  let reader = readers.get(net);
  if (!reader) {
    reader = createLimiter(4);
    readers.set(net, reader);
  }
  return reader;
};

function TxRows({ items, net }: { items: ProofTx[]; net: NetworkKey }) {
  const read = readerFor(net);
  const qs = useQueries({
    queries: items.map((t) => ({
      queryKey: ["proof-receipt", net, t.hash],
      staleTime: 60_000,
      retry: 1,
      queryFn: () =>
        read(async () => {
          const r = await clientFor(net).getTransactionReceipt({ hash: t.hash });
          return { status: r.status, block: r.blockNumber, gasUsed: r.gasUsed };
        }),
    })),
  });
  return (
    <ul className="divide-y divide-line">
      {items.map((t, i) => {
        const q = qs[i];
        return (
          <li key={t.hash} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
            <span className="mt-0.5 shrink-0" aria-hidden>
              {q.isPending ? <Loader2 size={16} className="animate-spin text-faint" /> : q.isError ? <XCircle size={16} className="text-warn" /> : q.data?.status === "success" ? <CheckCircle2 size={16} className="text-accent" /> : <XCircle size={16} className="text-bad" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t.label}</p>
              {t.note ? <p className="text-xs text-warn">{t.note}</p> : null}
              <p className="text-xs text-faint tnum">
                {q.isPending ? "Reading receipt from chain…" : q.isError ? "Could not read this receipt right now (RPC). Not verified." : `${q.data!.status === "success" ? "Confirmed" : "Reverted"} in block ${q.data!.block}`}
              </p>
            </div>
            <a className="link mono inline-flex items-center gap-1 text-xs" href={`${deployments[net].explorer}/tx/${t.hash}`} target="_blank" rel="noopener noreferrer">{t.hash.slice(0, 12)}…{t.hash.slice(-6)} <ExternalLink size={12} aria-hidden /></a>
          </li>
        );
      })}
    </ul>
  );
}

export default function Proof() {
  const sol = useSolvency();
  const mainnet = deployments.mainnet;
  return (
    <div className="mx-auto max-w-4xl space-y-12 px-4 py-14 sm:px-6 sm:py-20">
      <header>
        <p className="label">Public proof</p>
        <h1 className="mt-3 text-balance text-3xl font-semibold sm:text-5xl">A payment should never disappear into a broken credit database.</h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted">UNSPENT: backed API credits you can spend or reclaim. Every receipt below is read from the chain it was sent on when you open this page, and no wallet is needed. The live contract figures are for {dep.name}.</p>
        <div className="mt-6 flex flex-wrap gap-3"><Link to="/app" className="btn btn-primary">Recreate with your own wallet</Link><Link to="/recover" className="btn btn-secondary">Independent recovery</Link></div>
      </header>

      <section aria-labelledby="links" className="space-y-3">
        <h2 id="links" className="text-xl font-semibold">Where to inspect it</h2>
        <dl className="card divide-y divide-line text-sm">
          <div className="flex flex-wrap justify-between gap-2 p-4"><dt className="text-muted">Testnet contract</dt><dd>{deployments.testnet.vault ? <a className="link mono break-all" href={`${deployments.testnet.explorer}/address/${deployments.testnet.vault}`} target="_blank" rel="noopener noreferrer">{deployments.testnet.vault}</a> : "Not deployed"}</dd></div>
          <div className="flex flex-wrap justify-between gap-2 p-4"><dt className="text-muted">Mainnet contract (unaudited)</dt><dd>{deployments.mainnet.vault ? <a className="link mono break-all" href={`${deployments.mainnet.explorer}/address/${deployments.mainnet.vault}`} target="_blank" rel="noopener noreferrer">{deployments.mainnet.vault}</a> : "Not deployed"}</dd></div>
          <div className="flex flex-wrap justify-between gap-2 p-4"><dt className="text-muted">Deployment block</dt><dd className="tnum">{dep.deploymentBlock} · <a className="link" href={dep.deploymentTx ? txUrl(dep.deploymentTx) : undefined} target="_blank" rel="noopener noreferrer">transaction</a></dd></div>
          <div className="flex flex-wrap justify-between gap-2 p-4"><dt className="text-muted">Source repository</dt><dd><a className="link" href="https://github.com/TheWeirdDee/unspent" target="_blank" rel="noopener noreferrer">github.com/TheWeirdDee/unspent</a></dd></div>
          <div className="flex flex-wrap justify-between gap-2 p-4"><dt className="text-muted">Arc Studio project</dt><dd className="max-w-md text-right">
            {STUDIO_SHARE_URL ? <><a className="link break-all" href={STUDIO_SHARE_URL} target="_blank" rel="noopener noreferrer">{STUDIO_SHARE_URL}</a><span className="block text-xs text-faint">Public share link</span></>
              : <><span className="text-warn">No public share link recorded yet.</span><span className="block text-xs text-faint">Project (opens only for its owner, after Circle sign-in): <a className="link break-all" href={STUDIO_PROJECT_URL} target="_blank" rel="noopener noreferrer">{STUDIO_PROJECT_URL}</a></span></>}
          </dd></div>
          <div className="flex flex-wrap justify-between gap-2 p-4"><dt className="text-muted">This page's build</dt><dd className="mono">{BUILD_COMMIT === "dev" ? "local development build" : BUILD_COMMIT}</dd></div>
          <div className="flex flex-wrap justify-between gap-2 p-4"><dt className="text-muted">Reported failure this addresses</dt><dd><a className="link" href="https://github.com/Conway-Research/automaton/issues/408" target="_blank" rel="noopener noreferrer">Conway Automaton issue #408</a> (user report, 27 Sep 2026)</dd></div>
        </dl>
      </section>

      <section aria-labelledby="mainnet-evidence" className="space-y-3">
        <h2 id="mainnet-evidence" className="text-xl font-semibold">Arc mainnet (chain {mainnet.chainId})</h2>
        <div className="flex flex-wrap items-center gap-3"><Pill tone="warn">Real USDC · unaudited contract</Pill></div>
        {mainnet.vault ? <p className="money text-lg font-medium">0.20 USDC in · 0.10 settled to the provider · 0.10 refunded</p> : null}
        {mainnet.vault ? <p className="text-sm">Contract <a className="link mono break-all" href={`${mainnet.explorer}/address/${mainnet.vault}`} target="_blank" rel="noopener noreferrer">{mainnet.vault}</a></p>
          : <Notice tone="info" title="Not deployed">No mainnet contract exists yet and no mainnet transaction has been made. Deployment moves real funds and will happen only from your wallet, after you approve the exact steps.</Notice>}
        {mainnet.vault ? <>
          <p className="text-sm text-muted">One small real-funds demonstration, signed by the owner in their own MetaMask on 1 Nov 2026: 0.20 USDC deposited, one real Gemini request settled for 0.10 USDC to the provider's payout wallet, and the remaining 0.10 USDC refunded to the customer. The provider's owner and payout wallet are the same wallet. This is one run, not a production claim.</p>
          <div className="card px-5 py-1"><TxRows items={PROOF_MAINNET} net="mainnet" /></div>
          <p className="text-sm text-muted">MetaMask showed a "deceptive site" warning for this app's domain and for the recovery client's domain before each connection. The owner reviewed each request and chose to proceed. The cause of the classification is unknown; a review request is open at <a className="link" href="https://github.com/MetaMask/eth-phishing-detect/issues/308206" target="_blank" rel="noopener noreferrer">MetaMask/eth-phishing-detect#308206</a>.</p>
        </> : null}
      </section>

      <section aria-labelledby="live" className="space-y-3">
        <h2 id="live" className="text-xl font-semibold">Contract state right now ({dep.name})</h2>
        <div className="card grid gap-px overflow-hidden bg-line sm:grid-cols-2">
          <div className="bg-surface p-5"><p className="text-xs text-muted">USDC held by the vault</p><p className="money mt-1 font-display text-3xl font-semibold">{sol.data ? formatUsdc(sol.data.tokenBalance) : "—"}</p></div>
          <div className="bg-surface p-5"><p className="text-xs text-muted">Owed to customers (available + reserved)</p><p className="money mt-1 font-display text-3xl font-semibold">{sol.data ? formatUsdc(sol.data.liability) : "—"}</p></div>
        </div>
        {sol.isError ? <Notice tone="bad" title="Could not read the contract">The RPC call failed; no value is shown rather than a guess.</Notice> : sol.data ? <p className="text-xs text-faint tnum">Read at block {sol.data.block.toString()}.</p> : null}
      </section>

      <section aria-labelledby="tx" className="space-y-3">
        <div className="flex flex-wrap items-center gap-3"><h2 id="tx" className="text-xl font-semibold">Arc Testnet transactions</h2><Pill tone="warn">Testnet, not real funds</Pill></div>
        <div className="card px-5 py-1"><TxRows items={PROOF_TESTNET} net="testnet" /></div>
        <p className="text-sm text-muted">The protocol journey proves contract accounting: approval creates nothing, deposit creates credits atomically, settlement pays the bound wallet, an expired reservation is released, and the remainder is refunded. Its response hash is a fixed test string, so it does not demonstrate the API.</p>
      </section>

      <section aria-labelledby="api" className="space-y-3">
        <h2 id="api" className="text-xl font-semibold">Real API journey on testnet (Gemini)</h2>
        <p className="text-sm text-muted">Deposit, a customer-authorised reservation, an actual Gemini response, the customer's signed acceptance, provider settlement and a refund, driven through the app UI. The settled response hash equals the keccak256 of the response shown on screen. Two earlier runs of the same script also settled 0.10 each before the script was corrected, so the provider payout wallet holds more than this one journey.</p>
        {PROOF_API.length ? <div className="card px-5 py-1"><TxRows items={PROOF_API} net="testnet" /></div> : <Notice tone="warn" title="Not yet recorded">No real-API journey has been recorded for this network yet. Nothing here is simulated.</Notice>}
      </section>


      <section aria-labelledby="lim" className="space-y-3">
        <h2 id="lim" className="text-xl font-semibold">Limitations, stated plainly</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted">
          <li>The contract is unaudited. It has 193 passing Foundry tests (including 8 invariant properties and fuzzing) and an internal review. Mainnet use is at your own risk.</li>
          <li>MetaMask flags this app's domains with a "deceptive site" warning. The classification is unresolved and is not hidden or bypassed.</li>
          <li>A response hash proves what you accepted, not that the service was correct.</li>
          <li>A customer can withhold acceptance, which exposes providers to nonpayment risk.</li>
          <li>Refunds cannot happen if the token issuer or network blocks transfers to your address.</li>
          <li>Smart-contract wallets are not supported; signatures are EOA-only.</li>
        </ul>
      </section>
    </div>
  );
}
