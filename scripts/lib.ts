import { createPublicClient, createWalletClient, http, defineChain, erc20Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { deployments } from "../src/contracts/deployments";
import { unspentVaultAbi } from "../src/contracts/abi";

export function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync(new URL("../.env", import.meta.url).pathname, "utf8").split("\n")) {
      const i = line.indexOf("=");
      if (i > 0 && !line.startsWith("#")) out[line.slice(0, i)] = line.slice(i + 1);
    }
  } catch {
    /* no .env */
  }
  return { ...out, ...(process.env as Record<string, string>) };
}

export const env = loadEnv();
export const net = deployments.testnet;
export const chain = defineChain({
  id: net.chainId,
  name: net.name,
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [...net.rpcUrls] } },
});
export const pub = createPublicClient({ chain, transport: http(net.rpcUrls[0]) });
export const vault = net.vault as Hex;
export const usdc = net.usdc as Hex;

export function wallet(envName: string) {
  const key = env[envName] as Hex | undefined;
  if (!key) throw new Error(`${envName} missing from .env`);
  const account = privateKeyToAccount(key);
  return { account, client: createWalletClient({ account, chain, transport: http(net.rpcUrls[0]) }) };
}

export async function send(label: string, fn: () => Promise<Hex>) {
  const hash = await fn();
  const receipt = await pub.waitForTransactionReceipt({ hash });
  console.log(`${label}: ${receipt.status} block=${receipt.blockNumber} gasUsed=${receipt.gasUsed} tx=${hash}`);
  if (receipt.status !== "success") throw new Error(`${label} reverted`);
  return receipt;
}

export const bal = (a: Hex) => pub.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [a] });
export const acct = async (providerId: bigint, customer: Hex) => {
  const [available, reserved, totalDeposited, totalSettled, totalRefunded] = await pub.readContract({
    address: vault,
    abi: unspentVaultAbi,
    functionName: "getAccount",
    args: [providerId, customer],
  });
  return { available, reserved, totalDeposited, totalSettled, totalRefunded };
};
