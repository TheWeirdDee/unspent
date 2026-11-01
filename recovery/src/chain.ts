import { createPublicClient, defineChain, fallback, http, type Address, type Hex } from "viem";
import { deployments, type NetworkKey } from "./contracts/deployments";

export function pickNetwork(): NetworkKey {
  const q = new URLSearchParams(location.search).get("network");
  if (q === "mainnet" || q === "testnet") return q;
  const saved = localStorage.getItem("unspent-recovery-network");
  return saved === "mainnet" || saved === "testnet" ? saved : "testnet";
}

export function customRpc(net: NetworkKey): string[] {
  try { return JSON.parse(localStorage.getItem(`unspent-rpc-${net}`) ?? "[]"); } catch { return []; }
}

export function buildClients(net: NetworkKey) {
  const dep = deployments[net];
  const urls = [...customRpc(net), ...dep.rpcUrls];
  const chain = defineChain({
    id: dep.chainId as number,
    name: dep.name,
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, // native gas view; all balances here use the 6-decimal ERC-20 view
    rpcUrls: { default: { http: urls } },
    blockExplorers: { default: { name: "Arc Explorer", url: dep.explorer } },
  });
  const publicClient = createPublicClient({ chain, transport: fallback(urls.map((u) => http(u, { timeout: 10_000 })), { rank: false }) });
  return { dep, chain, publicClient, urls, vault: (dep.vault ?? undefined) as Address | undefined };
}

export type Clients = ReturnType<typeof buildClients>;

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const USDC_SCALE = 1_000_000n;
export function fmt(v: bigint, min = 2): string {
  const whole = v / USDC_SCALE;
  let frac = (v % USDC_SCALE).toString().padStart(6, "0");
  while (frac.length > min && frac.endsWith("0")) frac = frac.slice(0, -1);
  return `${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${frac ? "." + frac : ""}`;
}
export function parse(input: string): bigint | null {
  const s = input.trim();
  if (!/^\d+(\.\d{0,6})?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  return BigInt(w) * USDC_SCALE + BigInt(f.padEnd(6, "0") || "0");
}
export type TxHash = Hex;
