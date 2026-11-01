// Mirrors in-app navigation into the Studio address bar when framed by Arc Studio.
const STUDIO_ORIGINS = ["https://studio.arc.io", "https://studio-staging.arc.io"];
const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
};
export function parentStudioOrigins(ancestorOrigins?: ArrayLike<string>, referrer = ""): string[] {
  const known = [ancestorOrigins?.[0] ?? "", originOf(referrer)].find((o) => STUDIO_ORIGINS.includes(o));
  return known ? [known] : STUDIO_ORIGINS;
}
let syncInstalled = false;
export function installShareSync(): void {
  if (window.self === window.top || syncInstalled) return;
  syncInstalled = true;
  const targets = parentStudioOrigins(window.location.ancestorOrigins, document.referrer);
  let lastPosted: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const post = () => {
    const key = location.pathname + location.search;
    if (key === lastPosted) return;
    lastPosted = key;
    for (const origin of targets) window.parent.postMessage({ type: "arc-share:navigated", path: location.pathname, search: location.search }, origin);
  };
  const schedule = () => {
    timer ??= setTimeout(() => {
      timer = undefined;
      post();
    }, 100);
  };
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method];
    history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
      const result = original.apply(this, args);
      schedule();
      return result;
    };
  }
  window.addEventListener("popstate", schedule);
  post();
}
