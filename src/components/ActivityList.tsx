import { useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, ChevronDown, Lock, Receipt, Undo2 } from "lucide-react";
import type { ActivityEvent, ActivityKind } from "@/lib/activity";
import { formatUsdc } from "@/lib/money";
import { shortAddr, shortHash, txUrl } from "@/lib/chains";

export const KIND_META: Record<ActivityKind, { label: string; Icon: typeof Receipt; sign: "+" | "-" | "~" }> = {
  deposit: { label: "Deposit", Icon: ArrowDownToLine, sign: "+" },
  reserve: { label: "Reserved for a request", Icon: Lock, sign: "~" },
  settle: { label: "Paid to provider", Icon: Receipt, sign: "-" },
  release: { label: "Reservation released", Icon: Undo2, sign: "~" },
  refund: { label: "Refunded to wallet", Icon: ArrowUpFromLine, sign: "-" },
};

export function ActivityRow({ e, detail = false }: { e: ActivityEvent; detail?: boolean }) {
  const [open, setOpen] = useState(false);
  const { label, Icon, sign } = KIND_META[e.kind];
  const time = e.timestamp ? new Date(e.timestamp * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : `block ${e.blockNumber}`;
  const hasDetail = detail && (e.requestHash || e.responseHash || e.reservationId !== undefined);
  return (
    <li className="py-3">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface2 text-muted"><Icon size={17} aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{label}{e.reservationId !== undefined ? <span className="text-faint"> · #{e.reservationId.toString()}</span> : null}</p>
          <p className="truncate text-xs text-faint tnum">{time} · provider {e.providerId.toString()} · {shortAddr(e.customer)}</p>
        </div>
        <div className="text-right">
          <p className="money text-sm font-medium">{sign === "~" ? "" : sign}{formatUsdc(e.amount)} <span className="text-faint">USDC</span></p>
          <a className="link text-xs" href={txUrl(e.txHash)} target="_blank" rel="noopener noreferrer">{shortHash(e.txHash)}</a>
        </div>
        {hasDetail ? (
          <button className="btn btn-ghost btn-sm !px-2" aria-expanded={open} aria-label={open ? "Hide details" : "Show details"} onClick={() => setOpen((o) => !o)}>
            <ChevronDown size={16} className={open ? "rotate-180 transition-transform" : "transition-transform"} aria-hidden />
          </button>
        ) : null}
      </div>
      {open ? (
        <dl className="mt-2 ml-12 space-y-1 text-xs text-muted">
          {e.requestHash ? <div className="flex flex-wrap gap-x-2"><dt className="text-faint">Request hash</dt><dd className="mono break-all">{e.requestHash}</dd></div> : null}
          {e.responseHash ? <div className="flex flex-wrap gap-x-2"><dt className="text-faint">Response hash</dt><dd className="mono break-all">{e.responseHash}</dd></div> : null}
          {e.payoutWallet ? <div className="flex flex-wrap gap-x-2"><dt className="text-faint">Paid to</dt><dd className="mono break-all">{e.payoutWallet}</dd></div> : null}
          {e.expiry ? <div className="flex flex-wrap gap-x-2"><dt className="text-faint">Expiry</dt><dd className="tnum">{new Date(Number(e.expiry) * 1000).toLocaleString()}</dd></div> : null}
          <p className="text-faint">Only hashes are onchain. Prompts and responses never are.</p>
        </dl>
      ) : null}
    </li>
  );
}

export function ActivityList({ events, detail }: { events: ActivityEvent[]; detail?: boolean }) {
  return <ul className="divide-y divide-line" aria-label="Onchain activity, newest first">{events.map((e) => <ActivityRow key={`${e.txHash}-${e.logIndex}`} e={e} detail={detail} />)}</ul>;
}
