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

// Arc mainnet (chain 5042), 1 Nov 2026: one small real-funds demonstration, signed by the owner in their own MetaMask.
// The contract is unaudited. MetaMask flagged both UNSPENT domains at connection; the owner chose to proceed (review requested).
export const PROOF_MAINNET: ProofTx[] = [
  { label: "Deploy UnspentVault (constructor: Arc USDC)", hash: "0xdfb7ece69d947060224e8f085fe8c2fa3bd4d2fab8630e5b0085d79e2a659b30", kind: "setup" },
  { label: "Register provider TextLab (provider 1; owner and payout are the same wallet)", hash: "0xe9668ea23884169a7372e192471df592ac005f000ba2479985a2338bac999df5", kind: "setup" },
  { label: "Approve 0.20 USDC (credits unchanged)", hash: "0xacf2c7989ebf3ad029796a9dff5dd25e40b971616201623005bce2349d8f0b84", kind: "api" },
  { label: "Deposit 0.20 USDC (CreditsDeposited)", hash: "0x3cae816db4c81a692c7efa3ab8dcad7442fc2934c1371470be54b40ec9d49cbf", kind: "api" },
  { label: "Reserve 0.10 for a real Gemini request (UsageReserved #1, relayer-submitted, customer-signed)", hash: "0x95c1399e5ca61df72671c67f8462580501f8dd5e476ab9d7cea3a7ba6502a1b1", kind: "api" },
  { label: "Customer-accepted settlement of 0.10 to the payout wallet (UsageSettled, hash of the actual response)", hash: "0xf69425cd83bb79a8337913cc468925ff189d718b34022e6c39939b69162d601f", kind: "api" },
  { label: "Refund of the remaining 0.10 (CreditsRefunded)", hash: "0x0b8c3b32e777677f1ea41e449db4882f53f35c1bc1ee02f033132bad38bdd11b", kind: "api" },
];

export const PROOF_API: ProofTx[] = [
  {
    "label": "Approve 1.00 USDC (credits unchanged)",
    "hash": "0x906398565a0d2835399792a0b6a55b10869a3d0da87c024e91b2f7dfba37117c",
    "kind": "api"
  },
  {
    "label": "Deposit 1.00 USDC (CreditsDeposited)",
    "hash": "0xaf048e39e842740aabdb3923757ce5057480a2b8eb2a90bc8e3b5a13bbd56072",
    "kind": "api"
  },
  {
    "label": "Reserve 0.10 for a real Gemini request (UsageReserved)",
    "hash": "0xf1d925ba4beebab701a1f6f5a706a34f1395affc5a017025210526a98535509a",
    "kind": "api"
  },
  {
    "label": "Customer-accepted settlement of 0.10 (UsageSettled, hash of the actual response)",
    "hash": "0x0c4dfed7e22a4482f5bd7e9eac80f0a2f83dcf5246767458464c540042333f6c",
    "kind": "api"
  },
  {
    "label": "Refund of all remaining available credits (CreditsRefunded)",
    "hash": "0x35cd458451903a34b1757a7d271139f828bb9f7036f87464719336bf63dfebb9",
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
