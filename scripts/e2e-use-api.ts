// Browser journey for the Use API screen. Without a configured model provider the run must fail honestly.
import { chromium } from "playwright-core";
import { installTestWallet } from "./e2e-wallet";
import { acct, wallet } from "./lib";
import { deployments } from "../src/contracts/deployments";

const APP = "http://localhost:5173";
const providerId = BigInt(deployments.testnet.providerId!);
const customer = wallet("TESTNET_CUSTOMER_KEY").account.address;
const browser = await chromium.launch({ args: ["--disable-gpu", "--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: "dark" })).newPage();
await installTestWallet(page);
await page.goto(`${APP}/app`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /connect/i }).first().click();
await page.getByRole("button", { name: /E2E Test Wallet/ }).click();
await page.waitForSelector("text=/Read from the contract at/");
console.log("before:", await acct(providerId, customer));
await page.goto(`${APP}/app/use`, { waitUntil: "networkidle" });
await page.getByLabel("Text to summarise").fill("Arc is a Layer-1 blockchain where USDC is the native gas token. It offers sub-second finality and predictable fees, which makes it well suited to payment applications and prepaid API credits.");
await page.getByRole("button", { name: /Reserve 0\.10 and run/ }).click();
await page.waitForSelector("text=/Onchain reserve/");
await page.waitForSelector("text=/Confirmed\\. Reservation #/", { timeout: 90000 }).catch(() => console.log("no reserve confirmation text"));
await page.waitForTimeout(6000);
await page.screenshot({ path: "/tmp/shots/e2e-use-1.png", fullPage: true });
console.log((await page.locator("main").innerText()).split("\n").filter((l) => /Reservation|No completed|reserved|MODEL|expire|Billing/i.test(l)).slice(0, 10));
console.log("after:", await acct(providerId, customer));
await browser.close();
