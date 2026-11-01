// Recomputes the mainnet cost estimate from the LIVE gas price. Run it immediately before approving anything.
// Gas units are measured on Arc Testnet receipts (docs/testnet-protocol-journey.log); real usage can differ slightly.
import { createPublicClient, http, formatUnits } from "viem";
const c = createPublicClient({ transport: http("https://rpc.mainnet.arc.io") });
const [chainId, block, gasPrice] = await Promise.all([c.getChainId(), c.getBlock(), c.getGasPrice()]);
if (chainId !== 5042) throw new Error(`unexpected chain ${chainId}`);
const units: [string, bigint][] = [["Deploy UnspentVault", 2_502_398n], ["registerProvider", 96_547n], ["approve", 55_438n], ["deposit", 152_237n], ["reserveWithSignature (relayer)", 232_282n], ["acceptAndSettle (relayer)", 207_674n], ["refund", 77_143n]];
console.log(`chain ${chainId} block ${block.number} baseFee ${formatUnits(block.baseFeePerGas ?? 0n, 9)} gwei gasPrice ${formatUnits(gasPrice, 9)} gwei  (${new Date().toISOString()})`);
let sum = 0n, sum2 = 0n;
for (const [name, g] of units) { sum += g * gasPrice; sum2 += g * gasPrice * 2n; console.log(`${name.padEnd(32)} ${g.toString().padStart(8)} gas  ${formatUnits(g * gasPrice, 18)} USDC  (2x price: ${formatUnits(g * gasPrice * 2n, 18)})`); }
console.log(`TOTAL ${formatUnits(sum, 18)} USDC at current price, ${formatUnits(sum2, 18)} USDC if the price doubles. Fees are paid in native USDC (18 decimals); amounts moved are ERC-20 USDC (6 decimals): one asset.`);
