// Independent re-verification using ONLY the public RPC and the repo's recorded hashes (no app, no API, no browser).
import { readFileSync } from "node:fs";
import { createPublicClient, decodeEventLog, http, keccak256, type Hex } from "viem";
import { unspentVaultAbi } from "../src/contracts/abi";
import { deployments } from "../src/contracts/deployments";
import { PROOF_API, PROOF_TESTNET } from "../src/lib/proof";

const d = deployments.testnet, vault = d.vault as Hex;
const c = createPublicClient({ transport: http(d.rpcUrls[0], { retryCount: 8, retryDelay: 1000 }) });
let fail = 0;
const ok = (name: string, pass: boolean, detail = "") => { console.log(`${pass ? "VERIFIED" : "FAILED  "} ${name}${detail ? "  " + detail : ""}`); if (!pass) fail++; };

ok("chain id is Arc Testnet 5042002", (await c.getChainId()) === d.chainId);
const all = [...PROOF_TESTNET, ...PROOF_API];
let reverted = 0;
const events: Record<string, { name: string; args: Record<string, unknown> }[]> = {};
for (const t of all) {
  const r = await c.getTransactionReceipt({ hash: t.hash });
  if (r.status !== "success") reverted++;
  events[t.hash] = r.logs.filter((l) => l.address.toLowerCase() === vault).map((l) => { const e = decodeEventLog({ abi: unspentVaultAbi, data: l.data, topics: l.topics }); return { name: e.eventName, args: e.args as Record<string, unknown> }; });
}
ok(`all ${all.length} recorded transactions exist and succeeded`, reverted === 0);

const j = JSON.parse(readFileSync("docs/real-journey.json", "utf8"));
const has = (h: Hex, name: string, f?: (a: Record<string, unknown>) => boolean) => (events[h] ?? []).some((e) => e.name === name && (!f || f(e.args)));
ok("deposit tx emitted CreditsDeposited 1000000", has(j.txs.depositTx, "CreditsDeposited", (a) => a.amount === 1_000_000n));
ok("reserve tx emitted UsageReserved 100000", has(j.txs.reserveTx, "UsageReserved", (a) => a.amount === 100_000n));
ok("settle tx emitted UsageSettled 100000 to the provider payout wallet", has(j.txs.settleTx, "UsageSettled", (a) => a.amount === 100_000n && String(a.payoutWallet).toLowerCase() === String(d.providerPayout).toLowerCase()));
ok("refund tx emitted CreditsRefunded", has(j.txs.refundTx, "CreditsRefunded"));
const rel = JSON.parse(readFileSync("docs/release-reservation-3.json", "utf8"));
ok("release tx emitted ReservationReleased #3 (100000)", has(rel.releaseTx, "ReservationReleased", (a) => a.reservationId === 3n && a.amount === 100_000n));
const relR = await c.getTransactionReceipt({ hash: rel.releaseTx }); const relB = await c.getBlock({ blockNumber: relR.blockNumber });
const res3 = await c.readContract({ address: vault, abi: unspentVaultAbi, functionName: "getReservation", args: [3n] });
ok("release happened at/after the onchain expiry", relB.timestamp >= res3.expiry, `block time ${relB.timestamp} >= expiry ${res3.expiry}`);

const [held, owed] = await c.readContract({ address: vault, abi: unspentVaultAbi, functionName: "solvency" });
ok("vault solvency now: held >= owed", held >= owed, `held=${held} owed=${owed}`);
const art = JSON.parse(readFileSync("contracts/out/UnspentVault.sol/UnspentVault.json", "utf8"));
const refs = art.deployedBytecode.immutableReferences as Record<string, { start: number; length: number }[]>;
const mask = (hex: string) => { const b = hex.split(""); for (const id in refs) for (const r of refs[id]) for (let i = r.start * 2; i < (r.start + r.length) * 2; i++) b[i] = "0"; return b.join(""); };
const onchain = ((await c.getCode({ address: vault })) as string).slice(2);
ok("deployed bytecode == compiled artifact (immutables masked)", keccak256(`0x${mask(onchain)}`) === keccak256(`0x${mask(art.deployedBytecode.object.slice(2))}`));
const resp = await c.simulateContract({ address: vault, abi: unspentVaultAbi, functionName: "registerProvider", args: [vault, `0x${"00".repeat(32)}`], account: d.providerOwner as Hex }).then(() => "allowed", (e) => (/InvalidPayoutWallet/.test((e as Error).message) ? "InvalidPayoutWallet" : "other revert"));
ok("payout-wallet fix is live on the deployed address", resp === "InvalidPayoutWallet", resp);
const totalSettled = events[j.txs.settleTx].length;
console.log(fail ? `\n${fail} FAILED` : `\nall verified (${totalSettled} vault event(s) in the recorded settle tx)`);
process.exit(fail ? 1 : 0);
