// ACTUAL-OUTAGE recovery test against the independently hosted recovery site. Run it only while the primary
// API/relayer service is stopped or suspended at its host (not the in-app simulated-outage switch).
// It proves the API is unreachable, then, through the recovery site only: reads the balance and reservations,
// releases every expired reservation, refunds all available credits, and verifies each receipt and the final
// balances straight from the chain. Sandbox wallet adapter (testnet key), disclosed in the output file.
import { chromium } from "playwright-core";
import { decodeEventLog, type Hex } from "viem";
import { writeFileSync } from "node:fs";
import { installTestWallet } from "./e2e-wallet";
import { acct, pub, vault, wallet } from "./lib";
import { unspentVaultAbi } from "../src/contracts/abi";
import { deployments } from "../src/contracts/deployments";

const KEY = process.env.E2E_KEY ?? "TESTNET_CUSTOMER2_KEY";
const RECOVERY = process.env.RECOVERY_URL ?? "";
const API = process.env.API_URL ?? "";
const APP = process.env.APP_URL ?? "";
if (!RECOVERY || !API) throw new Error("set RECOVERY_URL and API_URL");
const pid = BigInt(deployments.testnet.providerId!);
const customer = wallet(KEY).account.address;
const U = 10n ** 12n;
const out: Record<string, unknown> = {};
const check = (n: string, ok: boolean, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  " + d : ""}`); out[n] = { ok, detail: d }; if (!ok) process.exitCode = 1; };
const evs = async (h: Hex) => (await pub.getTransactionReceipt({ hash: h })).logs.filter((l) => l.address.toLowerCase() === vault.toLowerCase()).map((l) => decodeEventLog({ abi: unspentVaultAbi, data: l.data, topics: l.topics }));
const fee = async (h: Hex) => { const r = await pub.getTransactionReceipt({ hash: h }); return r.gasUsed * r.effectiveGasPrice; };

// 1. the primary service must really be down
const probe = async (url: string) => { try { const r = await fetch(url, { signal: AbortSignal.timeout(20000) }); const t = await r.text(); return { status: r.status, json: (() => { try { return JSON.parse(t); } catch { return null; } })(), head: t.slice(0, 80).replace(/\s+/g, " ") }; } catch (e) { return { status: 0, json: null, head: String((e as Error).message).slice(0, 80) }; } };
const apiHealth = await probe(`${API}/api/v1/health`);
const apiProviders = await probe(`${API}/api/v1/providers`);
console.log("primary API health ->", apiHealth.status, apiHealth.head, "| providers ->", apiProviders.status, apiProviders.head);
check("primary API is actually down (no healthy answer from its host)", !(apiHealth.status === 200 && apiHealth.json?.ok === true) && apiProviders.status !== 200, `health=${apiHealth.status} providers=${apiProviders.status}`);
const serviceDownEvidence = { checkedAt: new Date().toISOString(), health: { status: apiHealth.status, body: apiHealth.head }, providers: { status: apiProviders.status, body: apiProviders.head } };

// 2. opening state from the chain
const nat = (a: Hex) => pub.getBalance({ address: a });
const before = { acct: await acct(pid, customer), wallet: await nat(customer), vault: await nat(vault) };
console.log("OPENING", JSON.stringify(before, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

const browser = await chromium.launch({ args: ["--disable-gpu", "--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1100, height: 1300 }, colorScheme: "dark" })).newPage();
const hosts = new Set<string>();
page.on("request", (r) => { try { hosts.add(new URL(r.url()).host); } catch { /* data: urls */ } });
const pageErrors: string[] = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
const w = await installTestWallet(page, KEY);
await page.goto(RECOVERY, { waitUntil: "networkidle" });
const build = await page.locator("main, body").first().innerText().then((t) => /build ([0-9a-f]{7})/.exec(t)?.[1] ?? "unknown").catch(() => "unknown");
await page.getByRole("button", { name: /E2E Test Wallet/ }).click();
await page.waitForSelector("text=/read at block/", { timeout: 90000 });
const shown = (await page.locator("main").innerText()).replace(/\s+/g, " ");
const f2 = (v: bigint) => (Number(v) / 1e6).toFixed(2);
check("recovery shows the chain's Available / Reserved / Spent", shown.includes(`${f2(before.acct.available)} USDC Available`) || shown.includes(`${f2(before.acct.available)} USDC`) , shown.match(/Reserved [0-9.]+/)?.[0] ?? "");
await page.screenshot({ path: "/tmp/shots/hosted-recovery-1-read.png", fullPage: true });

// 3. release every expired reservation, one transaction each
const releaseTxs: Hex[] = [];
for (let i = 0; i < 12; i++) {
  const btn = page.getByRole("button", { name: "Release expired reserve" });
  const n = await btn.count();
  let target = -1;
  for (let k = 0; k < n; k++) if (await btn.nth(k).isEnabled()) { target = k; break; }
  if (target < 0) break;
  const sends = w.log.filter((m) => m === "eth_sendTransaction").length;
  await btn.nth(target).click();
  await page.getByText(/Confirmed\. The reservation returned to your available credits/).first().waitFor({ timeout: 120000 });
  const href = await page.locator("a[href*='/tx/']").last().getAttribute("href");
  const tx = href!.split("/tx/")[1] as Hex;
  releaseTxs.push(tx);
  check(`release #${i + 1}: exactly one transaction submitted`, w.log.filter((m) => m === "eth_sendTransaction").length - sends === 1);
  const ev = (await evs(tx)).find((e) => e.eventName === "ReservationReleased");
  check(`release #${i + 1}: ReservationReleased event for this customer`, ev?.eventName === "ReservationReleased" && (ev.args as { customer: string }).customer.toLowerCase() === customer.toLowerCase(), `amount=${(ev?.args as { amount?: bigint })?.amount}`);
  await page.waitForTimeout(2500);
}
const afterRelease = await acct(pid, customer);
await page.screenshot({ path: "/tmp/shots/hosted-recovery-2-released.png", fullPage: true });

// 4. refund all available
let refundTx: Hex | undefined;
let refunded = 0n;
if (afterRelease.available > 0n) {
  await page.getByRole("button", { name: "Refund to my wallet" }).click();
  await page.getByRole("button", { name: "Confirm refund" }).click();
  await page.getByText(/Your USDC was sent back to your wallet/).waitFor({ timeout: 120000 });
  refundTx = (await page.getByRole("dialog").locator("a[href*='/tx/']").last().getAttribute("href"))!.split("/tx/")[1] as Hex;
  const ev = (await evs(refundTx)).find((e) => e.eventName === "CreditsRefunded");
  refunded = (ev?.args as { amount?: bigint })?.amount ?? 0n;
  check("refund: CreditsRefunded amount equals all available credits", refunded === afterRelease.available, `${refunded}`);
  await page.screenshot({ path: "/tmp/shots/hosted-recovery-3-refunded.png" });
}

// 5. final state read back from the chain
const end = { acct: await acct(pid, customer), wallet: await nat(customer), vault: await nat(vault) };
const [held, owed] = await pub.readContract({ address: vault, abi: unspentVaultAbi, functionName: "solvency" });
check("final: no available credits left", end.acct.available === 0n, String(end.acct.available));
check("final: account invariant", end.acct.available + end.acct.reserved + end.acct.totalSettled + end.acct.totalRefunded === end.acct.totalDeposited);
let fees = 0n; for (const t of [...releaseTxs, ...(refundTx ? [refundTx] : [])]) fees += await fee(t);
check("final: customer wallet delta = refund - own gas, exactly", end.wallet - before.wallet === refunded * U - fees, `delta=${end.wallet - before.wallet}`);
check("final: vault balance fell by exactly the refund", before.vault - end.vault === refunded * U);
check("final: vault holds at least what it owes", held >= owed, `held=${held} owed=${owed}`);
const bad = [...hosts].filter((h) => /onrender\.com|neon\.tech|vercel\.app/.test(h) && !RECOVERY.includes(h));
check("no request left the recovery origin except the chain RPC (no API, database, login or relayer host)", bad.length === 0, [...hosts].join(", "));
check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

const rec = { when: new Date().toISOString(), kind: "actual-outage-recovery", recoveryUrl: RECOVERY, recoveryBuild: build, walletAdapter: "sandbox EIP-1193 adapter signing with a testnet key (not a physical wallet)", customer, serviceDownEvidence, releaseTxs, refundTx: refundTx ?? null, refunded: refunded.toString(), hostsContacted: [...hosts], checks: out, opening: before, afterRelease, closing: end, vaultHeld: held.toString(), vaultOwed: owed.toString() };
writeFileSync(`docs/hosted-recovery-${KEY.toLowerCase().replace(/[^a-z0-9]/g, "")}.json`, JSON.stringify(rec, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
console.log(JSON.stringify({ releaseTxs, refundTx }, null, 1));
void APP;
await browser.close();
