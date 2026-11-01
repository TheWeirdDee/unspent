// Screenshot + console/overflow probe using playwright-core. Usage: bun scripts/shot.ts <url> <outPrefix> [theme]
import { chromium } from "playwright-core";
const [, , url, out, theme = "dark"] = process.argv;
const widths = [320, 375, 768, 1024, 1440];
const browser = await chromium.launch({ args: ["--disable-gpu", "--no-sandbox"] });
for (const w of widths) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: theme as "dark" | "light" });
  await ctx.addInitScript((t) => localStorage.setItem("unspent-theme", t), theme);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
  page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message.slice(0, 200)));
  await page.goto(url, { waitUntil: "networkidle", timeout: 45000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  const over = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  console.log(`${theme} w=${w} overflow=${over.sw > over.cw ? "YES " + over.sw : "no"} errors=${errors.length}${errors.length ? " " + JSON.stringify(errors.slice(0, 3)) : ""}`);
  await page.screenshot({ path: `${out}-${theme}-${w}.png`, fullPage: w === 1440 || w === 320, timeout: 90000, animations: "disabled" }).catch((e) => console.log("shot failed", String(e).slice(0, 120)));
  await ctx.close();
}
await browser.close();
