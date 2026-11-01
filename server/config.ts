import { createPublicClient, createWalletClient, defineChain, http, fallback, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { deployments, type NetworkKey } from "../src/contracts/deployments";

export const NETWORK: NetworkKey = process.env.NETWORK === "mainnet" ? "mainnet" : "testnet";
export const dep = deployments[NETWORK];
const compassKey = NETWORK === "mainnet" ? "Arc" : "Arc_Testnet";

// RPC: the sandbox proxy when it covers this chain, otherwise the public endpoint from deployments.json.
const proxyChains = (process.env.RPC_PROXY_CHAINS || "").split(",");
const proxied =
  process.env.RPC_PROXY_BASE_URL && proxyChains.includes(compassKey)
    ? `${process.env.RPC_PROXY_BASE_URL}/api/rpc/${compassKey}?_rpc_token=${process.env.RPC_PROXY_TOKEN}`
    : undefined;
export const rpcSource = proxied ? "sandbox-proxy" : "public";
const urls = [...(proxied ? [proxied] : []), ...dep.rpcUrls];

export const chain = defineChain({
  id: dep.chainId,
  name: dep.name,
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: urls } },
});
export const publicClient = createPublicClient({ chain, transport: fallback(urls.map((u) => http(u))) });

const relayerKey = (NETWORK === "mainnet" ? process.env.MAINNET_RELAYER_KEY : process.env.TESTNET_RELAYER_KEY) as Hex | undefined;
export const relayerAccount = relayerKey ? privateKeyToAccount(relayerKey) : undefined;
export const relayerClient = relayerAccount ? createWalletClient({ account: relayerAccount, chain, transport: fallback(urls.map((u) => http(u))) }) : undefined;

export const VAULT = (dep.vault ?? undefined) as Address | undefined;
export const PROVIDER_ID = dep.providerId ? BigInt(dep.providerId) : undefined;

export const config = {
  port: Number(process.env.PORT || 3001),
  priceMicro: 100_000n,
  authWindowSec: 300, // latest time the signed reservation may be submitted
  reservationSec: 20 * 60, // reservation expiry measured from quote time (must exceed authDeadline)
  executeSafetyMarginSec: 60, // refuse to start the model call if less than this remains before expiry
  llm: {
    key: process.env.LLM_API_KEY,
    baseUrl: (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    model: process.env.LLM_MODEL || "gpt-4o-mini",
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS || 30_000),
    dailyGlobal: Number(process.env.LLM_DAILY_GLOBAL_LIMIT || 100),
    dailyPerCustomer: Number(process.env.LLM_DAILY_PER_CUSTOMER_LIMIT || 10),
  },
  operatorToken: process.env.DEMO_OPERATOR_TOKEN,
  outageMaxMs: 30 * 60_000,
};
