export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <path d="M9.5 7v10.5a6.5 6.5 0 0 0 13 0V7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="14.5" r="3" style={{ fill: "var(--accent)" }} />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-display text-[1.05rem] font-semibold tracking-tight ${className}`}>
      <LogoMark />
      <span>UNSPENT</span>
    </span>
  );
}
