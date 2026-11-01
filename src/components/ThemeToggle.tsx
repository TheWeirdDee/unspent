import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemePref } from "@/lib/theme";

const OPTIONS: { value: ThemePref; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light theme", Icon: Sun },
  { value: "system", label: "System theme", Icon: Monitor },
  { value: "dark", label: "Dark theme", Icon: Moon },
];

export function ThemeToggle() {
  const { pref, setPref } = useTheme();
  return (
    <div role="radiogroup" aria-label="Color theme" className="inline-flex rounded-lg border border-line p-0.5">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          role="radio"
          aria-checked={pref === value}
          aria-label={label}
          title={label}
          onClick={() => setPref(value)}
          className={`grid h-8 w-8 place-items-center rounded-md transition-colors ${pref === value ? "bg-surface2 text-fg" : "text-faint hover:text-fg"}`}
        >
          <Icon size={15} />
        </button>
      ))}
    </div>
  );
}
