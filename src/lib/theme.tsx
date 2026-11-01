import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemePref = "light" | "dark" | "system";
interface ThemeCtx {
  pref: ThemePref;
  resolved: "light" | "dark";
  setPref: (p: ThemePref) => void;
}
const Ctx = createContext<ThemeCtx | null>(null);
const mq = () => window.matchMedia("(prefers-color-scheme: dark)");

function resolve(pref: ThemePref): "light" | "dark" {
  return pref === "system" ? (mq().matches ? "dark" : "light") : pref;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(() => (localStorage.getItem("unspent-theme") as ThemePref | null) ?? "system");
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolve(pref));

  useEffect(() => {
    const apply = () => {
      const r = resolve(pref);
      setResolved(r);
      document.documentElement.dataset.theme = r;
      document.documentElement.dataset.themePref = pref;
    };
    apply();
    const m = mq();
    m.addEventListener("change", apply);
    return () => m.removeEventListener("change", apply);
  }, [pref]);

  const setPref = useCallback((p: ThemePref) => {
    localStorage.setItem("unspent-theme", p);
    setPrefState(p);
  }, []);
  const value = useMemo(() => ({ pref, resolved, setPref }), [pref, resolved, setPref]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTheme outside ThemeProvider");
  return c;
}
