import { defineChain, createPublicClient, http, fallback, type Address } from "viem";
import { deployments, type NetworkKey } from "@/contracts/deployments";

export const NETWORK: NetworkKey = (import.meta.env.VITE_NETWORK as NetworkKey | undefined) === "mainnet" ? "mainnet" : "testnet";
export const dep = deployments[NETWORK];

export const arcChain = defineChain({
  id: dep.chainId as number,
  name: dep.name,
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, // native gas view; ledger uses the 6-decimal ERC-20 view
  rpcUrls: { default: { http: [...dep.rpcUrls] } },
  blockExplorers: { default: { name: "Arc Explorer", url: dep.explorer } },
  testnet: NETWORK === "testnet",
});

export const VAULT = (dep.vault ?? undefined) as Address | undefined;
export const USDC = dep.usdc as Address;
/**
 * Reads go through this site's own /rpc/<network> rewrite first (vercel.json), then the public endpoints directly.
 * Privacy filter lists (EasyPrivacy has ||arc.io^$third-party) make browsers block every *.arc.io host for a page on
 * another domain; a same-origin path is not affected. Wallet transactions still use the wallet's own RPC.
 */
export const rpcTransport = () => fallback([http(`${typeof location === "undefined" ? "" : location.origin}/rpc/${NETWORK}`), ...dep.rpcUrls.map((u) => http(u))]);
export const publicClient = createPublicClient({ chain: arcChain, transport: rpcTransport() });

export const txUrl = (hash: string) => `${dep.explorer}/tx/${hash}`;
export const addressUrl = (addr: string) => `${dep.explorer}/address/${addr}`;
export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;
