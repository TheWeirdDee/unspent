// Browser journey: connect wallet -> approve -> deposit -> read balance -> simulated outage -> independent recovery -> refund.
import { chromium } from "playwright-core";
import { installTestWallet } from "./e2e-wallet";
import { acct, env, wallet } from "./lib";
import { deployments } from "../src/contracts/deployments";

const APP = "http://localhost:5173";
const RECOVERY = "http://localhost:5174/recovery-client/";
const providerId = BigInt(deployments.testnet.providerId!);
const customer = wallet("TESTNET_CUSTOMER_KEY").account.address;
const token = env.DEMO_OPERATOR_TOKEN;
const shots = "/tmp/shots/e2e";
const step = (s: string) => console.log(`\n== ${s}`);

const browser = await chromium.launch({ args: ["--disable-gpu", "--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text().slice(0, 160)));
await installTestWallet(page);

step("1. connect wallet via chooser");
await page.goto(`${APP}/app`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /connect/i }).first().click();
await page.getByRole("button", { name: /E2E Test Wallet/ }).click();
await page.getByText("Your credits").first().waitFor();
await page.waitForSelector("text=/Read from the contract at/");
await page.screenshot({ path: `${shots}-1-overview-empty.png` });
const before = await acct(providerId, customer);
console.log("onchain before:", before);

step("2. approve (separate tx) then deposit 1 USDC");
await page.goto(`${APP}/app/deposit`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Approve 1\.00 USDC/ }).waitFor({ timeout: 20000 });
await page.screenshot({ path: `${shots}-2-deposit-review.png` });
await page.getByRole("button", { name: /Approve 1\.00 USDC/ }).click();
await page.getByText("Approved. No credits exist yet").waitFor({ timeout: 60000 });
const afterApprove = await acct(providerId, customer);
console.log("credits after approve only (must be unchanged):", afterApprove.totalDeposited === before.totalDeposited);
await page.getByRole("button", { name: /Deposit 1\.00 USDC/ }).click();
await page.getByText(/Your credits were created in the same transaction/).waitFor({ timeout: 60000 });
await page.screenshot({ path: `${shots}-3-deposit-confirmed.png` });
const afterDeposit = await acct(providerId, customer);
console.log("onchain after deposit:", afterDeposit, "delta available:", afterDeposit.available - before.available);

step("3. overview reads the contract");
await page.goto(`${APP}/app`, { waitUntil: "networkidle" });
await page.waitForSelector("text=/Read from the contract at/");
await page.screenshot({ path: `${shots}-4-overview-funded.png` });

step("4. start SIMULATED backend outage, prove the primary API is down");
const on = await fetch(`${APP}/api/v1/demo/outage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, active: true, minutes: 10 }) }).then((r) => r.status);
const quote = await fetch(`${APP}/api/v1/providers`).then(async (r) => ({ status: r.status, body: (await r.json()).code }));
console.log("outage on:", on, "| GET /providers during outage ->", quote);
await page.goto(`${APP}/app`, { waitUntil: "networkidle" });
await page.waitForSelector("text=/SIMULATED APPLICATION BACKEND OUTAGE/");
await page.waitForSelector("text=/Read from the contract at/");
await page.screenshot({ path: `${shots}-5-outage-app.png` });

step("5. independent recovery client (separate origin, no API calls)");
const rpage = await ctx.newPage();
const apiCalls: string[] = [];
rpage.on("request", (r) => /\/api\/v1\//.test(r.url()) && apiCalls.push(r.url()));
await installTestWallet(rpage);
await rpage.goto(`${RECOVERY}?demo=simulated-outage`, { waitUntil: "networkidle" });
await rpage.getByRole("button", { name: /E2E Test Wallet/ }).click();
await rpage.waitForSelector("text=/read at block/");
await rpage.screenshot({ path: `${shots}-6-recovery-balance.png` });
const shown = await rpage.locator("#bal ~ p, section[aria-labelledby=bal] p.money").first().innerText();
console.log("recovery shows available:", shown.replace(/\s+/g, " "));
await rpage.getByRole("button", { name: "Refund to my wallet" }).click();
await rpage.getByRole("button", { name: "Confirm refund" }).waitFor();
await rpage.screenshot({ path: `${shots}-7-recovery-confirm.png` });
await rpage.getByRole("button", { name: "Confirm refund" }).click();
await rpage.getByText(/Your USDC was sent back to your wallet/).waitFor({ timeout: 60000 });
await rpage.screenshot({ path: `${shots}-8-recovery-refunded.png` });
const end = await acct(providerId, customer);
console.log("onchain after recovery refund:", end);
console.log("recovery client calls to /api/v1:", apiCalls.length);

await fetch(`${APP}/api/v1/demo/outage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, active: false }) });
console.log("\npage errors:", errors);
await browser.close();
