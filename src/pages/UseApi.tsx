import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Circle, Loader2, AlertTriangle } from "lucide-react";
import { useAccountState, useProviderOnchain, useWalletReady, PROVIDER_ID } from "@/hooks/useVault";
import { useUsage, type Flow, type Step } from "@/hooks/useUsage";
import { useProviderMeta } from "@/hooks/useProviderMeta";
import { MAX_INPUT_CHARS, responseHashOf } from "@/lib/protocol";
import { formatUsdc } from "@/lib/money";
import { addressUrl, dep, shortAddr, shortHash, VAULT } from "@/lib/chains";
import { ExplorerLink, Notice } from "@/components/ui";
import { WalletButton } from "@/components/WalletButton";
import { BalanceCard } from "@/components/BalanceCard";
import { OpenReservations } from "@/components/OpenReservations";
import { RECOVERY_URL } from "@/components/Layouts";

const STEPS: { id: Step; label: string }[] = [
  { id: "authorise", label: "Authorise" }, { id: "reserve", label: "Reserve" }, { id: "run", label: "Run" }, { id: "accept", label: "Accept" }, { id: "pay", label: "Pay" },
];
function stepStatus(f: Flow, id: Step): "todo" | "active" | "done" | "failed" {
  const order = STEPS.findIndex((s) => s.id === id);
  if (f.phase === "failed" && f.failedAt === id) return "failed";
  const cur = { idle: -1, quoting: 0, "signing-reserve": 0, reserving: 1, running: 2, reserved: 2, delivered: 3, "signing-accept": 3, settling: 4, paid: 5, failed: STEPS.findIndex((s) => s.id === f.failedAt) }[f.phase];
  if (order < cur) return "done";
  if (order === cur) return f.phase === "delivered" ? "active" : "active";
  return "todo";
}

export default function UseApi() {
  const { address, isConnected, ready } = useWalletReady();
  const acct = useAccountState(address);
  const meta = useProviderMeta();
  const prov = useProviderOnchain();
  const { flow, start, accept, reset, run } = useUsage(PROVIDER_ID);
  const [text, setText] = useState("");

  if (!VAULT || PROVIDER_ID === undefined) return <Notice tone="warn" title={`Not deployed on ${dep.name}`}>No vault or provider is configured for this network.</Notice>;
  if (!isConnected) return <div className="mx-auto max-w-lg py-10 text-center"><h1 className="text-3xl font-semibold">Use the API</h1><p className="mt-3 text-muted">Connect your wallet to spend credits on a real API request.</p><div className="mt-6 flex justify-center"><WalletButton /></div></div>;

  const available = acct.data?.available;
  const enough = available !== undefined && available >= 100_000n;
  const busy = ["quoting", "signing-reserve", "reserving", "running", "signing-accept", "settling"].includes(flow.phase);
  const trimmed = text.trim();
  const disabledReason = !ready ? "Switch to the correct network first." : !meta.data ? "Provider details are unavailable right now (the provider API did not answer). Your funds are unaffected; you can still withdraw from the recovery page." : !acct.data ? "Reading your balance from the contract…" : !enough ? "You need at least 0.10 available credits. Buy credits first." : !trimmed ? "Enter some text to summarise." : prov.data && !prov.data.active ? "The provider is not accepting new requests." : null;
  const f = flow;
  // Computed in this browser from the exact text on screen: the signature must bind the text the customer read, not a hash the API supplied.
  const hashOk = (() => { try { return Boolean(f.result) && responseHashOf(f.result!.output).toLowerCase() === f.result!.responseHash.toLowerCase(); } catch { return false; } })();
  const amountTxt = (() => { try { return f.result ? formatUsdc(BigInt(f.result.usageAmountMicrounits)) : "—"; } catch { return "an unreadable amount"; } })();
  const priceTxt = meta.data?.displayPriceUsdc ?? null; // never assume a price when the provider API cannot be reached

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold">Use the API</h1>
        <p className="mt-1 text-sm text-muted">TextLab / Summarise. A real language model turns your text into three bullets. You pay only after you accept the result.</p>
      </header>

      {f.resumed ? <Notice tone="info" title="Resumed your request">This request was restored after a refresh or navigation, and its state was re-read from the API and the contract. Your text is not stored: {f.phase === "reserved" ? "paste the same text below to run it, or let the reservation expire and release it." : "nothing needs to be re-entered for the next step."}</Notice> : null}

      <ol className="grid grid-cols-5 gap-1 text-xs" aria-label="Request progress">
        {STEPS.map((s, i) => {
          const st = stepStatus(f, s.id);
          return (
            <li key={s.id} className={`flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-center ${st === "active" ? "border-accent text-fg" : st === "done" ? "border-line text-accent" : st === "failed" ? "border-bad text-bad" : "border-line text-faint"}`} aria-current={st === "active" ? "step" : undefined}>
              {st === "done" ? <Check size={14} aria-hidden /> : st === "active" ? <Loader2 size={14} className={busy ? "animate-spin" : ""} aria-hidden /> : st === "failed" ? <AlertTriangle size={14} aria-hidden /> : <Circle size={14} aria-hidden />}
              <span>{i + 1}. {s.label}</span>
              <span className="sr-only">{st}</span>
            </li>
          );
        })}
      </ol>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card space-y-4 p-5" aria-labelledby="compose">
          <h2 id="compose" className="label">Compose</h2>
          <div>
            <label htmlFor="api-text" className="text-sm font-medium">Text to summarise</label>
            <textarea id="api-text" className="input mt-1.5" maxLength={MAX_INPUT_CHARS} value={text} onChange={(e) => setText(e.target.value)} disabled={busy || f.phase === "delivered" || f.phase === "paid"} placeholder="Paste a paragraph or two. Only its hash goes onchain; the text goes to the sample API only after your reservation confirms." />
            <p className="mt-1 text-right text-xs text-faint tnum">{text.length}/{MAX_INPUT_CHARS}</p>
          </div>
          <dl className="space-y-1 rounded-xl bg-surface2 p-3.5 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Price per request</dt><dd className="money">{priceTxt ? `${priceTxt} USDC` : "Unavailable"}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Available credits</dt><dd className="money">{available !== undefined ? formatUsdc(available) : "…"} USDC</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Paid to</dt><dd className="mono">{prov.data ? <a className="link" href={addressUrl(prov.data.payoutWallet)} target="_blank" rel="noopener noreferrer">{shortAddr(prov.data.payoutWallet)}</a> : "…"}</dd></div>
          </dl>
          {f.phase === "reserved" ? (
            <button className="btn btn-primary w-full" disabled={!trimmed} onClick={() => run(trimmed)}>Run the reserved request</button>
          ) : (
            <button className="btn btn-primary w-full" disabled={busy || Boolean(disabledReason) || f.phase !== "idle" && f.phase !== "failed"} onClick={() => start(trimmed)}>
              {busy && f.phase !== "delivered" ? "Working…" : `Reserve ${priceTxt ?? "…"} and run`}
            </button>
          )}
          {disabledReason && f.phase === "idle" ? <p className="text-xs text-faint">{disabledReason}</p> : null}
          <p className="text-xs text-faint">You sign a limit of 0.10 USDC, nothing more. Funds move to the provider only after you accept the response.</p>
        </section>

        <section className="space-y-3" aria-labelledby="run" aria-live="polite">
          <h2 id="run" className="label">Run</h2>
          <Panel n={1} title="Authorisation" active={f.phase === "quoting" || f.phase === "signing-reserve"} done={Boolean(f.quote) && f.phase !== "signing-reserve" && f.phase !== "quoting"}>
            {f.quote ? <>Max {formatUsdc(BigInt(f.quote.maxAmountMicrounits))} USDC to provider {f.quote.providerId} · request <span className="mono">{shortHash(f.quote.requestHash)}</span>. {f.phase === "signing-reserve" ? "Awaiting your signature in the wallet." : "Signed."}</> : f.phase === "quoting" ? "Requesting a quote…" : "Nothing signed yet."}
          </Panel>
          <Panel n={2} title="Onchain reserve" active={f.phase === "reserving"} done={Boolean(f.reserveTx)}>
            {f.reserveTx ? <>Confirmed. Reservation #{f.reservationId}. <ExplorerLink hash={f.reserveTx} /></> : f.phase === "reserving" ? "Submitting the reservation; the service runs only after it confirms." : "Not started."}
          </Panel>
          <Panel n={3} title="Service output" active={f.phase === "running"} done={Boolean(f.result)}>
            {f.result ? (
              <div className="space-y-2">
                <pre className="whitespace-pre-wrap rounded-lg bg-bg p-3 font-sans text-sm leading-relaxed text-fg">{f.result.output || "The response text is no longer retained."}</pre>
                <p className="text-xs text-faint tnum">{f.result.serviceModel} · {f.result.latencyMs} ms · response hash <span className="mono">{shortHash(f.result.responseHash)}</span></p>
              </div>
            ) : f.phase === "running" ? "Calling the model…" : f.phase === "reserved" ? "The reservation is confirmed. Paste the same text and run it; the service has not run yet." : "Waiting for a confirmed reservation."}
          </Panel>
          <Panel n={4} title="Accept result and pay" active={f.phase === "delivered" || f.phase === "signing-accept" || f.phase === "settling"} done={f.phase === "paid"}>
            {f.phase === "paid" && f.settleTx ? <>Paid {amountTxt} USDC to TextLab. <ExplorerLink hash={f.settleTx} /></>
              : f.result ? (
                <div className="space-y-2">
                  <p>Pay {amountTxt} USDC to <span className="mono">{prov.data ? shortAddr(prov.data.payoutWallet) : "the provider"}</span>. Your signature authorises exactly this response hash and amount.</p>
                  {hashOk
                    ? <p className="text-xs text-faint">Checked in your browser: this text hashes to the response hash you are about to sign.</p>
                    : <p role="alert" className="text-xs text-bad">This text does not match its response hash. Do not accept it.</p>}
                  <button className="btn btn-primary" disabled={!ready || !hashOk || f.phase === "signing-accept" || f.phase === "settling"} onClick={accept}>
                    {f.phase === "signing-accept" ? "Awaiting signature…" : f.phase === "settling" ? "Settling onchain…" : `Accept & release ${priceTxt} USDC to TextLab`}
                  </button>
                </div>
              ) : "Available after the response arrives. No automatic settlement ever happens."}
          </Panel>

          {f.error ? (
            f.error.code === "REJECTED" ? <Notice tone="warn" title="Cancelled in wallet">{f.error.message} {f.phase === "failed" ? "No charge was made." : "You can accept again at any time before expiry."}</Notice>
            : f.error.backendDown ? <Notice tone="bad" title="Billing backend unavailable" action={<a className="btn btn-secondary btn-sm" href={RECOVERY_URL}>Open the independent recovery client</a>}>{f.error.message} Your credits are on the contract and can be read and withdrawn without this backend.{f.reservationId && !f.result ? ` Reservation #${f.reservationId} stays reserved until it expires.` : ""}</Notice>
            : f.failedAt === "run" ? <Notice tone="bad" title="No completed result">{f.error.message} Your 0.10 stays reserved until it expires, then you can release it below. It is not refunded until that happens onchain.</Notice>
            : <Notice tone="bad" title={`Could not complete: ${f.error.code}`}>{f.error.message}</Notice>
          ) : null}
          {(f.phase === "paid" || f.phase === "failed") ? <button className="btn btn-secondary" onClick={() => { reset(); setText(""); }}>New request</button> : null}
        </section>
      </div>

      <OpenReservations customer={address} />
      <BalanceCard q={acct} />
      <p className="text-xs text-faint">Not enough credits? <Link className="link" to="/app/deposit">Buy more</Link>. The contract guarantees refundability of available credits; it cannot prove the service was good. See <Link className="link" to="/docs#trust">trust assumptions</Link>.</p>
    </div>
  );
}

function Panel({ n, title, active, done, children }: { n: number; title: string; active: boolean; done: boolean; children: React.ReactNode }) {
  return (
    <div className={`card p-4 ${active ? "border-accent" : ""}`}>
      <p className="flex items-center gap-2 text-sm font-medium">
        <span className={`grid h-5 w-5 place-items-center rounded-full text-[0.7rem] tnum ${done ? "bg-accent text-onaccent" : "bg-surface2 text-muted"}`}>{done ? <Check size={12} aria-hidden /> : n}</span>
        {title}
      </p>
      <div className="mt-2 text-sm text-muted">{children}</div>
    </div>
  );
}
