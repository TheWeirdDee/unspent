import { defineChain, createPublicClient, http, fallback, type Address } from "viem";
import { deployments, type NetworkKey } from "@/contracts/deployments";

export const NETWORK: NetworkKey = (import.meta.env.VITE_NETWORK as NetworkKey | undefined) === "mainnet" ? "mainnet" : "testnet";
export const dep = deployments[NETWORK];

export const arcChain = defineChain({
  id: dep.chainId,
  name: dep.name,
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, // native gas view; ledger uses the 6-decimal ERC-20 view
  rpcUrls: { default: { http: [...dep.rpcUrls] } },
  blockExplorers: { default: { name: "Arc Explorer", url: dep.explorer } },
  testnet: NETWORK === "testnet",
});

export const VAULT = (dep.vault ?? undefined) as Address | undefined;
export const USDC = dep.usdc as Address;
export const publicClient = createPublicClient({ chain: arcChain, transport: fallback(dep.rpcUrls.map((u) => http(u))) });

export const txUrl = (hash: string) => `${dep.explorer}/tx/${hash}`;
export const addressUrl = (addr: string) => `${dep.explorer}/address/${addr}`;
export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;
