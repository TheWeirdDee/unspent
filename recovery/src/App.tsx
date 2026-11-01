import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatUnits, isAddress, pad, parseAbiItem, toEventSelector, toHex, type Address, type Hex } from "viem";
import { unspentVaultAbi } from "./contracts/abi";
import { deployments, type NetworkKey } from "./contracts/deployments";
import { buildClients, customRpc, fmt, parse, pickNetwork, short, type Clients } from "./chain";
import { BUILD_COMMIT } from "./build";
import { useSession, useWallets } from "./wallet";

type Theme = "light" | "dark" | "system";
interface Acct { available: bigint; reserved: bigint; deposited: bigint; settled: bigint; refunded: bigint; block: bigint; at: number }
interface OpenRes { id: bigint; amount: bigint; expiry: bigint }
type Tx =
  | { phase: "idle" }
  | { phase: "wallet" }
  | { phase: "submitted"; hash: Hex; issue?: boolean; long?: boolean }
  | { phase: "ok"; hash: Hex }
  | { phase: "reverted"; hash: Hex }
  | { phase: "error"; msg: string; hash?: Hex };

const EV_RESERVED = parseAbiItem("event UsageReserved(uint256 indexed reservationId, uint256 indexed providerId, address indexed customer, uint256 amount, uint256 expiry, bytes32 requestHash)");
const EV_SETTLED = parseAbiItem("event UsageSettled(uint256 indexed reservationId, uint256 indexed providerId, address indexed customer, uint256 amount, bytes32 responseHash, address payoutWallet)");
const EV_RELEASED = parseAbiItem("event ReservationReleased(uint256 indexed reservationId, uint256 indexed providerId, address indexed customer, uint256 amount)");

function errText(e: unknown): string {
  const x = e as { code?: number; shortMessage?: string; message?: string };
  const t = `${x.shortMessage ?? ""} ${x.message ?? ""}`.toLowerCase();
  if (x.code === 4001 || t.includes("user rejected") || t.includes("user denied")) return "You rejected the request in your wallet. Nothing was sent.";
  if (t.includes("insufficient funds")) return "Not enough USDC for gas. Arc uses USDC for gas; add a small amount and retry.";
  if (t.includes("insufficientavailable")) return "More than your available credits.";
  if (t.includes("reservationnotexpired")) return "This reservation has not reached its expiry time yet.";
  if (t.includes("reservationnotopen")) return "This reservation was already settled or released.";
  return (x.shortMessage ?? x.message ?? "The request failed.").split("\n")[0];
}

export default function App() {
  const [net, setNet] = useState<NetworkKey>(pickNetwork);
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("unspent-theme") as Theme) || "system");
  const [rpcDraft, setRpcDraft] = useState("");
  const [rpcTick, setRpcTick] = useState(0);
  // rpcTick forces new clients after the user adds an RPC endpoint.
  const c: Clients = useMemo(() => buildClients(net), [net, rpcTick]); // eslint-disable-line
  const wallets = useWallets();
  const { session, connect, disconnect, switchTo, walletClient, error: connError } = useSession();
  const [viewAddr, setViewAddr] = useState("");
  const [providerText, setProviderText] = useState(String(deployments[net].providerId ?? ""));
  const [acct, setAcct] = useState<Acct | null>(null);
  const [resv, setResv] = useState<OpenRes[] | null>(null);
  const [readErr, setReadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [amountText, setAmountText] = useState("");
  const [tx, setTx] = useState<Tx>({ phase: "idle" });
  const [gas, setGas] = useState("");
  const [relTx, setRelTx] = useState<Tx>({ phase: "idle" });

  useEffect(() => {
    const r = theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
    document.documentElement.dataset.theme = r;
    localStorage.setItem("unspent-theme", theme);
  }, [theme]);
  useEffect(() => {
    setProviderText(String(deployments[net].providerId ?? ""));
    setAcct(null);
    setResv(null);
    localStorage.setItem("unspent-recovery-network", net);
  }, [net]);

  const customer: Address | null = session?.address ?? (isAddress(viewAddr) ? (viewAddr as Address) : null);
  const providerId = /^\d+$/.test(providerText) ? BigInt(providerText) : null;
  const wrongNet = Boolean(session && session.chainId !== c.dep.chainId);
  const demo = new URLSearchParams(location.search).get("demo") === "simulated-outage";

  // Everything shown is scoped to this key. A load that finishes after the selection changed is discarded, so figures for an
  // earlier address or network can never be drawn beside the current one.
  const viewKey = `${net}:${c.vault ?? ""}:${customer ?? ""}:${providerId ?? ""}`;
  const viewKeyRef = useRef(viewKey);
  viewKeyRef.current = viewKey;
  useEffect(() => { setAcct(null); setResv(null); setReadErr(null); }, [viewKey]);

  const scan = useRef<{ key: string; next: bigint; reserved: Set<string>; closed: Set<string> }>({ key: "", next: 0n, reserved: new Set(), closed: new Set() });
  const load = useCallback(async () => {
    if (!c.vault || !customer || providerId === null) return;
    const loadKey = viewKey;
    const stale = () => viewKeyRef.current !== loadKey;
    setLoading(true);
    try {
      const block = await c.publicClient.getBlockNumber();
      if (stale()) return;
      const [a, r, d, s, rf] = await c.publicClient.readContract({ address: c.vault, abi: unspentVaultAbi, functionName: "getAccount", args: [providerId, customer], blockNumber: block });
      if (stale()) return;
      setAcct({ available: a, reserved: r, deposited: d, settled: s, refunded: rf, block, at: Date.now() });
      // One filtered eth_getLogs per block range (customer and provider are indexed topics), scanned
      // incrementally: the first load walks from the deployment block, later polls read only new blocks.
      const key = `${c.dep.chainId}:${c.vault}:${customer}:${providerId}`;
      if (scan.current.key !== key) scan.current = { key, next: BigInt(c.dep.deploymentBlock ?? 0), reserved: new Set(), closed: new Set() };
      const sc = scan.current;
      const topics = [[toEventSelector(EV_RESERVED), toEventSelector(EV_SETTLED), toEventSelector(EV_RELEASED)], null, pad(toHex(providerId), { size: 32 }), pad(customer, { size: 32 })];
      let step = 20_000n;
      for (let start = sc.next; start <= block; ) {
        const end = start + step - 1n > block ? block : start + step - 1n;
        try {
          const logs = (await c.publicClient.request({ method: "eth_getLogs", params: [{ address: c.vault, fromBlock: toHex(start), toBlock: toHex(end), topics }] as never })) as { topics: Hex[] }[];
          if (stale()) return;
          for (const l of logs) {
            const id = BigInt(l.topics[1]!).toString();
            if (l.topics[0] === toEventSelector(EV_RESERVED)) sc.reserved.add(id);
            else sc.closed.add(id);
          }
          start = end + 1n;
          sc.next = start;
        } catch (e) {
          if (step > 1_000n) step /= 2n;
          else throw e;
        }
      }
      const reserved = [...sc.reserved].map((id) => ({ id: BigInt(id) }));
      const closed = sc.closed;
      const open: OpenRes[] = [];
      for (const x of reserved.filter((x) => !closed.has(x.id.toString()))) {
        const rr = await c.publicClient.readContract({ address: c.vault, abi: unspentVaultAbi, functionName: "getReservation", args: [x.id], blockNumber: block });
        if (stale()) return;
        if (rr.status === 1) open.push({ id: x.id, amount: rr.maxAmount, expiry: rr.expiry });
      }
      setResv(open);
      setReadErr(null);
    } catch {
      if (!stale()) setReadErr("Onchain data temporarily unavailable. No funds have moved.");
    } finally {
      if (!stale()) setLoading(false);
    }
  }, [c, customer, providerId, viewKey]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  const amount = parse(amountText);
  const amtErr = amount === null || amount <= 0n ? "Enter an amount greater than 0 with up to 6 decimals." : acct && amount > acct.available ? "More than your available credits." : null;

  useEffect(() => {
    if (!drawer || !session || !c.vault || providerId === null || amtErr || amount === null || wrongNet) { setGas(""); return; }
    (async () => {
      try {
        const [g, p] = await Promise.all([
          c.publicClient.estimateContractGas({ address: c.vault!, abi: unspentVaultAbi, functionName: "refund", args: [providerId, amount], account: session.address }),
          c.publicClient.getGasPrice(),
        ]);
        setGas(`about ${Number(formatUnits(g * p, 18)).toFixed(6)} USDC (native gas view)`);
      } catch { setGas("unavailable"); }
    })();
  }, [drawer, amount, amtErr, session, wrongNet, c, providerId]);

  async function send(kind: "refund" | "release", id?: bigint) {
    const set = kind === "refund" ? setTx : setRelTx;
    if (!session || !c.vault || providerId === null) return;
    const wc = walletClient(c.chain);
    if (!wc) return;
    set({ phase: "wallet" });
    let hash: Hex;
    try {
      hash = kind === "refund"
        ? await wc.writeContract({ address: c.vault, abi: unspentVaultAbi, functionName: "refund", args: [providerId, amount!], account: session.address, chain: c.chain })
        : await wc.writeContract({ address: c.vault, abi: unspentVaultAbi, functionName: "releaseExpired", args: [id!], account: session.address, chain: c.chain });
    } catch (e) { set({ phase: "error", msg: errText(e) }); return; }
    set({ phase: "submitted", hash });
    // Submitted: from here only reconcile by hash. A failed read (e.g. HTTP 429) never counts as success or
    // failure, and the action stays locked so the same transaction cannot be sent twice.
    const started = Date.now();
    let issue = false;
    for (;;) {
      try {
        const rc = await c.publicClient.getTransactionReceipt({ hash });
        set(rc.status === "success" ? { phase: "ok", hash } : { phase: "reverted", hash });
        await load();
        return;
      } catch (e) {
        const notFound = (e as { name?: string }).name === "TransactionReceiptNotFoundError";
        issue = !notFound;
      }
      const waited = Date.now() - started;
      set({ phase: "submitted", hash, issue, long: waited > 120_000 });
      await new Promise((r) => setTimeout(r, waited < 30_000 ? 2_000 : 8_000));
      if (waited > 30 * 60_000) return;
    }
  }

  const txLink = (h: string) => <a className="link" href={`${c.dep.explorer}/tx/${h}`} target="_blank" rel="noopener noreferrer">View on Arc Explorer</a>;
  const status = (t: Tx, okText: string) =>
    t.phase === "idle" ? null : (
      <p role="status" className={`mt-3 rounded-lg p-3 text-sm ${t.phase === "ok" ? "bg-accentsoft text-accent" : t.phase === "error" || t.phase === "reverted" ? "bg-badsoft text-bad" : "bg-surface2 text-muted"}`}>
        {t.phase === "wallet" ? "Awaiting wallet approval. Nothing has been sent yet."
          : t.phase === "submitted" ? <>Submitted. Waiting for confirmation.{t.issue ? " The chain could not be read just now (the RPC may be rate limiting). Your transaction was already submitted and will not be sent again; checking again automatically." : ""}{t.long ? " Taking longer than usual: it may still confirm, so check the explorer before trying again." : ""} {txLink(t.hash)}</>
          : t.phase === "ok" ? <>Confirmed. {okText} {txLink(t.hash)}</>
          : t.phase === "reverted" ? <>Reverted onchain. No funds moved. {txLink(t.hash)}</>
          : <>{t.msg} {t.hash ? txLink(t.hash) : null}</>}
      </p>
    );
  const nowS = Math.floor(Date.now() / 1000);

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <span className="inline-flex items-center gap-2 font-display text-lg font-semibold">
            <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M9.5 7v10.5a6.5 6.5 0 0 0 13 0V7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /><circle cx="16" cy="14.5" r="3" fill="var(--accent)" /></svg>
            UNSPENT <span className="font-normal text-muted">Recovery</span>
          </span>
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="net">Network</label>
            <select id="net" className="input !min-h-9 !w-auto !py-0 text-sm" value={net} onChange={(e) => setNet(e.target.value as NetworkKey)}>
              <option value="testnet">Arc Testnet</option>
              <option value="mainnet" disabled={!deployments.mainnet.vault}>Arc mainnet{deployments.mainnet.vault ? "" : " (not deployed)"}</option>
            </select>
            <div role="radiogroup" aria-label="Color theme" className="inline-flex rounded-lg border border-line p-0.5 text-xs">
              {(["light", "system", "dark"] as Theme[]).map((t) => (
                <button key={t} role="radio" aria-checked={theme === t} onClick={() => setTheme(t)} className={`rounded-md px-2 py-1.5 capitalize ${theme === t ? "bg-surface2 text-fg" : "text-faint"}`}>{t}</button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        {demo ? <div role="alert" className="rounded-xl border border-warn/40 bg-warnsoft p-3 text-center text-sm font-semibold tracking-wide text-warn">SIMULATED APPLICATION BACKEND OUTAGE: controlled demo on the UNSPENT sample service. This page does not use that service; the chain and wallet below are live.</div> : null}
        <div>
          <h1 className="text-3xl font-semibold">Your funds, even if an app goes offline.</h1>
          <p className="mt-2 flex items-start gap-2 text-sm text-muted"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />Connected directly to {c.dep.name}; provider API is not required. This page has no login, database, indexer or relayer.</p>
        </div>

        <section className="card p-5" aria-label="Configuration">
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">Network</dt><dd>{c.dep.name} · chain {c.dep.chainId}</dd></div>
            <div><dt className="text-muted">Vault contract</dt><dd className="mono break-all">{c.vault ? <a className="link" href={`${c.dep.explorer}/address/${c.vault}`} target="_blank" rel="noopener noreferrer">{c.vault}</a> : "Not deployed on this network"}</dd></div>
            <div><dt className="text-muted">RPC in use (first, with fallbacks)</dt><dd className="mono break-all">{c.transportUrls[0]}{c.transportUrls[0] !== c.urls[0] ? <span className="block text-xs text-faint">then {c.urls.join(", ")}</span> : null}</dd></div>
            <div><dt className="text-muted">Provider ID</dt><dd><label className="sr-only" htmlFor="pid">Provider ID</label><input id="pid" className="input !min-h-9 !w-24" inputMode="numeric" value={providerText} onChange={(e) => setProviderText(e.target.value)} aria-invalid={providerId === null} /></dd></div>
          </dl>
        </section>

        <section className="card p-5" aria-label="Wallet">
          {session ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 text-sm"><span className="text-muted">Connected: </span><span className="mono break-all">{session.address}</span> <span className="text-faint">({session.wallet.name})</span></p>
              <button className="btn btn-secondary btn-sm" onClick={disconnect}>Disconnect</button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="label">Connect a wallet</p>
              <div className="flex flex-wrap gap-2">
                {wallets.map((w) => <button key={w.uuid} className="btn btn-secondary" onClick={() => connect(w)}>{w.icon ? <img src={w.icon} alt="" width={20} height={20} /> : null}{w.name}</button>)}
                {wallets.length === 0 ? <p className="text-sm text-warn">No browser wallet detected. Install one and reload, or use the read-only view below.</p> : null}
              </div>
              {connError ? <p role="alert" className="text-sm text-bad">{connError}</p> : null}
              <div>
                <label className="text-sm text-muted" htmlFor="va">Or view any address (read-only)</label>
                <input id="va" className="input mono mt-1" placeholder="0x…" value={viewAddr} onChange={(e) => setViewAddr(e.target.value.trim())} aria-invalid={viewAddr !== "" && !isAddress(viewAddr)} />
              </div>
            </div>
          )}
          {wrongNet ? (
            <p role="alert" className="mt-3 rounded-lg bg-warnsoft p-3 text-sm text-warn">Your wallet is on chain {session!.chainId}; this page needs {c.dep.name} (chain {c.dep.chainId}). <button className="btn btn-primary btn-sm ml-2" onClick={() => switchTo(c.chain).catch(() => undefined)}>Switch network</button></p>
          ) : null}
        </section>

        {readErr ? <p role="alert" className="rounded-xl border border-bad/30 bg-badsoft p-3.5 text-sm text-bad">{readErr} <button className="underline" onClick={() => void load()}>Retry</button>, or add another RPC below.</p> : null}

        {customer && c.vault ? (
          <section className="card p-5 sm:p-6" aria-labelledby="bal">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="bal" className="label">Refundable now</h2>
              <span className="text-xs text-faint tnum" role="status">{loading && !acct ? "Reading the contract…" : acct ? `${readErr ? "Last known, not current: " : ""}read at block ${acct.block} · ${new Date(acct.at).toLocaleTimeString()}` : ""}</span>
            </div>
            <p className={`money mt-2 font-display text-5xl font-semibold ${readErr ? "opacity-60" : ""}`}>{acct ? fmt(acct.available) : "—"} <span className="text-2xl font-medium text-faint">USDC</span></p>
            <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
              {([["Available", "Refundable now", acct?.available], ["Reserved", "Locked in-flight", acct?.reserved], ["Spent", "Paid to provider", acct?.settled], ["Refunded", "Already withdrawn", acct?.refunded]] as const).map(([l, h, v]) => (
                <div key={l} className="bg-surface p-3.5"><dt className="text-xs text-muted">{l}</dt><dd className="money text-lg font-medium">{v === undefined ? "—" : fmt(v)}</dd><p className="text-xs text-faint">{h}</p></div>
              ))}
            </dl>
            <div className="mt-5">
              <button className="btn btn-primary" disabled={!session || wrongNet || !acct || acct.available === 0n} onClick={() => { setTx({ phase: "idle" }); setAmountText(acct ? fmt(acct.available) : ""); setDrawer(true); }}>Refund to my wallet</button>
              {!session ? <p className="mt-2 text-xs text-faint">Connect your wallet to refund. The destination is always the connected account.</p> : acct && acct.available === 0n ? <p className="mt-2 text-xs text-faint">Nothing available to refund.</p> : null}
            </div>
          </section>
        ) : <p className="text-sm text-muted">{c.vault ? "Connect a wallet or enter an address to read an account." : "No vault is deployed on this network."}</p>}

        {customer && resv && resv.length > 0 ? (
          <section className="card p-5" aria-labelledby="rs">
            <h2 id="rs" className="text-base font-semibold">Reserved requests</h2>
            <p className="mt-1 text-sm text-muted">Reserved credits cannot be refunded. After the expiry time anyone can release them back to Available (not directly to the wallet).</p>
            <ul className="mt-3 divide-y divide-line">
              {resv.map((r) => {
                const expired = nowS >= Number(r.expiry);
                return (
                  <li key={r.id.toString()} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div><p className="text-sm font-medium">Reservation #{r.id.toString()} · <span className="money">{fmt(r.amount)} USDC</span></p><p className="text-xs text-muted tnum">{expired ? "Expired" : "Expires"} {new Date(Number(r.expiry) * 1000).toLocaleString()}</p></div>
                    <button className="btn btn-secondary btn-sm" disabled={!session || wrongNet || !expired || relTx.phase === "wallet" || relTx.phase === "submitted"} title={!expired ? "Release is allowed after the expiry time" : undefined} onClick={() => send("release", r.id)}>Release expired reserve</button>
                  </li>
                );
              })}
            </ul>
            {status(relTx, "The reservation returned to your available credits.")}
          </section>
        ) : null}

        <section className="card p-5" aria-labelledby="rpc">
          <h2 id="rpc" className="text-base font-semibold">RPC settings</h2>
          <p className="mt-1 text-sm text-muted">If the default RPC fails, add another Arc RPC endpoint you trust. It is stored only in this browser.</p>
          <div className="mt-3 flex gap-2">
            <label className="sr-only" htmlFor="rpcin">RPC URL</label>
            <input id="rpcin" className="input mono" placeholder="https://…" value={rpcDraft} onChange={(e) => setRpcDraft(e.target.value)} />
            <button className="btn btn-secondary" disabled={!rpcDraft.startsWith("https://")} onClick={() => { localStorage.setItem(`unspent-rpc-${net}`, JSON.stringify([rpcDraft, ...customRpc(net)])); setRpcDraft(""); setRpcTick((t) => t + 1); }}>Add</button>
          </div>
        </section>

        <section className="text-sm leading-relaxed text-muted" aria-label="Limits">
          <p><strong className="text-fg">What this cannot do:</strong> return credits already paid to a provider, prove an API worked, or move funds if the token issuer or network blocks transfers to your address. You need a small amount of USDC for gas.</p>
          <p className="mt-2">Prefer no web page at all? Call <span className="mono">getAccount</span> and <span className="mono">refund</span> on the contract with <span className="mono">cast</span> or a block explorer.</p>
        </section>
      </main>

      {drawer ? (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/60 p-3 sm:place-items-center" onMouseDown={(e) => e.target === e.currentTarget && setDrawer(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="dt" className="card w-full max-w-md p-5 shadow-2xl">
            <h2 id="dt" className="text-lg font-semibold">Confirm refund</h2>
            <label className="label mt-4 block" htmlFor="ra">Amount (USDC)</label>
            <div className="mt-1.5 flex gap-2">
              <input id="ra" className="input" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} aria-invalid={Boolean(amtErr)} />
              <button className="btn btn-secondary" onClick={() => acct && setAmountText(fmt(acct.available))}>Max</button>
            </div>
            {amtErr ? <p className="mt-1 text-xs text-bad">{amtErr}</p> : null}
            <dl className="mt-4 space-y-1.5 rounded-xl bg-surface2 p-3.5 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-muted">Recipient</dt><dd className="mono truncate">{session?.address}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted">Contract</dt><dd className="mono">{c.vault ? short(c.vault) : ""}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted">Available after</dt><dd className="money">{acct && amount !== null && !amtErr ? fmt(acct.available - amount) : "—"} USDC</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted">Estimated gas</dt><dd className="text-right">{gas || "—"}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-faint">Irreversible once confirmed. The contract can only send these funds to the wallet that signs.</p>
            <div className="mt-4 flex gap-2">
              <button className="btn btn-primary flex-1" disabled={Boolean(amtErr) || tx.phase === "wallet" || tx.phase === "submitted" || tx.phase === "ok"} onClick={() => send("refund")}>Confirm refund</button>
              <button className="btn btn-secondary" onClick={() => setDrawer(false)}>{tx.phase === "ok" ? "Close" : "Cancel"}</button>
            </div>
            {status(tx, "Your USDC was sent back to your wallet.")}
          </div>
        </div>
      ) : null}
      <p className="mx-auto max-w-3xl px-4 pb-8 text-xs text-faint sm:px-6">Recovery client build <span className="mono">{BUILD_COMMIT === "dev" ? "local development build" : BUILD_COMMIT.slice(0, 7)}</span>. No analytics and no calls to the UNSPENT API. Chain reads may pass through a read-only RPC relay on this host.</p>
    </div>
  );
}
