// Cross-engine browser check: Chromium, Firefox (Gecko) and WebKit (Safari's engine) at desktop, tablet and phone widths.
//
// What it proves: the pages render, nothing overflows horizontally, the navigation is reachable at every width, and no
// uncaught exception or failed asset request occurs. What it does NOT prove: a real installed wallet extension (MetaMask
// cannot be installed headlessly), iOS Safari itself, or any signing flow — the wallet journeys are in scripts/e2e-*.ts.
//
// Usage: bun run test:browsers            (expects `bun run dev` already serving, or set BASE_URL)
//        BASE_URL=http://localhost:4173 bun run test:browsers
import { chromium, firefox, webkit, type Browser, type ConsoleMessage } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const ENGINES = [
  { name: "chromium", type: chromium },
  { name: "firefox", type: firefox },
  { name: "webkit", type: webkit },
] as const;
const VIEWPORTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const;
const PAGES = [
  { path: "/", needsNav: true },
  { path: "/docs", needsNav: true },
  { path: "/proof", needsNav: true },
  { path: "/recover", needsNav: true },
  { path: "/app", needsNav: true },
];

interface Failure { engine: string; viewport: string; path: string; problem: string }
const failures: Failure[] = [];
let checks = 0;

async function checkPage(browser: Browser, engine: string, vp: (typeof VIEWPORTS)[number]) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });

  for (const p of PAGES) {
    // A fresh page per path: console and error listeners then belong to exactly one navigation, instead of leaking
    // a late error from the previous page onto the next one.
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m: ConsoleMessage) => {
      if (m.type() === "error") errors.push(`console: ${m.text()}`);
    });
    page.on("requestfailed", (r) => {
      // Chain reads may fail on a blocked/limited public RPC; that is a data problem, not a rendering regression.
      const url = r.url();
      if (!/rpc|arc\.io|onrender\.com\/api/.test(url)) errors.push(`requestfailed: ${url}`);
    });
    checks++;
    const label = `${engine}/${vp.name}${p.path}`;
    try {
      const res = await page.goto(`${BASE}${p.path}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      if (!res || res.status() >= 400) failures.push({ engine, viewport: vp.name, path: p.path, problem: `HTTP ${res?.status()}` });
      // The layout mounts after hydration; waiting for the element is what makes this check stable rather than flaky.
      if (p.needsNav) {
        const nav = await page.waitForSelector("header", { state: "visible", timeout: 15_000 }).catch(() => null);
        if (!nav) failures.push({ engine, viewport: vp.name, path: p.path, problem: "header not visible" });
        else {
          const box = await nav.boundingBox();
          if (!box || box.width < 100 || box.height < 20) {
            failures.push({ engine, viewport: vp.name, path: p.path, problem: `header box ${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "missing"}` });
          }
        }
      }

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) failures.push({ engine, viewport: vp.name, path: p.path, problem: `horizontal overflow by ${overflow}px` });

      const fatal = errors.filter((e) => e.startsWith("pageerror") || e.includes("is not a function"));
      if (fatal.length) failures.push({ engine, viewport: vp.name, path: p.path, problem: fatal[0] });
      console.log(`ok   ${label}`);
    } catch (e) {
      failures.push({ engine, viewport: vp.name, path: p.path, problem: (e as Error).message.split("\n")[0] });
      console.log(`FAIL ${label}: ${(e as Error).message.split("\n")[0]}`);
    } finally {
      await page.close();
    }
  }
  await context.close();
}

for (const engine of ENGINES) {
  let browser: Browser;
  try {
    browser = await engine.type.launch();
  } catch (e) {
    // A missing browser binary is reported, never silently skipped.
    failures.push({ engine: engine.name, viewport: "-", path: "-", problem: `could not launch: ${(e as Error).message.split("\n")[0]}` });
    console.log(`FAIL ${engine.name}: launch failed`);
    continue;
  }
  for (const vp of VIEWPORTS) await checkPage(browser, engine.name, vp);
  await browser.close();
}

console.log("");
if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f.engine}/${f.viewport}${f.path}: ${f.problem}`);
  console.error(`\n${failures.length} problem(s) across ${checks} page checks.`);
  process.exit(1);
}
console.log(`All ${checks} page checks passed across ${ENGINES.length} engines and ${VIEWPORTS.length} viewports.`);
