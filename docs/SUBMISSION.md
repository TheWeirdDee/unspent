# UNSPENT: submission

Refundable, USDC-backed prepaid API credits on Arc. A deposit and its credits are one atomic transaction, payment to the provider happens only after the customer signs acceptance of a specific response, and unspent credits can be refunded at any time, including through an independent recovery client when the app is down.

## Read this first (disclosures)

- **The contract is not independently audited.** It has 193 passing Foundry tests (192 tests plus 8 invariant properties, with fuzzing) and an internal review. Nothing here claims otherwise.
- **MetaMask flags both UNSPENT domains with a "deceptive site / signs of phishing or wallet-draining activity" warning at wallet connection.** The cause is unknown and **unresolved**. A review request is open: https://github.com/MetaMask/eth-phishing-detect/issues/308206. The owner reviewed each request and chose to proceed on their own funds. Nothing in the app hides or bypasses the warning.
- **The mainnet evidence is one small run** (0.20 USDC deposited, 0.10 USDC settled to the provider payout wallet, 0.10 USDC refunded), not a production claim. The provider's owner and payout wallet are the same wallet. The app is **not** described as mainnet-ready.
- **No outage test has been run on mainnet.** The mainnet payment journey ran with the API online. The outage test below is a testnet test.

## Links

| What | Link |
|---|---|
| Public app (Arc mainnet build) | https://unspent-xi.vercel.app |
| Live proof page (re-reads every receipt from the chain) | https://unspent-xi.vercel.app/proof |
| Mainnet API health | https://unspent-api-mainnet.onrender.com/api/v1/health |
| Independent recovery client (opens on mainnet; `?network=testnet` for testnet) | https://unspent-recovery.pages.dev |
| GitHub repository | https://github.com/TheWeirdDee/unspent |
| Arc Studio project | https://studio.arc.io/app/73cba122-05a1-4d3e-9f91-afb6132479b4 |
| Mainnet contract (Arc, chain 5042) | [`0xa73723023a25fB400A153AE82F7A87B93d305f49`](https://explorer.arc.io/address/0xa73723023a25fB400A153AE82F7A87B93d305f49) |
| Testnet contract (Arc Testnet, chain 5042002) | [`0x080442a50d3bdf7d1aa5ed6d9383b39a8a413f85`](https://explorer.testnet.arc.io/address/0x080442a50d3bdf7d1aa5ed6d9383b39a8a413f85) |

**Arc Studio project access is unverified.** It is an owner-only link: a reviewer who opens it is redirected to Studio's public homepage. No public share link has been generated or recorded. To give reviewers access, the owner has to create one from Studio's share menu and add it here (the app's proof page shows it when `VITE_STUDIO_SHARE_URL` is set). Until then the GitHub history below is the verifiable record of the Studio work.

## Mainnet transaction links (1 Nov 2026, Arc chain 5042)

Full detail, decoded events and balances: [docs/mainnet-journey.md](mainnet-journey.md).

| Step | Transaction |
|---|---|
| Deploy vault | [`0xdfb7ece6…659b30`](https://explorer.arc.io/tx/0xdfb7ece69d947060224e8f085fe8c2fa3bd4d2fab8630e5b0085d79e2a659b30) |
| Register provider | [`0xe9668ea2…999df5`](https://explorer.arc.io/tx/0xe9668ea23884169a7372e192471df592ac005f000ba2479985a2338bac999df5) |
| Approve 0.20 USDC | [`0xacf2c798…8f0b84`](https://explorer.arc.io/tx/0xacf2c7989ebf3ad029796a9dff5dd25e40b971616201623005bce2349d8f0b84) |
| **Deposit 0.20 USDC** | [`0x3cae816d…d49cbf`](https://explorer.arc.io/tx/0x3cae816db4c81a692c7efa3ab8dcad7442fc2934c1371470be54b40ec9d49cbf) |
| Reserve 0.10 (customer-signed, relayer-submitted) | [`0x95c1399e…02a1b1`](https://explorer.arc.io/tx/0x95c1399e5ca61df72671c67f8462580501f8dd5e476ab9d7cea3a7ba6502a1b1) |
| **Settlement: 0.10 USDC to the payout wallet** | [`0xf69425cd…2d601f`](https://explorer.arc.io/tx/0xf69425cd83bb79a8337913cc468925ff189d718b34022e6c39939b69162d601f) |
| **Refund: 0.10 USDC back to the customer** | [`0x0b8c3b32…bdd11b`](https://explorer.arc.io/tx/0x0b8c3b32e777677f1ea41e449db4882f53f35c1bc1ee02f033132bad38bdd11b) |

Result: the vault ends holding and owing 0; the payout wallet received exactly 0.10 USDC; the customer's account reads deposited 0.20, settled 0.10, refunded 0.10.

The Gemini output that was paid for is these three lines (`gemini-3.5-flash-lite`):

```
- Conducted mainnet test of prepaid refundable USDC credits
- Utilized the Arc platform for the testing phase
- Scheduled and executed on November 1, 2026
```

Its keccak256 (the three lines joined with `\n`, no trailing newline) is `0x5b47fb6c9eb151729a5cdaf91ac1c832c8f729dfa57bfcbbad0792ef9e3b6d2e`, which is the response hash the customer signed and the vault recorded in the `UsageSettled` event of the settlement transaction.

## Two different evidence tracks (kept separate)

| Track | Network | What it proves | What it does not |
|---|---|---|---|
| Mainnet payment journey | Arc mainnet | Real USDC: deposit, customer-signed reservation, real Gemini response, customer-signed acceptance, provider settlement, refund. API online throughout. | An outage. An audit. Anything beyond one small run. |
| Testnet outage test | Arc Testnet | The hosted API was **actually suspended at its host**; the independent recovery client released two expired reservations and refunded 1.00 USDC from the owner's own MetaMask wallet; no request went to the primary API. [docs/fresh-wallet-recovery-test.md](fresh-wallet-recovery-test.md) | Mainnet behaviour. |
| Testnet sandbox journeys | Arc Testnet | Contract accounting and the API journey, driven by scripted sandbox wallets (not a physical wallet), disclosed as such. [docs/testing.md](testing.md) | A real wallet. |

## What was built in Arc Studio, and what was done afterwards

The split below is taken from the git history (author of each commit), not from memory. Studio's own build history is visible only inside the Studio project (owner-only link above); this table is the public record.

**In Arc Studio** (72 commits authored "Arc Studio", from `2608e2a` "checkpoint 1" on 1 Nov 2026 02:22 UTC to `491a509` at 08:05 UTC; the repository's first commits are the owner's own: "Initial commit" with a README, and the product requirements document):
- The `UnspentVault` contract and its Foundry test suite; the Arc Testnet deployment and provider registration.
- The sample API and relayer, the Vite/React app (landing, app, docs, proof, provider portal), and the independent recovery client.
- The deployment configuration files (`Dockerfile`, `render.yaml`, `vercel.json`) and the browser and protocol test scripts, including the scripts for the hosted journey and the hosted outage test.
- The testnet journeys and reconciliation documents (sandbox wallets).
- Whether the hosting accounts (Vercel, Render, Neon) were connected through Studio's Integrations menu or set up by hand cannot be determined from the repository.

**After Studio** (over 40 commits authored by the owner's git account through Claude Code in VS Code, starting at `b1fa8e4`, after the last Studio commit `491a509`; plus actions outside git):
- Recovery client build fix (the Vite config had no Node types) and a recovery lockfile.
- Dependency advisories reduced from 6 to 2 (patched overrides for `ws`, `uuid`, `decode-uri-component`; the remaining two are `zod@3`, not in the served bundle).
- Contract rebuilt from a clean clone and checked byte for byte against the testnet deployment; tests re-run (193 pass).
- Mainnet deployment tooling (a local page where the owner's own wallet signs), recording of the mainnet deployment, the proof page's mainnet section, and mainnet documentation.
- A fix for ad and privacy blockers cancelling every `*.arc.io` RPC request (same-origin RPC path in the app; a read-only same-origin pass-through function and a mainnet default in the recovery client; fallback RPC endpoints).
- A CSS layering fix (desktop navigation) and accuracy fixes to the README, landing text and project notes.
- Outside git: the Cloudflare Pages project and deployments, Vercel environment changes, the Render mainnet service and Neon database (created by the owner), and every mainnet transaction (signed by the owner in their own MetaMask).

## How to verify

- `https://unspent-xi.vercel.app/proof` re-reads all seven mainnet receipts and the testnet ones from their own chains when it loads.
- Each transaction above on https://explorer.arc.io shows the decoded events.
- Response hash: `cast keccak $'- Conducted mainnet test of prepaid refundable USDC credits\n- Utilized the Arc platform for the testing phase\n- Scheduled and executed on November 1, 2026'` prints the hash above.
- Build stamps: each site carries `<meta name="unspent-build">` with the commit it was built from; the API's `/api/v1/health` reports its commit as `version`.
- Contract bytes: a fresh `forge build` of `contracts/UnspentVault.sol` at this repository's pinned compiler settings reproduces creation-code keccak `0x36f55f1fa3490ad50d6badc48dcef9e0daf1f5de7e658897c0b98b226ba3536b`; details in [docs/mainnet-readiness.md](mainnet-readiness.md).

## Known open items

MetaMask classification (above); no audit; no mainnet outage test; Studio project access for reviewers; the testnet API service on Render should be suspended when unused to stay within free-plan hours.
