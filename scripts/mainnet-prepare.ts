// Builds the mainnet APPROVAL SHEET from live chain data. It sends nothing and needs no key.
// Usage: MAINNET_DEPLOYER=0x.. MAINNET_PROVIDER_OWNER=0x.. MAINNET_PAYOUT=0x.. MAINNET_CUSTOMER=0x.. MAINNET_RELAYER=0x.. bun scripts/mainnet-prepare.ts
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { concat, createPublicClient, encodeAbiParameters, erc20Abi, formatUnits, getContractAddress, http, isAddress, keccak256, type Address, type Hex } from "viem";

const USDC = "0x3600000000000000000000000000000000000000" as Address;
const c = createPublicClient({ transport: http("https://rpc.mainnet.arc.io", { retryCount: 6, retryDelay: 1000 }) });
const who = { deployer: process.env.MAINNET_DEPLOYER, providerOwner: process.env.MAINNET_PROVIDER_OWNER, payout: process.env.MAINNET_PAYOUT, customer: process.env.MAINNET_CUSTOMER, relayer: process.env.MAINNET_RELAYER } as Record<string, string | undefined>;
const missing = Object.entries(who).filter(([, v]) => !v || !isAddress(v)).map(([k]) => k);
const git = (a: string[]) => spawnSync("git", a, { encoding: "utf8" }).stdout.trim();

const [chainId, block, gasPrice] = await Promise.all([c.getChainId(), c.getBlock(), c.getGasPrice()]);
if (chainId !== 5042) throw new Error(`Connected to chain ${chainId}, expected 5042`);
const code = await c.getCode({ address: USDC });
const [dec, sym] = await Promise.all([c.readContract({ address: USDC, abi: erc20Abi, functionName: "decimals" }), c.readContract({ address: USDC, abi: erc20Abi, functionName: "symbol" })]);
const art = JSON.parse(readFileSync("contracts/out/UnspentVault.sol/UnspentVault.json", "utf8"));
const ctorArgs = encodeAbiParameters([{ type: "address" }], [USDC]);
const initcode = concat([art.bytecode.object as Hex, ctorArgs]);
const srcCommit = git(["log", "-1", "--format=%H", "--", "contracts/UnspentVault.sol"]);
const head = git(["rev-parse", "HEAD"]);
const srcHash = keccak256(`0x${Buffer.from(readFileSync("contracts/UnspentVault.sol")).toString("hex")}`);

const U = 1_000_000n; const X = 10n ** 12n;
const units = { deploy: 2_502_398n, register: 96_547n, approve: 55_438n, deposit: 152_237n, reserve: 232_282n, settle: 207_674n, refund: 77_143n };
const fee = (g: bigint, mult = 2n) => g * gasPrice * mult; // 2x price headroom
let deployGas = units.deploy, nonce: number | undefined, predicted: Address | undefined;
if (!missing.includes("deployer")) {
  nonce = await c.getTransactionCount({ address: who.deployer as Address });
  predicted = getContractAddress({ from: who.deployer as Address, nonce: BigInt(nonce) });
  deployGas = await c.estimateGas({ account: who.deployer as Address, data: initcode }).catch(() => units.deploy);
}
const f = (v: bigint) => formatUnits(v, 18);
const u = (v: bigint) => { const t = formatUnits(v, 6); return t.includes(".") ? t.padEnd(t.indexOf(".") + 3, "0") : `${t}.00`; };
const need = {
  deployer: fee(deployGas),
  providerOwner: fee(units.register),
  customer: 1n * U * X + fee(units.approve + units.deposit + units.refund),
  relayer: fee(units.reserve + units.settle),
};
const bal = async (a?: string) => (a && isAddress(a) ? await c.getBalance({ address: a as Address }) : undefined);
const balances = { deployer: await bal(who.deployer), providerOwner: await bal(who.providerOwner), customer: await bal(who.customer), relayer: await bal(who.relayer) };
const row = (name: string, addr: string | undefined, needV: bigint, have: bigint | undefined) => `| ${name} | ${addr ?? "**NEEDED**"} | ${f(needV)} | ${have === undefined ? "?" : f(have)} | ${have !== undefined && have >= needV ? "funded" : "needs funding"} |`;
const total = fee(deployGas) + fee(units.register) + fee(units.approve + units.deposit + units.refund) + fee(units.reserve + units.settle);

const md = `# Mainnet approval sheet (generated ${new Date().toISOString()})

**Nothing in this sheet has been executed. No real-fund transaction is submitted without your explicit approval. Never share a seed phrase or private key.**
Regenerate immediately before approving: \`bun scripts/mainnet-prepare.ts\` (it reads live chain data and sends nothing).

${missing.length ? `> Addresses still needed from you (public addresses only): ${missing.join(", ")}\n` : ""}
## Network and token (read live from https://rpc.mainnet.arc.io)
- Chain ID: ${chainId} (expected 5042) · latest block ${block.number} · base fee ${formatUnits(block.baseFeePerGas ?? 0n, 9)} gwei · gas price ${formatUnits(gasPrice, 9)} gwei
- USDC ERC-20 interface: \`${USDC}\` · code present: ${code && code !== "0x" ? "yes" : "NO"} · symbol ${sym} · decimals ${dec} (ERC-20 view). Native gas uses 18 decimals: same asset.
- Explorer: https://explorer.arc.io

## Contract
- Contract: \`UnspentVault\` · Solidity 0.8.28 · EVM cancun · OpenZeppelin 5.6.1 · no owner, no proxy.
- Constructor argument: \`${USDC}\` (USDC). Encoded: \`${ctorArgs}\`
- Reviewed source: file \`contracts/UnspentVault.sol\` last changed in commit \`${srcCommit}\`; repo HEAD when generated \`${head}\`; keccak256(source) \`${srcHash}\`.
- Creation bytecode keccak256 (artifact + constructor args): \`${keccak256(initcode)}\`
- Review status: 200 Foundry tests, Slither, internal review. **No independent audit.**
- Deployer next nonce: ${nonce ?? "?"} → predicted vault address: \`${predicted ?? "(needs deployer address)"}\`

## Wallets
| Role | Address | Funding needed (USDC, incl. 2x gas headroom) | Current balance (USDC) | Status |
|---|---|---|---|---|
${row("Deployer", who.deployer, need.deployer, balances.deployer)}
${row("Provider owner (registers, can change payout)", who.providerOwner, need.providerOwner, balances.providerOwner)}
| Provider payout (receives 0.10) | ${who.payout ?? "**NEEDED**"} | 0 | n/a | receive-only |
${row("Demo customer (signs, deposits 1.00)", who.customer, need.customer, balances.customer)}
${row("Relayer (hot key on the API host; low balance)", who.relayer, need.relayer, balances.relayer)}

## Transactions, in order
| # | Action | Sender | Funds moved | Est. gas | Est. fee at current price (USDC) |
|---|---|---|---|---|---|
| 1 | Deploy UnspentVault(USDC) | deployer | 0 | ${deployGas} | ${f(deployGas * gasPrice)} |
| 2 | registerProvider(payout, metadataHash) | provider owner | 0 | ${units.register} | ${f(units.register * gasPrice)} |
| 3 | (offchain) update deployments.json with vault, block and provider ID; sync; rebuild; redeploy | you | 0 | | |
| 4 | USDC.approve(vault, ${u(1n * U)}) | customer | allowance 1.00 | ${units.approve} | ${f(units.approve * gasPrice)} |
| 5 | vault.deposit(providerId, ${u(1n * U)}) | customer | **1.00 USDC into the vault** | ${units.deposit} | ${f(units.deposit * gasPrice)} |
| 6 | reserveWithSignature (customer-signed limit 0.10) | relayer | 0.10 reserved | ${units.reserve} | ${f(units.reserve * gasPrice)} |
| 7 | acceptAndSettle (customer-signed acceptance of the real response) | relayer | **0.10 to the payout wallet** | ${units.settle} | ${f(units.settle * gasPrice)} |
| 8 | vault.refund(providerId, ${u(9n * U / 10n)}) | customer | **0.90 back to customer** | ${units.refund} | ${f(units.refund * gasPrice)} |

Amounts: deposit 1.00 · settlement 0.10 · refund 0.90 USDC (micro-USDC 1000000 / 100000 / 900000).
Estimated total fees at the current price: ${f(units.deploy * gasPrice + units.register * gasPrice + (units.approve + units.deposit + units.refund + units.reserve + units.settle) * gasPrice)} USDC. With 2x headroom: ${f(total)} USDC. Not a fixed cost.
Customer funds at risk in the journey: 1.00 USDC (0.10 goes to your own payout wallet).

## Verification after each step
Chain ID 5042; vault \`usdc()\` equals the USDC address; deployed bytecode equals the artifact with immutables masked; provider owner/payout as intended; then each receipt, event amount and balance delta is re-read by \`scripts/verify-claims.ts\`-style checks before anything is reported.
`;
writeFileSync("docs/mainnet-approval.md", md);
console.log(md.split("\n").slice(0, 45).join("\n"));
