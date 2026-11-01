// Regenerates PROOF_API in src/lib/proof.ts from docs/real-journey.json and docs/release-reservation-3.json.
import { readFileSync, writeFileSync } from "node:fs";
const j = JSON.parse(readFileSync("docs/real-journey.json", "utf8"));
const rel = JSON.parse(readFileSync("docs/release-reservation-3.json", "utf8"));
const t = j.txs;
const api = [
  { label: "Approve 1.00 USDC (credits unchanged)", hash: t.approveTx, kind: "api" },
  { label: "Deposit 1.00 USDC (CreditsDeposited)", hash: t.depositTx, kind: "api" },
  { label: "Reserve 0.10 for a real Gemini request (UsageReserved)", hash: t.reserveTx, kind: "api" },
  { label: "Customer-accepted settlement of 0.10 (UsageSettled, hash of the actual response)", hash: t.settleTx, kind: "api" },
  { label: "Refund of all remaining available credits (CreditsRefunded)", hash: t.refundTx, kind: "api" },
  { label: "Abandoned reservation #3: reserved", hash: rel.reserveTx, kind: "api", note: "The model was not configured at the time, so the 0.10 stayed reserved." },
  { label: "Abandoned reservation #3: released after its real onchain expiry, via the recovery client", hash: rel.releaseTx, kind: "api" },
  { label: "Refund of the restored 0.10 via the recovery client", hash: rel.refundTx, kind: "api" },
];
let p = readFileSync("src/lib/proof.ts", "utf8");
p = p.replace(/export const PROOF_API: ProofTx\[\] = [\s\S]*?;\s*$/, "export const PROOF_API: ProofTx[] = " + JSON.stringify(api, null, 2) + ";\n");
writeFileSync("src/lib/proof.ts", p);
console.log("proof updated:", api.length, "entries");
