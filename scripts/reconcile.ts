// Rebuilds every account's ledger from chain events only, checks it against the contract's own numbers,
// lists every reservation (owner, status, expiry) and checks that held funds cover liabilities.
// Writes docs/testnet-reconciliation.md. Read-only: sends nothing.
import { decodeEventLog, formatUnits, type Address, type Hex } from "viem";
import { writeFileSync, readFileSync } from "node:fs";
import { pub, vault, usdc } from "./lib";
import { unspentVaultAbi } from "../src/contracts/abi";
import { deployments } from "../src/contracts/deployments";
import { erc20Abi } from "viem";

const dep = deployments.testnet;
const u = (v: bigint) => formatUnits(v, 6);
const head = await pub.getBlockNumber();
type Ev = { kind: string; customer: Address; providerId: bigint; amount: bigint; reservationId?: bigint; tx: Hex; block: bigint; li: number; expiry?: bigint };
const evs: Ev[] = [];
let step = 20_000n;
for (let s = BigInt(dep.deploymentBlock!); s <= head; ) {
  const e = s + step - 1n > head ? head : s + step - 1n;
  try {
    const logs = await pub.getLogs({ address: vault, fromBlock: s, toBlock: e });
    for (const l of logs) {
      let d;
      try { d = decodeEventLog({ abi: unspentVaultAbi, data: l.data, topics: l.topics }); } catch { continue; }
      const a = d.args as Record<string, any>;
      const base = { customer: a.customer as Address, providerId: a.providerId as bigint, amount: a.amount as bigint, tx: l.transactionHash!, block: l.blockNumber!, li: l.logIndex! };
      if (d.eventName === "CreditsDeposited") evs.push({ ...base, kind: "deposit" });
      if (d.eventName === "UsageReserved") evs.push({ ...base, kind: "reserve", reservationId: a.reservationId, expiry: a.expiry });
      if (d.eventName === "UsageSettled") evs.push({ ...base, kind: "settle", reservationId: a.reservationId });
      if (d.eventName === "ReservationReleased") evs.push({ ...base, kind: "release", reservationId: a.reservationId });
      if (d.eventName === "CreditsRefunded") evs.push({ ...base, kind: "refund" });
    }
    s = e + 1n;
  } catch (err) { if (step > 1_000n) step /= 2n; else throw err; }
}
evs.sort((a, b) => (a.block === b.block ? a.li - b.li : a.block < b.block ? -1 : 1));

const key = (c: Address, p: bigint) => `${c.toLowerCase()}:${p}`;
const run = new Map<string, { available: bigint; reserved: bigint; deposited: bigint; settled: bigint; refunded: bigint }>();
const get = (c: Address, p: bigint) => run.get(key(c, p)) ?? (run.set(key(c, p), { available: 0n, reserved: 0n, deposited: 0n, settled: 0n, refunded: 0n }), run.get(key(c, p))!);
const resAmt = new Map<string, bigint>();
const rows: Record<string, string[]> = {};
for (const e of evs) {
  const a = get(e.customer, e.providerId);
  if (e.kind === "deposit") { a.available += e.amount; a.deposited += e.amount; }
  if (e.kind === "reserve") { a.available -= e.amount; a.reserved += e.amount; resAmt.set(e.reservationId!.toString(), e.amount); }
  if (e.kind === "settle") { const max = resAmt.get(e.reservationId!.toString())!; a.reserved -= max; a.available += max - e.amount; a.settled += e.amount; }
  if (e.kind === "release") { a.reserved -= e.amount; a.available += e.amount; }
  if (e.kind === "refund") { a.available -= e.amount; a.refunded += e.amount; }
  (rows[e.customer.toLowerCase()] ??= []).push(`| ${e.block} | ${e.kind}${e.reservationId ? ` #${e.reservationId}` : ""} | ${u(e.amount)} | ${u(a.available)} | ${u(a.reserved)} | ${u(a.settled)} | ${u(a.refunded)} | \`${e.tx}\` |`);
}

// ---- compare rebuilt ledger with the contract
const lines: string[] = [];
let allMatch = true, liability = 0n;
for (const [k, r] of run) {
  const [c, p] = k.split(":");
  const onchain = await pub.readContract({ address: vault, abi: unspentVaultAbi, functionName: "getAccount", args: [BigInt(p), c as Address] }) as readonly bigint[];
  const ok = onchain[0] === r.available && onchain[1] === r.reserved && onchain[2] === r.deposited && onchain[3] === r.settled && onchain[4] === r.refunded;
  const ident = r.available + r.reserved + r.settled + r.refunded === r.deposited;
  if (!ok || !ident) allMatch = false;
  liability += onchain[0] + onchain[1];
  lines.push(`| \`${c}\` | ${p} | ${u(onchain[0])} | ${u(onchain[1])} | ${u(onchain[2])} | ${u(onchain[3])} | ${u(onchain[4])} | ${ok ? "yes" : "NO"} | ${ident ? "yes" : "NO"} |`);
}

// ---- every reservation
const next = await pub.readContract({ address: vault, abi: unspentVaultAbi, functionName: "nextReservationId" }) as bigint;
const blk = await pub.getBlock();
const resLines: string[] = [];
const STATUS = ["None", "Reserved", "Settled", "Released"];
for (let id = 1n; id < next; id++) {
  const r = await pub.readContract({ address: vault, abi: unspentVaultAbi, functionName: "getReservation", args: [id] }) as any;
  const exp = BigInt(r.expiry);
  resLines.push(`| ${id} | \`${r.customer}\` | ${r.providerId} | ${STATUS[r.status]} | ${u(r.maxAmount)} | ${u(r.settledAmount)} | ${new Date(Number(exp) * 1000).toISOString()} | ${r.status === 1 ? (blk.timestamp >= exp ? "EXPIRED: releasable now" : "not yet expired") : "-"} |`);
}
const [held, owed] = await pub.readContract({ address: vault, abi: unspentVaultAbi, functionName: "solvency" });
const erc = await pub.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [vault] });
const nat = await pub.getBalance({ address: vault });

const md = `# Testnet reconciliation (generated ${new Date().toISOString()})

Rebuilt from vault events only (Arc Testnet, chain ${dep.chainId}, vault \`${vault}\`, blocks ${dep.deploymentBlock}..${head}; chain time ${new Date(Number(blk.timestamp) * 1000).toISOString()}), then compared with the contract's own account data. USDC amounts; ledger values are 6-decimal.

## Accounts: rebuilt ledger vs contract
| Customer | Provider | Available | Reserved | Deposited | Spent | Refunded | Matches contract | available+reserved+spent+refunded = deposited |
|---|---|---|---|---|---|---|---|---|
${lines.join("\n")}

All accounts reconcile: **${allMatch}**.

## Solvency
- vault.solvency(): token balance ${u(held)} vs liability ${u(owed)}; ERC-20 view ${u(erc)}; native view ${formatUnits(nat, 18)} (same asset, 18-decimal view).
- Sum of Available+Reserved over every account: ${u(liability)}. Covered: **${held >= owed && owed === liability}**.

## Every reservation
| ID | Owner | Provider | Status | Max | Settled | Expiry (UTC) | State vs chain time |
|---|---|---|---|---|---|---|---|
${resLines.join("\n")}

## Per-account event ledger (running balances after each event)
${Object.entries(rows).map(([c, r]) => `### ${c}\n| Block | Event | Amount | Available | Reserved | Spent | Refunded | Tx |\n|---|---|---|---|---|---|---|---|\n${r.join("\n")}`).join("\n\n")}
`;
writeFileSync("docs/testnet-reconciliation.md", md);
console.log(md.split("\n").slice(0, 40).join("\n"));
void readFileSync;
