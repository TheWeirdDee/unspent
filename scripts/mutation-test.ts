// Contract mutation testing: each mutant is a deliberate defect injected into UnspentVault.sol. A mutant is "killed" when
// the relevant Foundry suite fails, which is the only evidence that a test actually guards that behaviour. A surviving
// mutant means the suite would not notice the defect.
//
// Usage: bun run test:mutation            (all mutants)
//        bun run test:mutation -- --list  (names only)
//
// The contract file is restored in a finally block; a crash cannot leave a mutated tree behind.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const CONTRACT = join(ROOT, "contracts", "UnspentVault.sol");
const FORGE = process.env.FORGE_BIN ?? (process.platform === "win32" ? join(process.env.USERPROFILE ?? "", ".foundry", "bin", "forge.exe") : "forge");

interface Mutant {
  name: string;
  /** Exact source text; must appear exactly once. */
  find: string;
  replace: string;
  suite: string;
  why: string;
}

const MUTANTS: Mutant[] = [
  {
    name: "deposit-accepts-short-transfer",
    find: "if (afterBalance < beforeBalance || afterBalance - beforeBalance != amount) revert TransferAmountMismatch();",
    replace: "if (afterBalance < beforeBalance) revert TransferAmountMismatch();",
    suite: "contracts/test/UnspentVault.Deposit.t.sol",
    why: "a fee-on-transfer token would mint credits it did not receive",
  },
  {
    name: "settle-credits-the-earned-back-to-available",
    find: "account.available += reservation.maxAmount - amount;",
    replace: "account.available += reservation.maxAmount;",
    suite: "contracts/test/UnspentVault.Settle.t.sol",
    why: "partial settlement would hand the customer the unsettled remainder twice",
  },
  {
    name: "release-allowed-one-second-early",
    find: "if (block.timestamp < reservation.expiry) revert ReservationNotExpired();",
    replace: "if (block.timestamp <= reservation.expiry) revert ReservationNotExpired();",
    suite: "contracts/test/UnspentVault.Deadlines.t.sol",
    why: "a reservation could be released while the provider could still settle it",
  },
  {
    name: "settle-allowed-at-expiry",
    find: "if (block.timestamp >= reservation.expiry) revert ReservationExpired();",
    replace: "if (block.timestamp > reservation.expiry) revert ReservationExpired();",
    suite: "contracts/test/UnspentVault.Deadlines.t.sol",
    why: "settlement and release would both be valid at the same block",
  },
  {
    name: "refund-rejects-the-full-balance",
    find: "if (amount > account.available) revert InsufficientAvailable();",
    replace: "if (amount >= account.available) revert InsufficientAvailable();",
    suite: "contracts/test/UnspentVault.Refund.t.sol",
    why: "a customer could never recover their last available credit",
  },
  {
    name: "reserve-nonce-replay-allowed",
    find: "if (usedReserveNonce[auth.customer][auth.nonce]) revert NonceUsed();",
    replace: "if (usedReserveNonce[auth.customer][auth.nonce] && false) revert NonceUsed();",
    suite: "contracts/test/UnspentVault.Reserve.t.sol",
    why: "the same signed authorisation could be submitted twice",
  },
  {
    name: "payout-may-be-the-vault",
    find: "if (wallet == address(this) || wallet == address(usdc)) revert InvalidPayoutWallet();",
    replace: "if (wallet == address(usdc)) revert InvalidPayoutWallet();",
    suite: "contracts/test/UnspentVault.Payout.t.sol",
    why: "registering the vault as its own payout burns the credit (the original High finding)",
  },
  {
    name: "erc1271-any-response-accepted",
    find: "if (!ok || result.length < 32 || bytes4(result) != IERC1271.isValidSignature.selector) {",
    replace: "if (!ok || result.length < 32) {",
    suite: "contracts/test/UnspentVault.Wallets.t.sol",
    why: "a contract wallet returning the wrong magic value would be treated as a valid signer",
  },
  {
    name: "consent-window-ignored",
    find: "if (block.timestamp < consentTime) revert ConsentWindowNotOpen();",
    replace: "if (block.timestamp < consentTime && false) revert ConsentWindowNotOpen();",
    suite: "contracts/test/UnspentVault.Wallets.t.sol",
    why: "the provider could settle before the moment the customer signed",
  },
];

const original = readFileSync(CONTRACT, "utf8");
const onlyList = process.argv.includes("--list");
if (onlyList) {
  for (const m of MUTANTS) console.log(`${m.name}  (${m.suite.replace("contracts/test/", "")})`);
  process.exit(0);
}

interface Result { mutant: Mutant; killed: boolean; detail: string }
const results: Result[] = [];

for (const [i, m] of MUTANTS.entries()) {
  const hits = original.split(m.find).length - 1;
  if (hits !== 1) {
    results.push({ mutant: m, killed: false, detail: `find text appears ${hits} times (must be exactly 1) — mutant is stale` });
    console.log(`[${i + 1}/${MUTANTS.length}] ${m.name}: SKIPPED (${hits} matches)`);
    continue;
  }
  process.stdout.write(`[${i + 1}/${MUTANTS.length}] ${m.name} ... `);
  writeFileSync(CONTRACT, original.replace(m.find, m.replace));
  try {
    const proc = Bun.spawnSync([FORGE, "test", "--match-path", m.suite], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    const output = `${proc.stdout.toString()}\n${proc.stderr.toString()}`;
    const compiled = !output.includes("Compiler run failed");
    const killed = proc.exitCode !== 0 && compiled;
    results.push({ mutant: m, killed, detail: killed ? "suite failed as expected" : compiled ? "suite still passed" : "did not compile" });
    console.log(killed ? "KILLED" : compiled ? "SURVIVED" : "BROKEN");
  } finally {
    writeFileSync(CONTRACT, original);
  }
}

// Leave the tree exactly as found, then report.
writeFileSync(CONTRACT, original);
const survived = results.filter((r) => !r.killed);
console.log("");
for (const r of results) console.log(`${r.killed ? "killed " : "SURVIVED"} ${r.mutant.name} — ${r.detail}`);
console.log(`\n${results.length - survived.length}/${results.length} mutants killed.`);
if (survived.length) {
  console.error("A surviving mutant means the suite does not test that behaviour. Fix the tests (or the mutant) before trusting the suite.");
  process.exit(1);
}
