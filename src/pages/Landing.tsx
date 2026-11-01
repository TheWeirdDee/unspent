import { Link } from "react-router-dom";
import { ArrowRight, CircleDollarSign, Database, ExternalLink, FileSignature, Server, ShieldOff, Unplug } from "lucide-react";
import { HeroVisual } from "@/components/landing/HeroVisual";
import { WorkflowDiagram } from "@/components/landing/WorkflowDiagram";
import { Faq, type FaqItem } from "@/components/landing/Faq";
import { RECOVERY_URL } from "@/components/Layouts";
import { PROOF_MAINNET, PROOF_TESTNET } from "@/lib/proof";
import { addressUrl, dep, txUrl, VAULT } from "@/lib/chains";
import { useProviderOnchain, PROVIDER_ID } from "@/hooks/useVault";

const FAQ: FaqItem[] = [
  { q: "Can the provider take my unspent balance?", a: "No. The vault has no administrator and no function that lets a provider withdraw customer funds. A provider is paid only when you sign acceptance of a specific response, for an amount you set in advance." },
  { q: "What if the provider's app or database goes down?", a: <>Your available credits are still held by the contract. Use the <Link className="link" to="/recover">independent recovery client</Link> to read your balance and withdraw it directly from an Arc RPC with your own wallet.</> },
  { q: "What does the contract prove about the API?", a: "Nothing about quality. It proves you authorised a payment, which response you accepted (by hash) and that the provider was paid exactly that amount. Whether the response was good is between you and the provider." },
  { q: "What if I never accept a response?", a: "Then the provider is not paid and your reserved credit returns to your available balance after the reservation expires. This protects customers first, and it means a provider takes some nonpayment risk. We state it plainly." },
  { q: "Is it audited?", a: "No. The contract has an automated test suite and an internal review, but no independent audit. Use small amounts only, and treat everything here as a demonstration until that changes." },
  { q: "Why Arc and USDC?", a: "On Arc, USDC is both the money and the gas token, with sub-second finality and predictable fees. Credits here are always 1:1 with USDC held by the contract; they are not a separate token." },
  { q: "Does it work with any wallet?", a: "Any browser wallet that supports EVM chains and typed-data signing, such as MetaMask or Rabby. Smart-contract wallets are not supported yet." },
];

export default function Landing() {
  const prov = useProviderOnchain();
  return (
    <>
      {/* HERO */}
      <section className="relative overflow-hidden" aria-labelledby="hero-title">
        <div className="grid-texture pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[1.05fr_1fr] lg:pb-28">
          <div>
            <p className="label">Refundable USDC API credits</p>
            <h1 id="hero-title" className="mt-4 text-balance text-[2.5rem] font-semibold leading-[1.05] sm:text-6xl">
              Buy API credits.<br />Keep control of what’s unspent.
            </h1>
            <p className="mt-5 max-w-xl text-pretty text-lg leading-relaxed text-muted">
              Your prepaid balance lives in an Arc smart contract. Pay for the API calls you accept, and withdraw what remains.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/app" className="btn btn-primary">Open app <ArrowRight size={16} aria-hidden /></Link>
              <Link to="/proof" className="btn btn-secondary">See live proof</Link>
            </div>
            <p className="mt-5 text-xs text-faint">Running on {dep.name}. Unaudited demonstration; use small amounts.</p>
          </div>
          <HeroVisual />
        </div>
      </section>

      {/* PROBLEM + SOLUTION */}
      <section className="border-t border-line" aria-labelledby="problem-title">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
          <div className="max-w-2xl">
            <p className="label">The problem</p>
            <h2 id="problem-title" className="mt-3 text-balance text-3xl font-semibold sm:text-4xl">A payment should never disappear into a broken credit database.</h2>
            <p className="mt-4 text-pretty leading-relaxed text-muted">
              Most prepaid APIs record your payment in one system and your credits in another. When the second step fails, the money has moved and nothing was credited. Developers have reported exactly this: a 5 USDC top-up that never showed up as credits (<a className="link" href="https://github.com/Conway-Research/automaton/issues/408" target="_blank" rel="noopener noreferrer">issue #408</a>, <a className="link" href="https://github.com/Conway-Research/automaton/issues/237" target="_blank" rel="noopener noreferrer">issue #237</a>; user reports, causes unverified).
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            <div className="card p-6">
              <p className="label flex items-center gap-2"><Unplug size={14} aria-hidden /> Typical setup</p>
              <div className="mt-4 flex items-center gap-3 text-sm">
                <span className="flex-1 rounded-lg bg-surface2 p-3"><CircleDollarSign size={16} className="mb-1 text-muted" aria-hidden />Payment settles</span>
                <span className="text-bad" aria-hidden>✕</span>
                <span className="flex-1 rounded-lg bg-surface2 p-3"><Database size={16} className="mb-1 text-muted" aria-hidden />Credit row written</span>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-muted">Two records, two failure modes. If the second step fails, you are paid up and uncredited, and refunds depend on support.</p>
            </div>
            <div className="card border-accent/40 p-6">
              <p className="label flex items-center gap-2 !text-accent"><FileSignature size={14} aria-hidden /> With UNSPENT</p>
              <div className="mt-4 flex items-center gap-3 text-sm">
                <span className="flex-1 rounded-lg bg-accentsoft p-3 text-fg"><CircleDollarSign size={16} className="mb-1 text-accent" aria-hidden />USDC enters the vault</span>
                <span className="text-accent" aria-hidden>=</span>
                <span className="flex-1 rounded-lg bg-accentsoft p-3 text-fg"><Database size={16} className="mb-1 text-accent" aria-hidden />Credits exist, same transaction</span>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-muted">One transaction does both or neither. Your unspent balance stays under contract rules, not a database row.</p>
            </div>
          </div>
          <dl className="mt-10 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ["Who", "Developers buying API usage, and small API providers who want customers to trust prepaid balances."],
              ["What", "Prepaid credits backed 1:1 by USDC in a smart contract, refundable until spent."],
              ["Why", "So a failed backend step can never strand your money or your refund."],
              ["How", "Deposit once. Sign a limit per call. Accept the response to pay. Withdraw the rest."],
              ["When", "Any time you prepay for usage and want to keep the right to take the unspent part back."],
            ].map(([k, v]) => (
              <div key={k}><dt className="font-display text-base font-semibold">{k}</dt><dd className="mt-1 text-sm leading-relaxed text-muted">{v}</dd></div>
            ))}
          </dl>
        </div>
      </section>

      {/* DEPOSIT / USE / WITHDRAW */}
      <section id="how" className="border-t border-line bg-surface/50 scroll-mt-20" aria-labelledby="how-title">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <h2 id="how-title" className="max-w-xl text-balance text-3xl font-semibold sm:text-4xl">Deposit. Use. Withdraw.</h2>
          <p className="mt-3 max-w-xl text-muted">Three steps, and you stay in control of the money at each one.</p>
          <div className="mt-10"><WorkflowDiagram /></div>
        </div>
      </section>

      {/* INDEPENDENT RECOVERY */}
      <section className="relative overflow-hidden border-t border-line" aria-labelledby="rec-title">
        <div className="grid-texture pointer-events-none absolute inset-0 opacity-70" aria-hidden />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-2">
          <div>
            <p className="label">Independent recovery</p>
            <h2 id="rec-title" className="mt-3 text-balance text-3xl font-semibold sm:text-4xl">If the app is down, your money isn’t stuck.</h2>
            <p className="mt-4 leading-relaxed text-muted">
              The recovery client is a separate static page with the contract address and ABI built in. It talks to an Arc RPC and your wallet directly. No login, no database, no indexer, no relayer, and no call to the UNSPENT API.
            </p>
            <p className="mt-3 leading-relaxed text-muted">
              Two different tests back this up. The app has a labelled demo switch that simulates a backend outage. Separately, on Arc Testnet we actually suspended the hosted API at its host and used the recovery client to release two expired reservations and refund 1.00 USDC (<a className="link" href="https://github.com/TheWeirdDee/unspent/blob/main/docs/fresh-wallet-recovery-test.md" target="_blank" rel="noopener noreferrer">record</a>). We have not run an outage test on mainnet: the mainnet payment journey ran with the API online.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a className="btn btn-primary" href={RECOVERY_URL} target="_blank" rel="noopener noreferrer">Open recovery client <ExternalLink size={15} aria-hidden /></a>
              <Link className="btn btn-secondary" to="/recover">How recovery works</Link>
            </div>
          </div>
          <figure className="card p-5">
            <svg viewBox="0 0 440 210" className="h-auto w-full" role="img" aria-label="Schematic: the billing backend is switched off, while your wallet reaches the Arc contract directly through an RPC.">
              <g opacity="0.55"><rect x="14" y="14" width="150" height="70" rx="12" fill="var(--surface-2)" stroke="var(--border-strong)" strokeDasharray="4 4" /><text x="89" y="46" textAnchor="middle" fill="var(--text)" fontSize="13" fontWeight="600">Billing backend</text><text x="89" y="66" textAnchor="middle" fill="var(--warn)" fontSize="11">switched off (demo)</text></g>
              <rect x="14" y="126" width="120" height="70" rx="12" fill="var(--surface-2)" stroke="var(--border-strong)" /><text x="74" y="158" textAnchor="middle" fill="var(--text)" fontSize="13" fontWeight="600">Recovery client</text><text x="74" y="177" textAnchor="middle" fill="var(--muted)" fontSize="11">static page</text>
              <rect x="190" y="126" width="90" height="70" rx="12" fill="var(--surface-2)" stroke="var(--border-strong)" /><text x="235" y="158" textAnchor="middle" fill="var(--text)" fontSize="13" fontWeight="600">Arc RPC</text>
              <rect x="320" y="110" width="106" height="100" rx="14" fill="var(--surface)" stroke="var(--accent)" /><text x="373" y="152" textAnchor="middle" fill="var(--text)" fontSize="13" fontWeight="600">Vault</text><text x="373" y="172" textAnchor="middle" fill="var(--muted)" fontSize="11">your funds</text>
              <path d="M134 161h56M280 161h40" stroke="var(--accent)" strokeWidth="2" /><path d="M164 49h60" stroke="var(--border-strong)" strokeDasharray="3 4" /><path d="M200 49l24 0" stroke="var(--bad)" />
            </svg>
            <figcaption className="mt-2 flex items-center gap-2 text-xs text-faint"><Server size={13} aria-hidden /> Schematic of the controlled demo. No balances shown.</figcaption>
          </figure>
        </div>
      </section>

      {/* ONCHAIN PROOF */}
      <section className="border-t border-line bg-surface/50" aria-labelledby="proof-title">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl">
              <p className="label">Real onchain proof</p>
              <h2 id="proof-title" className="mt-3 text-balance text-3xl font-semibold sm:text-4xl">Don’t trust the page. Check the chain.</h2>
              <p className="mt-3 text-muted">Every transaction listed on the proof page is re-read from {dep.name} when you load it. Nothing there is a screenshot.</p>
            </div>
            <Link to="/proof" className="btn btn-secondary">See all live proof <ArrowRight size={16} aria-hidden /></Link>
          </div>
          <dl className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="card p-5"><dt className="text-xs text-muted">Contract ({dep.name})</dt><dd className="mt-1 break-all">{VAULT ? <a className="link mono" href={addressUrl(VAULT)} target="_blank" rel="noopener noreferrer">{VAULT}</a> : "Not deployed"}</dd></div>
            <div className="card p-5"><dt className="text-xs text-muted">Deployed at block</dt><dd className="money mt-1 text-lg font-medium">{dep.deploymentBlock ?? "—"}</dd><a className="link text-xs" href={dep.deploymentTx ? txUrl(dep.deploymentTx) : undefined} target="_blank" rel="noopener noreferrer">deployment transaction</a></div>
            <div className="card p-5"><dt className="text-xs text-muted">Provider {PROVIDER_ID?.toString() ?? "—"} payout wallet</dt><dd className="mt-1 break-all">{prov.data ? <a className="link mono" href={addressUrl(prov.data.payoutWallet)} target="_blank" rel="noopener noreferrer">{prov.data.payoutWallet}</a> : "Reading…"}</dd></div>
          </dl>
          <p className="mt-4 text-sm text-muted">{PROOF_TESTNET.length} testnet transactions are recorded, covering deposit, reservation, settlement, expiry release and refund. A small mainnet demonstration ({PROOF_MAINNET.length} transactions, real USDC, unaudited contract) is recorded on the proof page.</p>
        </div>
      </section>

      {/* PROVIDER INTEGRATION */}
      <section className="border-t border-line" aria-labelledby="prov-title">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <p className="label">For API providers</p>
            <h2 id="prov-title" className="mt-3 text-balance text-3xl font-semibold sm:text-4xl">Take backed credits, get paid per accepted call.</h2>
            <ul className="mt-5 space-y-3 text-sm leading-relaxed text-muted">
              <li className="flex gap-3"><ShieldOff size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />Register once with a payout wallet. You never custody customer balances.</li>
              <li className="flex gap-3"><FileSignature size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />Run the call only after the customer’s signed reservation confirms onchain.</li>
              <li className="flex gap-3"><CircleDollarSign size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />Collect when the customer signs acceptance of your response hash. Revenue reconciles to contract events.</li>
            </ul>
            <p className="mt-4 text-sm text-faint">Trade-off: a customer may decline to accept. Price that in, as the docs explain.</p>
            <Link to="/docs#providers" className="btn btn-secondary mt-6">Read the provider guide</Link>
          </div>
          <pre className="card overflow-x-auto p-5 text-[0.8125rem] leading-relaxed" aria-label="Provider integration example"><code className="mono">{`// 1. Customer signed a ReserveAuthorisation. Your relayer submits it.
const hash = await relayer.writeContract({
  address: VAULT, abi: unspentVaultAbi,
  functionName: "reserveWithSignature",
  args: [authorisation, signature],
});

// 2. Run the service ONLY if the contract shows the reservation.
const r = await client.readContract({
  address: VAULT, abi: unspentVaultAbi,
  functionName: "getReservation", args: [reservationId],
});
if (r.status !== 1 /* Reserved */) throw new Error("not reserved");
const output = await runModel(input);
const responseHash = keccak256(toHex(output));

// 3. Customer signs a DeliveryAcceptance for that hash.
await relayer.writeContract({
  address: VAULT, abi: unspentVaultAbi,
  functionName: "acceptAndSettle",
  args: [acceptance, acceptanceSignature],
});`}</code></pre>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-line bg-surface/50" aria-labelledby="faq-title">
        <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6 sm:py-28">
          <h2 id="faq-title" className="text-3xl font-semibold sm:text-4xl">Questions</h2>
          <div className="mt-8"><Faq items={FAQ} /></div>
        </div>
      </section>

      {/* FINAL ACTION */}
      <section className="border-t border-line" aria-labelledby="final-title">
        <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 sm:py-28">
          <h2 id="final-title" className="text-balance text-3xl font-semibold sm:text-4xl">{dep.chainId === 5042 ? "Try it with a small amount of USDC. The contract is unaudited." : "Try it with a few dollars of testnet USDC."}</h2>
          <p className="mx-auto mt-3 max-w-xl text-muted">Deposit, run one real API call, accept it, and withdraw the rest. The whole loop takes a few minutes.</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link to="/app" className="btn btn-primary">Open app <ArrowRight size={16} aria-hidden /></Link>
            <Link to="/proof" className="btn btn-secondary">See live proof</Link>
          </div>
        </div>
      </section>
    </>
  );
}
