// Testnet helper: approve + deposit N micro-USDC for the test customer (default 1 USDC).
import { erc20Abi } from "viem";
import { wallet, send, vault, usdc, acct } from "./lib";
import { unspentVaultAbi } from "../src/contracts/abi";
import { deployments } from "../src/contracts/deployments";
const amount = BigInt(process.argv[2] ?? "1000000");
const c = wallet("TESTNET_CUSTOMER_KEY");
const pid = BigInt(deployments.testnet.providerId!);
await send("approve", () => c.client.writeContract({ address: usdc, abi: erc20Abi, functionName: "approve", args: [vault, amount] }));
await send("deposit", () => c.client.writeContract({ address: vault, abi: unspentVaultAbi, functionName: "deposit", args: [pid, amount] }));
console.log(await acct(pid, c.account.address));
