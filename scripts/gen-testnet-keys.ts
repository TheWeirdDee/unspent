// Generates throwaway TESTNET-ONLY keys into server/.env (never printed). Existing keys are kept.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { existsSync, readFileSync, appendFileSync } from "node:fs";

const envPath = new URL("../server/.env", import.meta.url).pathname;
const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const names = ["TESTNET_CUSTOMER_KEY", "TESTNET_RELAYER_KEY", "TESTNET_PROVIDER_OWNER_KEY", "TESTNET_PAYOUT_KEY"] as const;
for (const name of names) {
  if (new RegExp(`^${name}=`, "m").test(current)) {
    console.log(`${name}: exists`);
    continue;
  }
  const key = generatePrivateKey();
  appendFileSync(envPath, `${name}=${key}\n`);
  console.log(`${name}: created -> ${privateKeyToAccount(key).address}`);
}
if (!current.includes("TESTNET_")) console.log("note: these keys are for Arc Testnet only");
