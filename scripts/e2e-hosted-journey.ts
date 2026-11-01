// HOSTED, ISOLATED Arc Testnet browser journey against the deployed site (APP_URL) and the deployed API, using a FRESH
// customer wallet that has never touched the vault. Real contract transactions, real Gemini response.
// Sandbox wallet adapter (an EIP-1193/EIP-6963 provider signing with a testnet key): NOT a physical wallet.
// Flow: connect -> (RPC 429 fixture on receipt reads) approval -> deposit -> reservation -> response -> acceptance
// -> settlement -> replay rejected -> second reservation abandoned on purpose (left for expiry + independent recovery).
import { chromium } from "playwright-core";
import { decodeEventLog, keccak256, stringToHex, type Hex } from "viem";
import { writeFileSync } from "node:fs";
import { installTestWallet } from "./e2e-wallet";
import { acct, bal, pub, vault, wallet } from "./lib";
import { unspentVaultAbi } from "../src/contracts/abi";
import { deployments } from "../src/contracts/deployments";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const EXPLORER = deployments.testnet.explorer;
const providerId = BigInt(deployments.testnet.providerId!);
const KEY = process.env.E2E_KEY ?? "TESTNET_CUSTOMER2_KEY";
const customer = wallet(KEY).account.address;
const payout = deployments.testnet.providerPayout as Hex;
const out: Record<string, unknown> = {};
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`); out[name] = { ok, detail }; if (!ok) process.exitCode = 1; };
const nat = (a: Hex) => pub.getBalance({ address: a });
const snap = async () => ({ acct: await acct(providerId, customer), custNative: await nat(customer), payoutNative: await nat(payout), vaultNative: await nat(vault), custErc20: await bal(customer), payoutErc20: await bal(payout), vaultErc20: await bal(vault), liability: (await pub.readContract({ address: vault, abi: unspentVaultAbi, functionName: "totalOutstandingLiability" })) as bigint });
const U = 10n ** 12n; // micro-USDC (6 dp ERC-20 view) -> native 18 dp
async function events(hash: Hex) { const r = await pub.getTransactionReceipt({ hash }); return r.logs.filter((l) => l.address.toLowerCase() === vault.toLowerCase()).map((l) => decodeEventLog({ abi: unspentVaultAbi, data: l.data, topics: l.topics })); }

const before = await snap();
{
  const z = (await acct(providerId, customer));
  console.log("OPENING (fresh wallet) vault account:", JSON.stringify(z, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}
console.log("BEFORE", JSON.stringify(before, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
const browser = await chromium.launch({ args: ["--disable-gpu", "--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1100 }, colorScheme: "dark" })).newPage();
const pageErrors: string[] = [];
// diagnostics: log every API call the page makes (status + code only, never bodies) and screenshot on a stuck step
page.on("response", async (r) => { if (r.url().includes("/api/v1/")) console.log("  api", r.request().method(), new URL(r.url()).pathname, r.status()); if (r.url().includes("/api/v1/") && r.status() >= 400) { const j = (await r.json().catch(() => ({}))) as { code?: string; message?: string }; console.log("    ->", j.code, (j.message ?? "").slice(0, 260)); } });
page.on("requestfailed", (r) => console.log("  request failed:", r.url().slice(0, 90), r.failure()?.errorText));
page.on("console", (m) => { if (m.type() === "error") console.log("  console.error:", m.text().slice(0, 160)); });
process.on("unhandledRejection", async () => { await page.screenshot({ path: "/tmp/shots/real-stuck.png", fullPage: true }).catch(() => {}); });
page.on("pageerror", (e) => pageErrors.push(e.message));
let acceptBody: Record<string, string> | undefined;
let acceptUrl = "";
page.on("request", (r) => { if (r.method() === "POST" && /\/usage\/req_[a-f0-9]+\/accept$/.test(r.url())) { acceptBody = JSON.parse(r.postData() ?? "{}"); acceptUrl = r.url(); } });
const w = await installTestWallet(page, KEY);
let receipt429 = false;
let n429 = 0;
await page.route(/rpc\.testnet\.arc\.io/, async (route) => {
  if (receipt429 && (route.request().postData() ?? "").includes("eth_getTransactionReceipt")) { n429++; return route.fulfill({ status: 429, contentType: "text/plain", body: "Too Many Requests" }); }
  return route.continue();
});
const links = async () => page.$$eval("a[href*='/tx/']", (as) => as.map((a) => (a as HTMLAnchorElement).href));

// ---- connect
await page.goto(`${APP}/app`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /connect/i }).first().click();
await page.getByRole("button", { name: /E2E Test Wallet/ }).click();
await page.waitForSelector("text=/Read from the contract at/");
const overview = (await page.locator("main").innerText()).replace(/\s+/g, " ");
check("fresh account shows an empty state, no invented balance or history", /No credits yet/.test(overview) && !/Reservation #|Deposit of|Settled/.test(overview));
check("opening vault account for the fresh wallet is all zero", Object.values(before.acct).every((v) => v === 0n));

// ---- deposit 1.00: approval alone must not create credits
await page.goto(`${APP}/app/deposit`, { waitUntil: "networkidle" });
receipt429 = true; // fixture: the browser cannot read receipts (HTTP 429) right after the approval is submitted
const sends0 = w.log.filter((m) => m === "eth_sendTransaction").length;
await page.getByRole("button", { name: /Approve 1\.00 USDC/ }).click();
await page.waitForTimeout(14000);
const t429 = (await page.locator("main").innerText()).replace(/\s+/g, " ");
check("receipt reads 429: approval shown as submitted, not confirmed", /Transaction submitted|Waiting for confirmation/.test(t429) && !/Approved\. No credits exist yet/.test(t429));
check("receipt reads 429: the UI says it will not be sent again", /will not be sent again/.test(t429), n429 + " receipt reads were rate limited");
check("receipt reads 429: exactly one approval transaction was submitted", w.log.filter((m) => m === "eth_sendTransaction").length - sends0 === 1);
check("receipt reads 429: no duplicate action available", await page.getByRole("button", { name: /Approve 1\.00 USDC|Approving/ }).first().isDisabled().catch(() => true));
receipt429 = false;
await page.getByText("Approved. No credits exist yet").waitFor({ timeout: 90000 });
const afterApprove = await acct(providerId, customer);
check("approval alone creates no credits", afterApprove.totalDeposited === before.acct.totalDeposited && afterApprove.available === before.acct.available);
const approveTx = (await page.locator("a[href*='/tx/']").first().getAttribute("href"))!.split("/tx/")[1] as Hex;
await page.getByRole("button", { name: /Deposit 1\.00 USDC/ }).click();
await page.getByText(/Your credits were created in the same transaction/).waitFor({ timeout: 90000 });
const depositTx = (await page.locator("a[href*='/tx/']").last().getAttribute("href"))!.split("/tx/")[1] as Hex;
const afterDeposit = await snap();
check("deposit created exactly 1.00 available", afterDeposit.acct.available - before.acct.available === 1_000_000n && afterDeposit.acct.totalDeposited - before.acct.totalDeposited === 1_000_000n);
const depEv = (await events(depositTx)).find((e) => e.eventName === "CreditsDeposited");
check("CreditsDeposited event amount = 1000000", depEv?.eventName === "CreditsDeposited" && depEv.args.amount === 1_000_000n);
await page.screenshot({ path: "/tmp/shots/real-1-deposit.png" });

// ---- use the real API
const TEXT = "Arc is Circle's Layer-1 blockchain where USDC is the native gas token. It offers sub-second finality and predictable fees. UNSPENT keeps prepaid API credits inside a smart contract so customers can withdraw what they have not spent, even if the provider's backend is offline.";
await page.goto(`${APP}/app/use`, { waitUntil: "networkidle" });
await page.getByLabel("Text to summarise").fill(TEXT);
await page.getByRole("button", { name: /Reserve 0\.10 and run/ }).click();
await page.getByRole("button", { name: /Accept & release 0\.10 USDC to TextLab/ }).waitFor({ timeout: 120000 });
const afterReserve = await snap();
check("reservation moved 0.10 Available -> Reserved, liability unchanged", afterReserve.acct.reserved - afterDeposit.acct.reserved === 100_000n && afterDeposit.acct.available - afterReserve.acct.available === 100_000n && afterReserve.liability === afterDeposit.liability);
check("provider not paid before acceptance", afterReserve.payoutNative === before.payoutNative);
const output = await page.locator("pre").first().innerText();
console.log("MODEL OUTPUT:\n" + output);
check("actual model output is non-empty bullets", output.trim().startsWith("-") && output.split("\n").filter((l) => l.trim().startsWith("-")).length === 3, `${output.length} chars`);
const reserveTx = (await page.locator("div.mt-2.text-sm.text-muted:has-text('Reservation #')").locator("a[href*='/tx/']").first().getAttribute("href"))!.split("/tx/")[1] as Hex;
await page.screenshot({ path: "/tmp/shots/real-2-delivered.png", fullPage: true });
await page.getByRole("button", { name: /Accept & release 0\.10 USDC to TextLab/ }).click();
await page.getByText(/Paid 0\.10 USDC to TextLab/).waitFor({ timeout: 120000 });
const settleTx = (await page.locator("div.mt-2.text-sm.text-muted:has-text('Paid 0.10 USDC to TextLab')").locator("a[href*='/tx/']").first().getAttribute("href"))!.split("/tx/")[1] as Hex;
await page.screenshot({ path: "/tmp/shots/real-3-paid.png", fullPage: true });
const afterSettle = await snap();
check("provider payout wallet received exactly 0.10 (native 18dp and ERC-20 6dp)", afterSettle.payoutNative - afterReserve.payoutNative === 100_000n * U && afterSettle.payoutErc20 - afterReserve.payoutErc20 === 100_000n);
check("vault balance fell by exactly 0.10", afterReserve.vaultNative - afterSettle.vaultNative === 100_000n * U);
check("account: reserved down 0.10, spent up 0.10", afterReserve.acct.reserved - afterSettle.acct.reserved === 100_000n && afterSettle.acct.totalSettled - afterReserve.acct.totalSettled === 100_000n);
const [resEv] = (await events(reserveTx)).filter((e) => e.eventName === "UsageReserved");
const [setEv] = (await events(settleTx)).filter((e) => e.eventName === "UsageSettled");
check("UsageReserved event amount 100000, customer, provider", resEv?.eventName === "UsageReserved" && resEv.args.amount === 100_000n && resEv.args.customer.toLowerCase() === customer.toLowerCase() && resEv.args.providerId === providerId);
check("UsageSettled amount 100000 to provider payout", setEv?.eventName === "UsageSettled" && setEv.args.amount === 100_000n && setEv.args.payoutWallet.toLowerCase() === payout.toLowerCase());
check("settled responseHash = keccak256(the displayed Gemini output)", setEv?.eventName === "UsageSettled" && setEv.args.responseHash === keccak256(stringToHex(output)));
const hrefs = await links();
check("explorer links on screen point at the real tx hashes", hrefs.includes(`${EXPLORER}/tx/${reserveTx}`) && hrefs.includes(`${EXPLORER}/tx/${settleTx}`));

// ---- replayed acceptance must fail (API and contract)
check("captured the acceptance the browser sent", Boolean(acceptBody));
const replayApi = await fetch(acceptUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(acceptBody) });
const replayJson = (await replayApi.json()) as { code?: string };
check("API rejects replayed acceptance", replayApi.status === 409 && replayJson.code === "ALREADY_SETTLED", `${replayApi.status} ${replayJson.code}`);
const reservationId = BigInt((await pub.readContract({ address: vault, abi: unspentVaultAbi, functionName: "nextReservationId" })) as bigint) - 1n; // the just-settled request
const replayChain = await pub.simulateContract({ address: vault, abi: unspentVaultAbi, functionName: "acceptAndSettle", args: [{ customer, reservationId, responseHash: setEv!.args.responseHash as Hex, amount: 100_000n, nonce: BigInt(acceptBody!.nonce), deadline: BigInt(acceptBody!.deadline) }, acceptBody!.signature as Hex], account: customer }).then(() => "ALLOWED", (e) => ((e as Error).message.match(/ReservationNotOpen|NonceUsed|reverted/) ?? ["reverted"])[0]);
check("contract rejects replayed acceptance signature", replayChain !== "ALLOWED", replayChain);
const noExtra = await snap();
check("replay moved no funds", noExtra.payoutNative === afterSettle.payoutNative && noExtra.vaultNative === afterSettle.vaultNative);

// ---- second request: reserve + real response, then deliberately NOT accepted (abandoned) -> left to expire
await page.goto(`${APP}/app/use`, { waitUntil: "networkidle" });
await page.getByLabel("Text to summarise").fill(TEXT + " (second request, to be abandoned)");
await page.getByRole("button", { name: /Reserve 0\.10 and run/ }).click();
await page.getByRole("button", { name: /Accept & release 0\.10 USDC to TextLab/ }).waitFor({ timeout: 120000 });
const abandonedId = BigInt((await pub.readContract({ address: vault, abi: unspentVaultAbi, functionName: "nextReservationId" })) as bigint) - 1n;
const abandonedTx = (await page.locator("div.mt-2.text-sm.text-muted:has-text('Reservation #')").locator("a[href*='/tx/']").first().getAttribute("href"))!.split("/tx/")[1] as Hex;
const abandoned = (await pub.readContract({ address: vault, abi: unspentVaultAbi, functionName: "getReservation", args: [abandonedId] })) as { customer: Hex; status: number; expiry: bigint; maxAmount: bigint };
await page.screenshot({ path: "/tmp/shots/hosted-abandoned.png", fullPage: true });
check("second reservation exists onchain: Reserved, 0.10, owned by the fresh wallet", abandoned.status === 1 && abandoned.maxAmount === 100_000n && abandoned.customer.toLowerCase() === customer.toLowerCase());
const end = await snap();
check("closing: Available 0.80, Reserved 0.10 (abandoned), Spent 0.10, Deposited 1.00, Refunded 0", end.acct.available === 800_000n && end.acct.reserved === 100_000n && end.acct.totalSettled === 100_000n && end.acct.totalDeposited === 1_000_000n && end.acct.totalRefunded === 0n);
check("account invariant", end.acct.available + end.acct.reserved + end.acct.totalSettled + end.acct.totalRefunded === end.acct.totalDeposited);
check("vault token balance >= liability (solvency)", end.vaultErc20 >= end.liability, `held=${end.vaultErc20} owed=${end.liability}`);
check("provider payout delta this journey is exactly +0.10", end.payoutNative - before.payoutNative === 100_000n * U);
check("vault delta = +1.00 deposit -0.10 paid", end.vaultNative - before.vaultNative === 900_000n * U);
check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
const health = await fetch(`${process.env.API_URL ?? ""}/api/v1/health`).then((r) => r.json()).catch(() => null) as { version?: string } | null;
const site = await fetch(APP).then((r) => r.text()).catch(() => "");

const result = { when: new Date().toISOString(), kind: "hosted-isolated-journey", app: APP, appBuild: /unspent-build" content="([^"]+)/.exec(site)?.[1] ?? "unknown", apiVersion: health?.version ?? "unknown", walletAdapter: "sandbox EIP-1193 adapter signing with a testnet key (not a physical wallet)", customer, txs: { approveTx, depositTx, reserveTx, settleTx, abandonedReserveTx: abandonedTx }, settledReservationId: reservationId.toString(), abandonedReservationId: abandonedId.toString(), abandonedExpiry: abandoned.expiry.toString(), outputChars: output.length, rateLimitedReceiptReads: n429, checks: out, opening: before, closing: end };
writeFileSync("docs/hosted-verification.json", JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
console.log("\nTXS", JSON.stringify(result.txs, null, 1));
await browser.close();
