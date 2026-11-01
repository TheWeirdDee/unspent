import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { Pause, Play } from "lucide-react";

const STEPS = [
  { id: "deposit", title: "Deposit", body: "You send USDC to the vault. In the same transaction your credits exist, so there is no gap where money has moved but nothing is credited." },
  { id: "use", title: "Use", body: "You sign a small spending limit. The vault reserves it, the API runs, and you accept the response you got. Only then does the provider get paid." },
  { id: "withdraw", title: "Withdraw", body: "Available credits can be withdrawn at any time, straight to your own wallet, whether or not the provider's app is running. Credits reserved for a request return to Available once the reservation expires. A withdrawal also needs the token and network to allow the transfer." },
] as const;

// Bar scale (0..1) per step for [available, reserved, spent]. Schematic proportions only: no amounts.
const BARS = [
  [1, 0, 0],
  [0.62, 0.14, 0.24],
  [0, 0, 0.24],
];

export function WorkflowDiagram() {
  const root = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [inView, setInView] = useState(false);
  const reduced = useRef(typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || !inView || reduced.current) return;
    const t = setTimeout(() => setStep((s) => (s + 1) % STEPS.length), 4200);
    return () => clearTimeout(t);
  }, [step, playing, inView]);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const q = gsap.utils.selector(el);
    const dur = reduced.current ? 0 : 0.9;
    const ctx = gsap.context(() => {
      (["avail", "resv", "spent"] as const).forEach((id, i) => gsap.to(q(`[data-bar="${id}"]`), { scaleX: Math.max(BARS[step][i], 0.001), duration: dur, ease: "power2.inOut", transformOrigin: "0% 50%" }));
      const coin = q("[data-coin]");
      const path: Record<number, { from: number; to: number }> = { 0: { from: 60, to: 250 }, 1: { from: 250, to: 520 }, 2: { from: 250, to: 60 } };
      const p = path[step];
      gsap.set(coin, { opacity: reduced.current ? 0 : 1, x: p.from });
      if (!reduced.current) gsap.to(coin, { x: p.to, duration: 1.6, ease: "power1.inOut", delay: 0.2 }).then(() => gsap.to(coin, { opacity: 0, duration: 0.4 }));
      gsap.to(q("[data-node]"), { opacity: 0.45, duration: dur });
      const active = step === 0 ? ["wallet", "vault"] : step === 1 ? ["vault", "provider"] : ["vault", "wallet"];
      active.forEach((n) => gsap.to(q(`[data-node="${n}"]`), { opacity: 1, duration: dur }));
    }, el);
    return () => ctx.revert();
  }, [step]);

  return (
    <div ref={root} className="grid items-center gap-8 lg:grid-cols-[1fr_1.25fr]">
      <ol className="space-y-2" aria-label="How it works">
        {STEPS.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => { setStep(i); setPlaying(false); }}
              aria-current={step === i ? "step" : undefined}
              className={`w-full rounded-xl border p-4 text-left transition-colors ${step === i ? "border-accent bg-surface" : "border-line hover:bg-surface"}`}
            >
              <span className="flex items-center gap-3">
                <span className={`grid h-7 w-7 place-items-center rounded-full text-sm font-semibold tnum ${step === i ? "bg-accent text-onaccent" : "bg-surface2 text-muted"}`}>{i + 1}</span>
                <span className="font-display text-lg font-semibold">{s.title}</span>
              </span>
              <span className={`mt-2 block pl-10 text-sm leading-relaxed ${step === i ? "text-muted" : "text-faint"}`}>{s.body}</span>
            </button>
          </li>
        ))}
      </ol>

      <figure className="card p-4 sm:p-5">
        <svg viewBox="0 0 580 230" className="h-auto w-full" role="img" aria-label={`Schematic of step ${step + 1}: ${STEPS[step].title}. Funds move between your wallet, the vault contract and the provider. No real amounts are shown.`}>
          <g data-node="wallet"><rect x="8" y="70" width="104" height="90" rx="14" fill="var(--surface-2)" stroke="var(--border-strong)" /><text x="60" y="108" textAnchor="middle" fill="var(--text)" fontSize="14" fontWeight="600">Your wallet</text><text x="60" y="130" textAnchor="middle" fill="var(--muted)" fontSize="11">holds the keys</text></g>
          <g data-node="vault"><rect x="190" y="30" width="200" height="170" rx="16" fill="var(--surface)" stroke="var(--accent)" /><text x="290" y="56" textAnchor="middle" fill="var(--text)" fontSize="14" fontWeight="600">Vault contract</text>
            {([["avail", "Available", 78], ["resv", "Reserved", 116], ["spent", "Spent", 154]] as const).map(([id, label, y]) => (
              <g key={id}><text x="206" y={y - 5} fill="var(--muted)" fontSize="10.5">{label}</text><rect x="206" y={y} width="168" height="9" rx="4.5" fill="var(--surface-2)" />
                <rect data-bar={id} x="206" y={y} width="168" height="9" rx="4.5" fill={id === "spent" ? "var(--faint)" : "var(--accent)"} style={{ transformBox: "fill-box", transformOrigin: "0% 50%" }} /></g>
            ))}</g>
          <g data-node="provider"><rect x="468" y="70" width="104" height="90" rx="14" fill="var(--surface-2)" stroke="var(--border-strong)" /><text x="520" y="108" textAnchor="middle" fill="var(--text)" fontSize="14" fontWeight="600">Provider</text><text x="520" y="130" textAnchor="middle" fill="var(--muted)" fontSize="11">paid on accept</text></g>
          <line x1="112" y1="115" x2="190" y2="115" stroke="var(--border-strong)" strokeDasharray="3 4" /><line x1="390" y1="115" x2="468" y2="115" stroke="var(--border-strong)" strokeDasharray="3 4" />
          <circle data-coin cx="0" cy="115" r="7" fill="var(--accent)" />
        </svg>
        <figcaption className="mt-2 flex items-center justify-between gap-3 text-xs text-faint">
          <span>Schematic. Bar lengths are illustrative; no balances or transactions are shown.</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause animation" : "Play animation"}>{playing ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}</button>
        </figcaption>
      </figure>
    </div>
  );
}
