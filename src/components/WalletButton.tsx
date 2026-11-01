import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { Wallet, X, LogOut, Copy, Check } from "lucide-react";
import { shortAddr } from "@/lib/chains";

function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.querySelector<HTMLElement>("button, [href]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && el) {
        const f = [...el.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input")];
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus(); };
  }, [open, onClose]);
  return ref;
}

export function WalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { connectors, connectAsync, isPending, variables, error, reset } = useConnect();
  const ref = useDialog(open, onClose);
  if (!open) return null;
  const wallets = connectors.filter((c) => c.type === "injected" || c.id !== "injected");
  const detected = wallets.filter((c) => c.id !== "injected");
  const list = detected.length ? detected : wallets;
  const noWallet = detected.length === 0 && typeof window !== "undefined" && !(window as unknown as { ethereum?: unknown }).ethereum;
  const rejected = error && /reject|denied|4001/i.test(error.message);
  return (
    <div className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-black/60 p-3" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="wallet-title" className="card w-full max-w-sm p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="wallet-title" className="text-lg font-semibold">Connect a wallet</h2>
            <p className="mt-1 text-sm text-muted">Choose the wallet you hold your USDC in. UNSPENT never sees your keys.</p>
          </div>
          <button className="btn btn-ghost btn-sm !px-2" onClick={() => { reset(); onClose(); }} aria-label="Close wallet chooser"><X size={18} /></button>
        </div>
        <ul className="mt-4 space-y-2">
          {list.map((c) => (
            <li key={c.uid}>
              <button
                className="btn btn-secondary w-full !justify-start gap-3"
                disabled={isPending}
                onClick={async () => { try { await connectAsync({ connector: c }); onClose(); } catch { /* shown below */ } }}
              >
                {c.icon ? <img src={c.icon} alt="" width={22} height={22} className="rounded" /> : <Wallet size={20} />}
                <span className="flex-1 text-left">{c.id === "injected" ? "Browser wallet" : c.name}</span>
                {isPending && variables?.connector === c ? <span className="text-xs text-muted">Check your wallet…</span> : null}
              </button>
            </li>
          ))}
        </ul>
        {noWallet ? (
          <p className="mt-3 rounded-lg bg-warnsoft p-3 text-sm text-warn">No browser wallet was detected. Install a wallet extension such as MetaMask or Rabby, then reload this page.</p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 rounded-lg bg-badsoft p-3 text-sm text-bad">
            {rejected ? "Connection request rejected in your wallet. Nothing was connected." : "Could not connect. Unlock your wallet and try again."}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function WalletButton({ compact = false }: { compact?: boolean }) {
  const { address, isConnected, isConnecting, connector } = useAccount();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setMenu(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [menu]);

  if (!isConnected || !address) {
    return (
      <>
        <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)} disabled={isConnecting}>
          <Wallet size={16} />
          {isConnecting ? "Connecting…" : compact ? "Connect" : "Connect wallet"}
        </button>
        <WalletModal open={open} onClose={() => setOpen(false)} />
      </>
    );
  }
  return (
    <div className="relative" ref={wrap}>
      <button className="btn btn-secondary btn-sm mono !text-[0.8125rem]" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
        {connector?.icon ? <img src={connector.icon} alt="" width={16} height={16} /> : <Wallet size={16} />}
        {shortAddr(address)}
      </button>
      {menu ? (
        <div role="menu" className="card absolute right-0 z-40 mt-2 w-56 p-1.5 shadow-xl">
          <button role="menuitem" className="btn btn-ghost btn-sm w-full !justify-start" onClick={async () => { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : "Copy address"}
          </button>
          <button role="menuitem" className="btn btn-ghost btn-sm w-full !justify-start" onClick={() => { setMenu(false); disconnect(); }}>
            <LogOut size={16} /> Disconnect
          </button>
        </div>
      ) : null}
    </div>
  );
}
