// One-time Arc Testnet setup: fund the provider owner with gas, register the TextLab provider.
import { erc20Abi, keccak256, stringToHex, parseEventLogs } from "viem";
import { readFileSync, writeFileSync } from "node:fs";
import { pub, wallet, send, vault, usdc } from "./lib";
import { unspentVaultAbi } from "../src/contracts/abi";

const relayer = wallet("TESTNET_RELAYER_KEY");
const owner = wallet("TESTNET_PROVIDER_OWNER_KEY");
const payout = wallet("TESTNET_PAYOUT_KEY");

const depPath = new URL("../deployments.json", import.meta.url).pathname;
const deps = JSON.parse(readFileSync(depPath, "utf8"));
if (deps.testnet.providerId) {
  console.log("provider already registered:", deps.testnet.providerId);
  process.exit(0);
}
await send("fund provider owner gas (1 USDC)", () =>
  relayer.client.writeContract({ address: usdc, abi: erc20Abi, functionName: "transfer", args: [owner.account.address, 1_000_000n] }),
);
const metadata = JSON.stringify({ name: "TextLab API", service: "textlab.summarise.v1", priceMicroUsdc: "100000" });
const receipt = await send("registerProvider(TextLab)", () =>
  owner.client.writeContract({
    address: vault,
    abi: unspentVaultAbi,
    functionName: "registerProvider",
    args: [payout.account.address, keccak256(stringToHex(metadata))],
  }),
);
const [ev] = parseEventLogs({ abi: unspentVaultAbi, eventName: "ProviderRegistered", logs: receipt.logs });
deps.testnet.providerId = Number(ev.args.providerId);
deps.testnet.providerRegistrationTx = receipt.transactionHash;
deps.testnet.providerOwner = owner.account.address;
deps.testnet.providerPayout = payout.account.address;
deps.testnet.providerMetadata = metadata;
writeFileSync(depPath, JSON.stringify(deps, null, 2) + "\n");
console.log("providerId", deps.testnet.providerId, "owner", owner.account.address, "payout", payout.account.address);
await pub.getBlockNumber();
