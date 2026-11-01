import { chromium } from "playwright-core";
const b = await chromium.launch({ args: ["--disable-gpu", "--no-sandbox"] });
const ctx = await b.newContext({ viewport: { width: 375, height: 800 }, reducedMotion: "reduce" });
const p = await ctx.newPage();
await p.goto("http://localhost:5173/", { waitUntil: "networkidle" });
// hamburger: icon button with accessible name, no visible "Menu" text
const burger = p.getByRole("button", { name: "Open navigation" });
console.log("hamburger visible:", await burger.isVisible(), "| visible text:", JSON.stringify((await burger.innerText()).trim()));
await burger.click();
console.log("drawer dialog open:", await p.getByRole("dialog", { name: "Navigation" }).isVisible());
await p.keyboard.press("Escape");
console.log("closed on Escape:", !(await p.getByRole("dialog", { name: "Navigation" }).isVisible()), "| focus returned to hamburger:", await burger.evaluate((el) => el === document.activeElement));
// keyboard-only FAQ
const q = p.getByRole("button", { name: "Is it audited?" });
await q.focus();
await p.keyboard.press("Enter");
console.log("FAQ aria-expanded after Enter:", await q.getAttribute("aria-expanded"), "| panel visible:", await p.getByText("No. The contract has an automated test suite").isVisible());
await p.keyboard.press("Space");
console.log("FAQ aria-expanded after Space:", await q.getAttribute("aria-expanded"));
// tab order: first stops
await p.goto("http://localhost:5173/", { waitUntil: "networkidle" });
const stops: string[] = [];
for (let i = 0; i < 6; i++) { await p.keyboard.press("Tab"); stops.push(await p.evaluate(() => { const e = document.activeElement as HTMLElement; return (e.getAttribute("aria-label") || e.innerText || e.tagName).trim().slice(0, 30); })); }
console.log("tab stops:", stops);
// reduced motion: workflow does not auto-advance
const before = await p.locator('[aria-current="step"]').first().innerText();
await p.locator("#how").scrollIntoViewIfNeeded(); await p.waitForTimeout(5500);
console.log("workflow auto-advance under reduced motion:", before !== (await p.locator('ol[aria-label="How it works"] [aria-current="step"]').innerText()) ? "ADVANCED (bad)" : "static (good)");
await b.close();
