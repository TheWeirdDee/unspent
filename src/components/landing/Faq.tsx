import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

export interface FaqItem { q: string; a: React.ReactNode }

export function Faq({ items }: { items: FaqItem[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const base = useId();
  return (
    <div className="divide-y divide-line rounded-2xl border border-line bg-surface">
      {items.map((it, i) => {
        const isOpen = open === i;
        return (
          <div key={it.q}>
            <h3>
              <button
                type="button"
                id={`${base}-b${i}`}
                aria-expanded={isOpen}
                aria-controls={`${base}-p${i}`}
                onClick={() => setOpen(isOpen ? null : i)}
                className="flex min-h-14 w-full items-center justify-between gap-4 px-5 py-4 text-left font-display text-base font-semibold hover:bg-surface2 sm:text-lg"
              >
                <span>{it.q}</span>
                <ChevronDown size={18} className={`shrink-0 text-muted transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} aria-hidden />
              </button>
            </h3>
            <div id={`${base}-p${i}`} role="region" aria-labelledby={`${base}-b${i}`} className="faq-panel" data-open={isOpen} hidden={undefined} inert={!isOpen}>
              <div><div className="px-5 pb-5 text-sm leading-relaxed text-muted sm:text-base">{it.a}</div></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
