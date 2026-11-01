import { useMemo, useState } from "react";
import { isAddress, keccak256, stringToHex, type Address } from "viem";
import { useActivity } from "@/hooks/useActivity";
import { useProviderOnchain, useWalletReady, PROVIDER_ID } from "@/hooks/useVault";
import { useBackendStatus } from "@/hooks/useHealth";
import { useTx } from "@/hooks/useTx";
import { unspentVaultAbi } from "@/contracts/abi";
import { addressUrl, dep, shortAddr, txUrl, VAULT } from "@/lib/chains";
import { formatUsdc } from "@/lib/money";
import { Notice, Pill, TxStatus } from "@/components/ui";

export default function Provider() {
  const { address, ready } = useWalletReady();
  const prov = useProviderOnchain();
  const act = useActivity();
  const backend = useBackendStatus();
  const isOwner = Boolean(address && prov.data && prov.data.owner.toLowerCase() === address.toLowerCase());
  const mine = useMemo(() => (act.data?.events ?? []).filter((e) => PROVIDER_ID !== undefined && e.providerId === PROVIDER_ID), [act.data]);
  const settled = mine.filter((e) => e.kind === "settle");
  const total = settled.reduce((a, e) => a + e.amount, 0n);
  const dayAgo = Math.floor(Date.now() / 1000) - 86_400;
  const last24 = settled.filter((e) => (e.timestamp ?? 0) >= dayAgo).reduce((a, e) => a + e.amount, 0n);
  const open = mine.filter((e) => e.kind === "reserve" && !mine.some((x) => (x.kind === "settle" || x.kind === "release") && x.reservationId === e.reservationId));
  const payoutTx = useTx(), activeTx = useTx(), regTx = useTx();
  const [newPayout, setNewPayout] = useState("");
  const [regPayout, setRegPayout] = useState("");
  const [regName, setRegName] = useState("");

  if (!VAULT) return <Notice tone="warn" title={`Not deployed on ${dep.name}`}>No vault is configured for this network.</Notice>;
  const p = prov.data;
  const vault = VAULT;
  return (
    <div className="space-y-8">
      <header><h1 className="text-3xl font-semibold">For providers</h1><p className="mt-1 text-sm text-muted">Reconcile revenue against contract events. Integration steps are in the <a className="link" href="/docs#providers">provider guide</a>.</p></header>

      <section className="card p-5" aria-labelledby="po">
        <h2 id="po" className="label">Registered provider</h2>
        {prov.isPending ? <p className="mt-3 text-sm text-faint">Reading the registry…</p> : prov.isError || !p ? <Notice tone="bad" title="Could not read the provider registry">Retry in a moment.</Notice> : (
          <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">Provider ID</dt><dd className="tnum font-medium">{PROVIDER_ID?.toString()} <Pill tone="info">Built-in sample (TextLab)</Pill></dd></div>
            <div><dt className="text-muted">Status</dt><dd>{p.active ? <Pill tone="ok">Accepting deposits and reservations</Pill> : <Pill tone="warn">Inactive. Refunds and releases still work</Pill>}</dd></div>
            <div><dt className="text-muted">Owner</dt><dd><a className="link mono" href={addressUrl(p.owner)} target="_blank" rel="noopener noreferrer">{shortAddr(p.owner)}</a></dd></div>
            <div><dt className="text-muted">Payout wallet (version {p.payoutVersion})</dt><dd><a className="link mono" href={addressUrl(p.payoutWallet)} target="_blank" rel="noopener noreferrer">{shortAddr(p.payoutWallet)}</a></dd></div>
          </dl>
        )}
        <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
          {([["Total settled", formatUsdc(total)], ["Settled, last 24h", formatUsdc(last24)], ["Awaiting acceptance", String(open.length)], ["Credits outstanding", p ? formatUsdc(p.outstanding) : "…"]] as const).map(([l, v]) => (
            <div key={l} className="bg-surface p-3.5"><dt className="text-xs text-muted">{l}</dt><dd className="money text-lg font-medium">{v}</dd></div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-faint">Totals are derived from contract events; outstanding is read from the contract. Outstanding credits belong to customers, not to the provider.</p>
      </section>

      <section className="card p-5" aria-labelledby="ut">
        <h2 id="ut" className="text-base font-semibold">Usage</h2>
        {act.isPending ? <p className="py-4 text-sm text-faint">Reading events…</p> : mine.length === 0 ? <p className="py-4 text-sm text-muted">No reservations or settlements yet.</p> : (
          <div className="overflow-x-auto">
            <table className="mt-2 hidden w-full text-left text-sm md:table">
              <thead className="text-xs text-muted"><tr><th className="py-2 pr-4 font-medium">Reservation</th><th className="pr-4 font-medium">Customer</th><th className="pr-4 font-medium">State</th><th className="pr-4 text-right font-medium">Amount (USDC)</th><th className="font-medium">Transaction</th></tr></thead>
              <tbody className="divide-y divide-line">
                {mine.filter((e) => e.kind === "settle" || e.kind === "reserve" || e.kind === "release").map((e) => (
                  <tr key={`${e.txHash}-${e.logIndex}`}><td className="py-2 pr-4 tnum">#{e.reservationId?.toString()}</td><td className="pr-4 mono">{shortAddr(e.customer)}</td>
                    <td className="pr-4">{e.kind === "settle" ? <Pill tone="ok">Settled</Pill> : e.kind === "release" ? <Pill tone="warn">Released</Pill> : <Pill tone="info">Reserved</Pill>}</td>
                    <td className="money pr-4 text-right">{formatUsdc(e.amount)}</td><td><a className="link mono" href={txUrl(e.txHash)} target="_blank" rel="noopener noreferrer">{e.txHash.slice(0, 10)}…</a></td></tr>
                ))}
              </tbody>
            </table>
            <ul className="mt-2 divide-y divide-line md:hidden">
              {mine.filter((e) => e.kind === "settle" || e.kind === "reserve" || e.kind === "release").map((e) => (
                <li key={`${e.txHash}-${e.logIndex}`} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <div><p className="tnum font-medium">#{e.reservationId?.toString()} · {e.kind === "settle" ? "Settled" : e.kind === "release" ? "Released" : "Reserved"}</p><p className="mono text-xs text-faint">{shortAddr(e.customer)}</p></div>
                  <div className="text-right"><p className="money">{formatUsdc(e.amount)}</p><a className="link text-xs" href={txUrl(e.txHash)} target="_blank" rel="noopener noreferrer">tx</a></div>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-2 text-xs text-faint">A state of Settled means the customer signed acceptance and the contract paid out. Responses delivered but not accepted never appear here as revenue.</p>
      </section>

      <section className="card space-y-4 p-5" aria-labelledby="ps">
        <h2 id="ps" className="text-base font-semibold">Settings (owner only)</h2>
        {!isOwner ? <p className="text-sm text-muted">Connect the provider owner wallet to change the payout wallet or status. Existing signed authorisations stay bound to the payout wallet they were signed for.</p> : (
          <>
            <div>
              <label className="label" htmlFor="np">New payout wallet</label>
              <div className="mt-1.5 flex gap-2"><input id="np" className="input mono" value={newPayout} onChange={(e) => setNewPayout(e.target.value)} placeholder="0x…" />
                <button className="btn btn-secondary" disabled={!ready || payoutTx.busy || !isAddress(newPayout)} onClick={() => payoutTx.run({ address: vault, abi: unspentVaultAbi, functionName: "updateProviderPayout", args: [PROVIDER_ID!, newPayout as Address] })}>Update</button></div>
              <p className="mt-1 text-xs text-faint">Bumps the payout version. Older reservation signatures can no longer be submitted; reservations already open still pay the wallet they were bound to.</p>
              <TxStatus state={payoutTx.state} onReset={payoutTx.reset} confirmedText="Payout wallet updated." />
            </div>
            <div>
              <button className="btn btn-secondary" disabled={!ready || activeTx.busy || !p} onClick={() => activeTx.run({ address: vault, abi: unspentVaultAbi, functionName: "setProviderActive", args: [PROVIDER_ID!, !p!.active] })}>{p?.active ? "Deactivate new deposits and reservations" : "Reactivate provider"}</button>
              <p className="mt-1 text-xs text-faint">Deactivating never blocks customer refunds or expiry releases.</p>
              <TxStatus state={activeTx.state} onReset={activeTx.reset} confirmedText="Provider status updated." />
            </div>
          </>
        )}
        <details className="rounded-xl border border-line p-3.5">
          <summary className="cursor-pointer text-sm font-medium">Register a new provider</summary>
          <div className="mt-3 space-y-3">
            <div><label className="label" htmlFor="rn">Service name (hashed onchain)</label><input id="rn" className="input mt-1.5" value={regName} onChange={(e) => setRegName(e.target.value)} /></div>
            <div><label className="label" htmlFor="rp">Payout wallet</label><input id="rp" className="input mono mt-1.5" value={regPayout} onChange={(e) => setRegPayout(e.target.value)} placeholder="0x…" /></div>
            <button className="btn btn-secondary" disabled={!ready || regTx.busy || !isAddress(regPayout) || !regName.trim()} onClick={() => regTx.run({ address: vault, abi: unspentVaultAbi, functionName: "registerProvider", args: [regPayout as Address, keccak256(stringToHex(JSON.stringify({ name: regName.trim() })))] })}>Register provider</button>
            <TxStatus state={regTx.state} onReset={regTx.reset} confirmedText="Provider registered. Find your provider ID in the ProviderRegistered event of this transaction." />
          </div>
        </details>
      </section>

      <DemoControls status={backend.kind} />
    </div>
  );
}

function DemoControls({ status }: { status: string }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function toggle(active: boolean) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/v1/demo/outage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, active, minutes: 10 }) });
      const j = await res.json();
      setMsg(res.ok ? (active ? "Simulated outage is ON for up to 10 minutes. It only affects this sample service." : "Simulated outage is OFF.") : `Rejected: ${j.message ?? j.code}`);
    } catch { setMsg("The sample backend is unreachable, so the toggle could not be sent. If you started an outage, it ends automatically after 10 minutes."); }
    setBusy(false);
  }
  return (
    <section className="card p-5" aria-labelledby="dc">
      <h2 id="dc" className="text-base font-semibold">Demo controls: simulated backend outage</h2>
      <p className="mt-1 text-sm text-muted">Operator-only. This turns off the sample billing API on purpose, so you can show that balances and refunds still work through the independent recovery client. It is a controlled demo, not a real outage at any third-party service, and it never touches contract state.</p>
      <p className="mt-2 text-sm">Backend now: <Pill tone={status === "online" ? "ok" : "warn"}>{status === "simulated-outage" ? "SIMULATED OUTAGE" : status}</Pill></p>
      <div className="mt-3 flex flex-wrap gap-2">
        <label htmlFor="op" className="sr-only">Operator token</label>
        <input id="op" type="password" className="input max-w-xs" placeholder="Operator token" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
        <button className="btn btn-danger" disabled={busy || !token} onClick={() => toggle(true)}>Start simulated outage</button>
        <button className="btn btn-secondary" disabled={busy || !token} onClick={() => toggle(false)}>End outage</button>
      </div>
      {msg ? <p className="mt-2 text-sm text-muted" role="status">{msg}</p> : null}
      <p className="mt-2 text-xs text-faint">The token is DEMO_OPERATOR_TOKEN in the server's .env. It is kept only in this form and never stored.</p>
    </section>
  );
}
