import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, XCircle, Info, Clock } from "lucide-react";
import { arcChain, txUrl } from "@/lib/chains";
import type { TxState } from "@/hooks/useTx";
import { useSwitchChain } from "wagmi";

export function ExplorerLink({ hash, label = "View on Arc Explorer" }: { hash: string; label?: string }) {
  return (
    <a className="link inline-flex items-center gap-1 text-sm" href={txUrl(hash)} target="_blank" rel="noopener noreferrer">
      {label} <ExternalLink size={13} aria-hidden />
    </a>
  );
}

type Tone = "info" | "warn" | "bad" | "ok";
const TONE: Record<Tone, string> = {
  info: "bg-surface2 text-muted border-line",
  warn: "bg-warnsoft text-warn border-warn/30",
  bad: "bg-badsoft text-bad border-bad/30",
  ok: "bg-accentsoft text-accent border-accent/30",
};
const ICON = { info: Info, warn: AlertTriangle, bad: XCircle, ok: CheckCircle2 };

export function Notice({ tone = "info", title, children, action }: { tone?: Tone; title?: string; children?: ReactNode; action?: ReactNode }) {
  const Icon = ICON[tone];
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={`flex gap-3 rounded-xl border p-3.5 text-sm ${TONE[tone]}`}>
      <Icon size={18} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="leading-relaxed [&_a]:underline">{children}</div> : null}
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
    </div>
  );
}

export function TxStatus({ state, confirmedText, onReset }: { state: TxState; confirmedText?: string; onReset?: () => void }) {
  if (state.phase === "idle") return null;
  if (state.phase === "awaiting-wallet")
    return <Notice tone="info" title="Awaiting wallet approval">Confirm the request in your wallet. Nothing has been sent yet.</Notice>;
  if (state.phase === "submitted")
    return (
      <Notice tone="info" title="Transaction submitted">
        <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden /> Waiting for confirmation. Credits and balances do not change until it confirms.</span>
        <div>{state.hash ? <ExplorerLink hash={state.hash} /> : null}</div>
      </Notice>
    );
  if (state.phase === "confirmed")
    return (
      <Notice tone="ok" title="Confirmed" action={onReset ? <button className="btn btn-ghost btn-sm" onClick={onReset}>Dismiss</button> : undefined}>
        {confirmedText}
        <div>{state.hash ? <ExplorerLink hash={state.hash} /> : null}</div>
      </Notice>
    );
  if (state.phase === "reverted")
    return (
      <Notice tone="bad" title="Transaction reverted" action={onReset ? <button className="btn btn-ghost btn-sm" onClick={onReset}>Dismiss</button> : undefined}>
        {state.message}
        <div>{state.hash ? <ExplorerLink hash={state.hash} /> : null}</div>
      </Notice>
    );
  if (state.phase === "rejected")
    return <Notice tone="warn" title="Cancelled in wallet" action={onReset ? <button className="btn btn-ghost btn-sm" onClick={onReset}>Dismiss</button> : undefined}>{state.message}</Notice>;
  return (
    <Notice tone="bad" title="Transaction failed" action={onReset ? <button className="btn btn-ghost btn-sm" onClick={onReset}>Dismiss</button> : undefined}>
      {state.message}
      <div>{state.hash ? <ExplorerLink hash={state.hash} /> : null}</div>
    </Notice>
  );
}

export function WrongNetwork() {
  const { switchChainAsync, isPending, error } = useSwitchChain();
  return (
    <Notice
      tone="warn"
      title={`Wrong network. Switch to ${arcChain.name}.`}
      action={
        <button className="btn btn-primary btn-sm" disabled={isPending} onClick={() => switchChainAsync({ chainId: arcChain.id }).catch(() => undefined)}>
          {isPending ? "Check your wallet…" : `Switch to ${arcChain.name}`}
        </button>
      }
    >
      Transactions are disabled until your wallet is on chain {arcChain.id}.
      {error ? <span className="block text-bad">Your wallet did not switch networks. Add {arcChain.name} manually (chain ID {arcChain.id}).</span> : null}
    </Notice>
  );
}

/** Honest freshness indicator for onchain reads. */
export function Freshness({ updatedAt, isError, isFetching }: { updatedAt: number; isError: boolean; isFetching: boolean }) {
  if (isError)
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-bad" role="status">
        <AlertTriangle size={13} aria-hidden /> Could not refresh. Values below are last known, not current.
      </span>
    );
  if (!updatedAt) return <span className="text-xs text-faint">Loading onchain data…</span>;
  const t = new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-faint tnum" role="status">
      <Clock size={13} aria-hidden /> Read from the contract at {t}
      {isFetching ? " · refreshing" : ""}
    </span>
  );
}

export function Pill({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONE[tone]}`}>{children}</span>;
}
