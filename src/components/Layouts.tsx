import { BUILD_COMMIT } from "@/build";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Menu, X, ExternalLink } from "lucide-react";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { WalletButton } from "@/components/WalletButton";
import { arcChain, dep, NETWORK } from "@/lib/chains";
import { useBackendStatus } from "@/hooks/useHealth";
import { useWalletReady } from "@/hooks/useVault";
import { WrongNetwork } from "@/components/ui";

const RECOVERY_BASE = (import.meta.env.VITE_RECOVERY_URL as string | undefined) || "/recovery-client/";
/** Opens the recovery client on the same network this app is running on. */
export const RECOVERY_URL = `${RECOVERY_BASE}${RECOVERY_BASE.includes("?") ? "&" : "?"}network=${NETWORK}`;

function NetworkBadge() {
  return (
    <span className="hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-muted sm:inline-flex" title={`Chain ID ${dep.chainId}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${NETWORK === "mainnet" ? "bg-accent" : "bg-warn"}`} aria-hidden />
      {arcChain.name}
    </span>
  );
}

/** `desktopFrom` is the pixel width at which this layout shows its full navigation instead of the menu button. */
function useDrawer(desktopFrom: number) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  // If the window grows past the point where the drawer is hidden, close it so the page never stays scroll-locked behind it.
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${desktopFrom}px)`);
    const onChange = (e: MediaQueryListEvent) => { if (e.matches) setOpen(false); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [desktopFrom]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open]);
  return { open, setOpen, btn };
}

const navCls = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm transition-colors ${isActive ? "text-fg bg-surface2" : "text-muted hover:text-fg"}`;

/* ---------------- Marketing (public) ---------------- */
const MARKETING_LINKS = [
  { to: "/#how", label: "How it works", hash: true },
  { to: "/recover", label: "Recovery" },
  { to: "/proof", label: "Proof" },
  { to: "/docs", label: "Docs" },
];

export function MarketingLayout() {
  const { open, setOpen, btn } = useDrawer(768);
  const loc = useLocation();
  useEffect(() => {
    if (loc.hash) document.getElementById(loc.hash.slice(1))?.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [loc.pathname, loc.hash]);
  return (
    <div className="min-h-dvh">
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" aria-label="UNSPENT home"><Logo /></Link>
          <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
            {MARKETING_LINKS.map((l) => l.hash ? <a key={l.to} href={l.to} className="rounded-lg px-3 py-2 text-sm text-muted hover:text-fg">{l.label}</a> : <NavLink key={l.to} to={l.to} className={navCls}>{l.label}</NavLink>)}
          </nav>
          <div className="flex items-center gap-2">
            <div className="hidden md:block"><ThemeToggle /></div>
            <Link to="/app" className="btn btn-primary btn-sm hidden sm:inline-flex">Open app</Link>
            <button ref={btn} className="btn btn-secondary btn-sm !px-2.5 md:hidden" aria-label="Open navigation" aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen(true)}>
              <Menu size={20} aria-hidden />
            </button>
          </div>
        </div>
      </header>
      <MobileDrawer hideFrom="md" open={open} onClose={() => { setOpen(false); btn.current?.focus(); }}>
        {MARKETING_LINKS.map((l) => l.hash ? <a key={l.to} href={l.to} className="rounded-lg px-3 py-3 text-base text-fg hover:bg-surface2" onClick={() => setOpen(false)}>{l.label}</a> : <NavLink key={l.to} to={l.to} className="rounded-lg px-3 py-3 text-base text-fg hover:bg-surface2">{l.label}</NavLink>)}
        <Link to="/app" className="btn btn-primary mt-2">Open app</Link>
      </MobileDrawer>
      <main id="main"><Outlet /></main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3"><Logo /><span className="text-faint">Refundable USDC API credits on Arc.</span></div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
            <Link className="hover:text-fg" to="/docs">Docs</Link>
            <Link className="hover:text-fg" to="/docs#privacy">Privacy</Link>
            <Link className="hover:text-fg" to="/docs#trust">Trust assumptions</Link>
            <Link className="hover:text-fg" to="/proof">Proof</Link>
            <a className="hover:text-fg inline-flex items-center gap-1" href="https://github.com/TheWeirdDee/unspent" target="_blank" rel="noopener noreferrer">Source <ExternalLink size={12} aria-hidden /></a>
          </nav>
          <div className="flex items-center gap-3 md:hidden"><ThemeToggle /></div>
        </div>
        <p className="mx-auto max-w-6xl px-4 pb-8 text-xs text-faint sm:px-6">
          Contracts have not been independently audited. Independent project; not endorsed by Circle or Arc. A response hash records your acceptance, not proof of service quality. <span className="mono">build {BUILD_COMMIT.slice(0, 7)}</span>
        </p>
      </footer>
    </div>
  );
}

// The drawer must be hidden at exactly the width where its header button is hidden (md for the marketing header, lg for the app header).
function MobileDrawer({ open, onClose, hideFrom, children }: { open: boolean; onClose: () => void; hideFrom: "md" | "lg"; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) ref.current?.querySelector<HTMLElement>("a, button")?.focus(); }, [open]);
  if (!open) return null;
  return (
    <div className={`fixed inset-0 z-50 ${hideFrom === "lg" ? "lg:hidden" : "md:hidden"}`} role="dialog" aria-modal="true" aria-label="Navigation">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div ref={ref} id="mobile-nav" className="absolute right-0 top-0 flex h-full w-[min(86vw,20rem)] flex-col gap-1 border-l border-line bg-bg p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="label">Navigate</span>
          <button className="btn btn-ghost btn-sm !px-2.5" onClick={onClose} aria-label="Close navigation"><X size={20} aria-hidden /></button>
        </div>
        {children}
        <div className="mt-auto flex items-center justify-between pt-4"><span className="label">Theme</span><ThemeToggle /></div>
      </div>
    </div>
  );
}

/* ---------------- App workspace (no marketing footer) ---------------- */
const APP_LINKS = [
  { to: "/app", label: "Overview", end: true },
  { to: "/app/use", label: "Use API" },
  { to: "/app/activity", label: "Activity" },
  { to: "/app/recover", label: "Recover" },
  { to: "/app/provider", label: "For providers" },
  { to: "/docs", label: "Docs" },
];

function StatusStrip() {
  const s = useBackendStatus();
  const { isConnected, wrongNetwork } = useWalletReady();
  const text =
    s.kind === "loading" ? "Checking billing backend…"
    : s.kind === "online" ? "Billing backend online"
    : s.kind === "simulated-outage" ? "SIMULATED APPLICATION BACKEND OUTAGE (demo toggle). Onchain balances and recovery are unaffected."
    : "Billing backend unreachable. Your balance is still read directly from the contract.";
  const tone = s.kind === "online" ? "text-muted" : s.kind === "loading" ? "text-faint" : "text-warn";
  return (
    <div className="border-b border-line bg-surface/60">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5 text-xs sm:px-6">
        <span className={`inline-flex items-center gap-1.5 ${tone}`} role="status">
          <span className={`h-1.5 w-1.5 rounded-full ${s.kind === "online" ? "bg-accent" : s.kind === "loading" ? "bg-faint" : "bg-warn"}`} aria-hidden />
          {text}
        </span>
        <span className="text-faint">{isConnected ? (wrongNetwork ? "Wallet on wrong network" : `Wallet on ${arcChain.name}`) : "Wallet not connected"}</span>
        {s.kind === "unreachable" || s.kind === "simulated-outage" ? <a className="link" href={RECOVERY_URL}>Open independent recovery client</a> : null}
      </div>
    </div>
  );
}

export function AppLayout() {
  const { open, setOpen, btn } = useDrawer(1024);
  const { wrongNetwork } = useWalletReady();
  const loc = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  return (
    <div className="min-h-dvh">
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-5">
            <Link to="/" aria-label="UNSPENT home"><Logo /></Link>
            <nav aria-label="App" className="hidden items-center gap-0.5 lg:flex">
              {APP_LINKS.map((l) => <NavLink key={l.to} to={l.to} end={l.end} className={navCls}>{l.label}</NavLink>)}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <NetworkBadge />
            <div className="hidden lg:block"><ThemeToggle /></div>
            <WalletButton compact />
            <button ref={btn} className="btn btn-secondary btn-sm !px-2.5 lg:hidden" aria-label="Open navigation" aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen(true)}>
              <Menu size={20} aria-hidden />
            </button>
          </div>
        </div>
      </header>
      <StatusStrip />
      <MobileDrawer hideFrom="lg" open={open} onClose={() => { setOpen(false); btn.current?.focus(); }}>
        {APP_LINKS.map((l) => <NavLink key={l.to} to={l.to} end={l.end} className="rounded-lg px-3 py-3 text-base text-fg hover:bg-surface2">{l.label}</NavLink>)}
      </MobileDrawer>
      <main id="main" className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        {wrongNetwork ? <div className="mb-6"><WrongNetwork /></div> : null}
        <Outlet />
      </main>
    </div>
  );
}
