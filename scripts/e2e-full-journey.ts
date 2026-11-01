// REAL Arc Testnet browser journey through the app UI with the real Gemini-backed API:
// deposit -> reservation -> actual model response -> acceptance -> settlement -> replay rejected -> refund.
import { chromium } from "playwright-core";
import { decodeEventLog, keccak256, stringToHex, formatUnits, type Hex } from "viem";
import { writeFileSync } from "node:fs";
import { installTestWallet } from "./e2e-wallet";
import { acct, bal, pub, vault, wallet } from "./lib";
import { unspentVaultAbi } from "../src/contracts/abi";
import { deployments } from "../src/contracts/deployments";

const APP = "http://localhost:5173";
const EXPLORER = deployments.testnet.explorer;
const providerId = BigInt(deployments.testnet.providerId!);
const customer = wallet("TESTNET_CUSTOMER_KEY").account.address;
const payout = deployments.testnet.providerPayout as Hex;
const out: Record<string, unknown> = {};
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`); out[name] = { ok, detail }; if (!ok) process.exitCode = 1; };
const nat = (a: Hex) => pub.getBalance({ address: a });
const snap = async () => ({ acct: await acct(providerId, customer), custNative: await nat(customer), payoutNative: await nat(payout), vaultNative: await nat(vault), custErc20: await bal(customer), payoutErc20: await bal(payout), vaultErc20: await bal(vault), liability: (await pub.readContract({ address: vault, abi: unspentVaultAbi, functionName: "totalOutstandingLiability" })) as bigint });
const U = 10n ** 12n; // micro-USDC (6 dp ERC-20 view) -> native 18 dp
async function fee(hash: Hex) { const r = await pub.getTransactionReceipt({ hash }); return r.gasUsed * r.effectiveGasPrice; }
async function events(hash: Hex) { const r = await pub.getTransactionReceipt({ hash }); return r.logs.filter((l) => l.address.toLowerCase() === vault.toLowerCase()).map((l) => decodeEventLog({ abi: unspentVaultAbi, data: l.data, topics: l.topics })); }

const before = await snap();
console.log("BEFORE", JSON.stringify(before, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
const browser = await chromium.launch({ args: ["--disable-gpu", "--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1100 }, colorScheme: "dark" })).newPage();
const pageErrors: string[] = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
let acceptBody: Record<string, string> | undefined;
let acceptUrl = "";
page.on("request", (r) => { if (r.method() === "POST" && /\/usage\/req_[a-f0-9]+\/accept$/.test(r.url())) { acceptBody = JSON.parse(r.postData() ?? "{}"); acceptUrl = r.url(); } });
await installTestWallet(page);
const links = async () => page.$$eval("a[href*='/tx/']", (as) => as.map((a) => (a as HTMLAnchorElement).href));

// ---- connect
await page.goto(`${APP}/app`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /connect/i }).first().click();
await page.getByRole("button", { name: /E2E Test Wallet/ }).click();
await page.waitForSelector("text=/Read from the contract at/");

// ---- deposit 1.00: approval alone must not create credits
await page.goto(`${APP}/app/deposit`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Approve 1\.00 USDC/ }).click();
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
const replayApi = await fetch(acceptUrl.replace("http://localhost:5173", "http://localhost:3001"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(acceptBody) });
const replayJson = (await replayApi.json()) as { code?: string };
check("API rejects replayed acceptance", replayApi.status === 409 && replayJson.code === "ALREADY_SETTLED", `${replayApi.status} ${replayJson.code}`);
const reservationId = BigInt((await pub.readContract({ address: vault, abi: unspentVaultAbi, functionName: "nextReservationId" })) as bigint) - 1n;
const replayChain = await pub.simulateContract({ address: vault, abi: unspentVaultAbi, functionName: "acceptAndSettle", args: [{ customer, reservationId, responseHash: setEv!.args.responseHash as Hex, amount: 100_000n, nonce: BigInt(acceptBody!.nonce), deadline: BigInt(acceptBody!.deadline) }, acceptBody!.signature as Hex], account: customer }).then(() => "ALLOWED", (e) => ((e as Error).message.match(/ReservationNotOpen|NonceUsed|reverted/) ?? ["reverted"])[0]);
check("contract rejects replayed acceptance signature", replayChain !== "ALLOWED", replayChain);
const noExtra = await snap();
check("replay moved no funds", noExtra.payoutNative === afterSettle.payoutNative && noExtra.vaultNative === afterSettle.vaultNative);

// ---- refund remaining available through the UI
await page.goto(`${APP}/app`, { waitUntil: "networkidle" });
await page.waitForSelector("text=/Read from the contract at/");
const availableNow = (await acct(providerId, customer)).available;
await page.getByRole("button", { name: "Withdraw unused" }).click();
await page.getByRole("button", { name: "Max" }).click();
await page.getByRole("button", { name: "Confirm refund" }).click();
await page.getByText(/Your USDC was transferred back to your wallet/).waitFor({ timeout: 90000 });
const refundTx = (await page.getByRole("dialog").locator("a[href*='/tx/']").last().getAttribute("href"))!.split("/tx/")[1] as Hex;
await page.screenshot({ path: "/tmp/shots/real-4-refunded.png" });
const end = await snap();
const [refEv] = (await events(refundTx)).filter((e) => e.eventName === "CreditsRefunded");
check("CreditsRefunded amount = all available", refEv?.eventName === "CreditsRefunded" && refEv.args.amount === availableNow && availableNow > 0n, `${availableNow}`);
check("available is now 0; reserved only the abandoned reservation", end.acct.available === 0n);
const fees = (await fee(approveTx)) + (await fee(depositTx)) + (await fee(refundTx));
const expectedCust = (-1_000_000n + availableNow) * U - fees;
check("customer wallet delta exact (deposit, refund, own gas)", end.custNative - before.custNative === expectedCust, `delta=${formatUnits(end.custNative - before.custNative, 18)} USDC gas=${formatUnits(fees, 18)}`);
check("vault balance delta exact", end.vaultNative - before.vaultNative === (1_000_000n - 100_000n - availableNow) * U);
check("provider total delta exact", end.payoutNative - before.payoutNative === 100_000n * U);
check("vault token balance >= liability (solvency)", end.vaultErc20 >= end.liability, `held=${end.vaultErc20} owed=${end.liability}`);
check("account invariant", end.acct.available + end.acct.reserved + end.acct.totalSettled + end.acct.totalRefunded === end.acct.totalDeposited);
check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

const result = { when: new Date().toISOString(), txs: { approveTx, depositTx, reserveTx, settleTx, refundTx }, reservationId: reservationId.toString(), model: process.env.LLM_MODEL ? "configured" : "", availableRefunded: availableNow.toString(), outputChars: output.length, checks: out, before, end };
writeFileSync("docs/real-journey.json", JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
console.log("\nTXS", JSON.stringify(result.txs, null, 1));
await browser.close();
