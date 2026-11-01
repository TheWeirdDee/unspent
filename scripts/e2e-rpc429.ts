// Automated test (browser, real chain): RPC rate limiting (HTTP 429) injected at the browser's network layer
// must never produce a false zero balance, a duplicate transaction, or a success message.
// The 429s are the test fixture; the chain, the wallet signatures and the transactions are real (Arc Testnet).
import { chromium } from "playwright-core";
import { installTestWallet } from "./e2e-wallet";
import { acct, wallet } from "./lib";
import { deployments } from "../src/contracts/deployments";

const RECOVERY = process.env.RECOVERY_URL ?? "http://localhost:5174/recovery-client/";
const keyName = process.env.E2E_KEY ?? "TESTNET_CUSTOMER_KEY";
const pid = BigInt(deployments.testnet.providerId!);
const customer = wallet(keyName).account.address;
const check = (n: string, ok: boolean, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  " + d : ""}`); if (!ok) process.exitCode = 1; };

const browser = await chromium.launch({ args: ["--disable-gpu", "--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1100, height: 1200 }, colorScheme: "dark" })).newPage();
const w = await installTestWallet(page, keyName);
let block429 = false;
let receipt429 = false;
let n429 = 0;
await page.route(/rpc\.testnet\.arc\.io/, async (route) => {
  const body = route.request().postData() ?? "";
  const hitReceipt = receipt429 && body.includes("eth_getTransactionReceipt");
  if (block429 || hitReceipt) { n429++; return route.fulfill({ status: 429, contentType: "text/plain", body: "Too Many Requests" }); }
  return route.continue();
});

const before = await acct(pid, customer);
console.log("onchain before:", JSON.stringify(before, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

// A. every read is rate limited
block429 = true;
await page.goto(RECOVERY, { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: /E2E Test Wallet/ }).click();
await page.waitForTimeout(9000);
const textA = (await page.locator("main").innerText()).replace(/\s+/g, " ");
check("429 on all reads: no balance is presented as current (no 'read at block')", !/read at block/.test(textA));
check("429 on all reads: an explicit unavailable message is shown", /temporarily unavailable|could not|unavailable/i.test(textA), textA.match(/[^.]*unavailable[^.]*\./i)?.[0] ?? "");
check("429 on all reads: no false '0.00 USDC Available' presented", !/0\.00 USDC\s*Available/.test(textA));
await page.screenshot({ path: "/tmp/shots/rpc429-reads.png" });

// B. recovery of reads: real numbers return
block429 = false;
await page.waitForSelector("text=/read at block/", { timeout: 60000 });
const textB = (await page.locator("main").innerText()).replace(/\s+/g, " ");
check("after the limit lifts the real balance is shown", new RegExp(`Reserved ${(Number(before.reserved) / 1e6).toFixed(2)}`).test(textB), textB.match(/Reserved [0-9.]+/)?.[0] ?? "");

// C. a real release transaction whose receipt reads are rate limited
const releaseBtn = page.getByRole("button", { name: "Release expired reserve" }).first();
if (await releaseBtn.isEnabled().catch(() => false)) {
  const sendsBefore = w.log.filter((m) => m === "eth_sendTransaction").length;
  receipt429 = true;
  await releaseBtn.click();
  await page.waitForTimeout(12000);
  const textC = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  const sends = w.log.filter((m) => m === "eth_sendTransaction").length - sendsBefore;
  check("exactly one transaction submitted while receipt reads were 429", sends === 1, `sends=${sends}`);
  check("no success message while the receipt cannot be read", !/Confirmed\./.test(textC));
  check("UI states the tx was submitted and will not be resent", /already submitted and will not be sent again|Submitted\. Waiting/.test(textC), textC.match(/Submitted[^.]*\.[^.]*\./)?.[0]?.slice(0, 160) ?? "");
  check("release button stays locked (no duplicate submission possible)", !(await releaseBtn.isEnabled().catch(() => false)) || (await page.getByRole("button", { name: "Release expired reserve" }).first().isDisabled().catch(() => true)));
  await page.screenshot({ path: "/tmp/shots/rpc429-receipt.png" });
  receipt429 = false;
  await page.getByText(/Confirmed\. The reservation returned/).waitFor({ timeout: 90000 });
  const sends2 = w.log.filter((m) => m === "eth_sendTransaction").length - sendsBefore;
  check("after reads recover it reconciles to Confirmed with still exactly one submission", sends2 === 1, `sends=${sends2}`);
  const after = await acct(pid, customer);
  check("onchain: a reservation moved Reserved -> Available (0.10)", after.available - before.available === 100_000n && before.reserved - after.reserved === 100_000n, `available +${after.available - before.available}`);
} else {
  console.log("SKIP part C: no releasable expired reservation for this account");
}
console.log("responses rate limited by the fixture:", n429);
await browser.close();
