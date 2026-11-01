// Evidence registry. Every entry is a real transaction; the Proof page re-reads each receipt from the chain at load time.
// kind "protocol" = contract accounting test with a FIXED TEST STRING as response hash (no API involved).
// kind "api" = a journey through the real sample API and a real model response.
import type { Hex } from "viem";

export interface ProofTx { label: string; hash: Hex; kind: "setup" | "protocol" | "api"; note?: string }

export const PROOF_TESTNET: ProofTx[] = [
  { label: "Deploy UnspentVault", hash: "0x15adae9b678352c3f097f23ae8287daa34edda5297051b84a9480777edc4af5f", kind: "setup" },
  { label: "Register provider TextLab (provider 1)", hash: "0x58c3da56d80f88ea862826c5d806787e048dbadee0d5824ca5572d545035eb47", kind: "setup" },
  { label: "Approve 1.00 USDC (no credits created)", hash: "0x9381d345918dd0e8f1843bbf742a88590f473b80b87bf5739537b7f096f41fc8", kind: "protocol" },
  { label: "Deposit 1.00 USDC (CreditsDeposited)", hash: "0x39be57a51781638deb1f25428fb54a7a0188b9f7c848c64a2679dd3d7471c816", kind: "protocol" },
  { label: "Reserve 0.10 via relayer (UsageReserved)", hash: "0x279e1e852a4ea4217289ecab7e381a787bb0106b77ad29af2bfd889a8a3d66f9", kind: "protocol" },
  { label: "Customer-signed settlement of 0.10 (UsageSettled)", hash: "0x53f4f06462fb87de5a6a3c8afdeddd3eb92f5a877fda8e427f7ec277b95fc7a0", kind: "protocol", note: "Response hash is a fixed test string, not a model output." },
  { label: "Reserve 0.10 with short expiry", hash: "0x163633a8ecb55533c28fd71f58afc78e32754ef8ffaf72e6733cede60c081209", kind: "protocol" },
  { label: "Release expired reservation (ReservationReleased)", hash: "0xdf32ac943809c95987421d0e2a97dfd77ce029dc118e6dacfcd1d89d49fbcadb", kind: "protocol" },
  { label: "Refund 0.90 USDC (CreditsRefunded)", hash: "0x497da0be6e73594f77cddca0c06c1d7975000232a082130f0f759339fd80fee3", kind: "protocol" },
];

export const PROOF_API: ProofTx[] = [
  {
    "label": "Approve 1.00 USDC (credits unchanged)",
    "hash": "0xca20fb80758175353850bb4ee177b63d761d9dd21d311f76e596e8ae4e6857e9",
    "kind": "api"
  },
  {
    "label": "Deposit 1.00 USDC (CreditsDeposited)",
    "hash": "0x6841557340b3930d3c062ee7ba284237b66ced3682db7975d2ec02e473d1d840",
    "kind": "api"
  },
  {
    "label": "Reserve 0.10 for a real Gemini request (UsageReserved)",
    "hash": "0x6e9db47d056b6ce4703175007e3e91afcfa6be4e19597260b58bcd2fd4aa122f",
    "kind": "api"
  },
  {
    "label": "Customer-accepted settlement of 0.10 (UsageSettled, hash of the actual response)",
    "hash": "0x8f771e46fee9d1f22b359c6d4f315eab2b2c0d0c6644503994bdef08d5bb0a3a",
    "kind": "api"
  },
  {
    "label": "Refund of all remaining available credits (CreditsRefunded)",
    "hash": "0x2857ace090e22f44241e8471c65a700c0bac0013718695df1712eab88845746c",
    "kind": "api"
  },
  {
    "label": "Abandoned reservation #3: reserved",
    "hash": "0xce7a7c52756daba76df73c7ab558e037f2bf6c0fe57fd95a1a77a8d58be52772",
    "kind": "api",
    "note": "The model was not configured at the time, so the 0.10 stayed reserved."
  },
  {
    "label": "Abandoned reservation #3: released after its real onchain expiry, via the recovery client",
    "hash": "0xff08c95c6d126b653ba3da2d0b0580c531f4de9ce1e5c04964145ffc5cbde5e4",
    "kind": "api"
  },
  {
    "label": "Refund of the restored 0.10 via the recovery client",
    "hash": "0xb00d0e64fbe3c3c2b39308848dfd243fa2b791558b992afff9e1c6f1486f0e6b",
    "kind": "api"
  }
];
