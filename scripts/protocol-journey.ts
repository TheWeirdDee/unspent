// PROTOCOL-LEVEL Arc Testnet journey (no API, no LLM). The response hash below is a FIXED TEST STRING,
// clearly not a model output: this proves contract accounting only. The real API journey is scripts/journey.ts.
import { erc20Abi, keccak256, stringToHex, parseEventLogs, type Hex } from "viem";
import { writeFileSync } from "node:fs";
import { pub, wallet, send, vault, usdc, bal, acct, net } from "./lib";
import { unspentVaultAbi } from "../src/contracts/abi";
import { ACCEPT_TYPES, RESERVE_TYPES, vaultDomain } from "../src/lib/protocol";
import { deployments } from "../src/contracts/deployments";

const providerId = BigInt(deployments.testnet.providerId ?? 0);
if (!providerId) throw new Error("run scripts/testnet-setup.ts first");
const customer = wallet("TESTNET_CUSTOMER_KEY");
const relayer = wallet("TESTNET_RELAYER_KEY");
const payoutAddr = deployments.testnet.providerPayout as Hex;
const domain = vaultDomain(net.chainId, vault);
const lines: string[] = [];
const log = (s: string) => { console.log(s); lines.push(s); };
const fmt = (a: Awaited<ReturnType<typeof acct>>) => `available=${a.available} reserved=${a.reserved} deposited=${a.totalDeposited} settled=${a.totalSettled} refunded=${a.totalRefunded}`;
const now = async () => Number((await pub.getBlock()).timestamp);
const provider = await pub.readContract({ address: vault, abi: unspentVaultAbi, functionName: "getProvider", args: [providerId] });

async function reserve(tag: string, amount: bigint, authIn: number, expiryIn: number, nonce: bigint) {
  const t = await now();
  const message = {
    customer: customer.account.address,
    providerId,
    payoutWallet: provider.payoutWallet,
    payoutVersion: provider.payoutVersion,
    requestHash: keccak256(stringToHex(`protocol-journey:${tag}:${t}`)),
    maxAmount: amount,
    nonce,
    authDeadline: BigInt(t + authIn),
    expiry: BigInt(t + expiryIn),
  };
  const signature = await customer.client.signTypedData({ domain, types: RESERVE_TYPES, primaryType: "ReserveAuthorisation", message });
  const receipt = await send(`reserveWithSignature(${tag}) via relayer`, () =>
    relayer.client.writeContract({ address: vault, abi: unspentVaultAbi, functionName: "reserveWithSignature", args: [message, signature] }),
  );
  const [ev] = parseEventLogs({ abi: unspentVaultAbi, eventName: "UsageReserved", logs: receipt.logs });
  return { reservationId: ev.args.reservationId, expiry: message.expiry, tx: receipt.transactionHash };
}

log(`# Arc Testnet protocol journey (contract accounting only)\n`);
log(`vault ${vault}  provider ${providerId}  customer ${customer.account.address}`);
const runId = BigInt(Date.now());
log(`before: ${fmt(await acct(providerId, customer.account.address))}`);
const dep = 1_000_000n;
await send("approve 1.00 USDC (approval only, no credits)", () => customer.client.writeContract({ address: usdc, abi: erc20Abi, functionName: "approve", args: [vault, dep] }));
log(`after approve (no deposit yet): ${fmt(await acct(providerId, customer.account.address))}`);
await send("deposit 1.00 USDC", () => customer.client.writeContract({ address: vault, abi: unspentVaultAbi, functionName: "deposit", args: [providerId, dep] }));
log(`after deposit: ${fmt(await acct(providerId, customer.account.address))}`);

// A: reserve 0.10, settle with customer-signed acceptance (relayer submits)
const A = await reserve("A-settle", 100_000n, 300, 900, runId);
log(`reserved A id=${A.reservationId}: ${fmt(await acct(providerId, customer.account.address))}`);
const payoutBefore = await bal(payoutAddr);
const responseHash = keccak256(stringToHex("PROTOCOL-TEST ONLY: fixed string, not a model output"));
const acceptance = { customer: customer.account.address, reservationId: A.reservationId, responseHash, amount: 100_000n, nonce: runId, deadline: BigInt((await now()) + 300) };
const accSig = await customer.client.signTypedData({ domain, types: ACCEPT_TYPES, primaryType: "DeliveryAcceptance", message: acceptance });
await send("acceptAndSettle(A) via relayer", () => relayer.client.writeContract({ address: vault, abi: unspentVaultAbi, functionName: "acceptAndSettle", args: [acceptance, accSig] }));
log(`payout wallet received: ${(await bal(payoutAddr)) - payoutBefore} micro-USDC`);
log(`after settle: ${fmt(await acct(providerId, customer.account.address))}`);

// B: reserve 0.10 with a short expiry, show settlement is refused at/after expiry, then release
const B = await reserve("B-expire", 100_000n, 20, 45, runId + 1n);
log(`reserved B id=${B.reservationId} expiry=${B.expiry}: ${fmt(await acct(providerId, customer.account.address))}`);
const earlyRelease = await pub.simulateContract({ address: vault, abi: unspentVaultAbi, functionName: "releaseExpired", args: [B.reservationId], account: relayer.account }).then(() => "UNEXPECTEDLY ALLOWED", (e) => (e as Error).message.split("\n")[0]);
log(`releaseExpired before expiry -> ${earlyRelease}`);
while ((await now()) < Number(B.expiry)) await new Promise((r) => setTimeout(r, 2000));
const lateSettle = await pub.simulateContract({ address: vault, abi: unspentVaultAbi, functionName: "settleDirect", args: [B.reservationId, responseHash, 100_000n], account: customer.account }).then(() => "UNEXPECTEDLY ALLOWED", (e) => (e as Error).message.split("\n")[0]);
log(`settleDirect at/after expiry -> ${lateSettle}`);
await send("releaseExpired(B) by third party (relayer)", () => relayer.client.writeContract({ address: vault, abi: unspentVaultAbi, functionName: "releaseExpired", args: [B.reservationId] }));
log(`after release: ${fmt(await acct(providerId, customer.account.address))}`);

// Refund the remaining available
const a = await acct(providerId, customer.account.address);
const custBefore = await bal(customer.account.address);
await send(`refund ${a.available} micro-USDC`, () => customer.client.writeContract({ address: vault, abi: unspentVaultAbi, functionName: "refund", args: [providerId, a.available] }));
log(`customer USDC delta (includes gas, same asset): ${(await bal(customer.account.address)) - custBefore}`);
log(`after refund: ${fmt(await acct(providerId, customer.account.address))}`);
const [tokenBalance, liability] = await pub.readContract({ address: vault, abi: unspentVaultAbi, functionName: "solvency" });
log(`solvency: tokenBalance=${tokenBalance} liability=${liability}`);
writeFileSync(new URL("../docs/testnet-protocol-journey.log", import.meta.url).pathname, lines.join("\n") + "\n");
