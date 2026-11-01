# Mainnet readiness (prepared 2026-11-01; NOTHING submitted)

Status: **not ready to deploy**. No mainnet transaction has been signed or sent. Every action below needs your explicit approval of the concrete transaction. Re-read gas and addresses immediately before signing.

## Blockers (must be resolved or consciously accepted first)

| # | Blocker | State |
|---|---|---|
| 1 | **MetaMask flags both UNSPENT domains as malicious at wallet connection** ("Continue at your own risk… signs of phishing or wallet-draining activity"; badge "Malicious — flagged as unsafe"). Seen on `unspent-xi.vercel.app` and on the static `unspent-recovery.pages.dev`. Cause unknown. | **Unresolved.** Review requested: https://github.com/MetaMask/eth-phishing-detect/issues/308206. Domains will not be changed to get around it. |
| 2 | `UnspentVault.sol` has no independent audit. | Open |
| 3 | Mainnet wallet addresses not chosen (see "Inputs needed"). | Open |
| 4 | Transitive npm advisories in the root `bun.lock` (OSV, 2026-11-01): `decode-uri-component@0.2.2` (via `query-string`), `uuid@8.3.2`/`9.0.1` (via `@metamask/sdk`/`@metamask/utils`), `zod@3.22.4`/`3.25.76` (via `abitype`, `@reown/appkit-wallet`, `@coinbase/cdp-sdk`), `ws@8.18.0` (via `viem`/`isows`, Node only). All are denial-of-service or memory issues in wallet-connector or Node code paths; none of their vulnerable code (decoder, `ZodError`, `WebSocketServer`) is in the served app bundle. Bump or override before mainnet. The recovery client's `package-lock.json` has 0 `npm audit` findings. | Open |

## Reviewed source

- Contract: `contracts/UnspentVault.sol`, unchanged since `2608e2a`; repo at `bc27004`. No owner, pause, upgrade, rescue or sweep. The constructor takes only the USDC address. `MAX_RESERVATION_DURATION = 1 days`.
- Compiler: solc `0.8.28+commit.7893614a`, optimizer on (200 runs), EVM `cancun`, `bytecode_hash = "none"` (`foundry.toml`).
- Artifact `contracts/out/UnspentVault.sol/UnspentVault.json` (build output, git-ignored; taken from the Arc Studio export): creation bytecode 11,415 bytes, keccak `0x36f55f1fa3490ad50d6badc48dcef9e0daf1f5de7e658897c0b98b226ba3536b`.
  - Checked against the live **testnet** deployment: tx `0x15adae9b…af5f` (an ERC-4337 `handleOps` through EntryPoint `0x5FF137D4…2789`) contains this creation code byte-for-byte at offset 780, followed by the constructor argument `0x3600…0000`. The vault's runtime code equals the artifact's runtime code (immutables masked).
  - The repo copy of the source differs from the export only in line endings (CRLF vs LF), which cannot affect bytecode with `bytecode_hash = "none"`.
- **Before mainnet:** rebuild with `forge build` at the approved commit and confirm the same keccak (Foundry is not installed on the preparing machine).

## Network facts (read live 2026-11-01 13:50 UTC)

| | Value |
|---|---|
| Chain ID | `5042` (block 28,997,205) |
| RPC / explorer | `https://rpc.mainnet.arc.io` / `https://explorer.arc.io` |
| USDC (constructor argument) | `0x3600000000000000000000000000000000000000`: code present (1,798 bytes), `decimals()` = 6, `symbol()` = USDC |
| Gas | base fee 20 gwei (floor), gas price 25 gwei. Fees are paid in native USDC (18 decimals); same asset as the 6-decimal ERC-20 view. |

## Inputs needed from you

| Role | Requirement | Address |
|---|---|---|
| Deployer | Your own wallet; needs ~0.12 USDC for gas headroom | _to supply_ |
| Provider owner | Calls `registerProvider`; controls payout updates | _to supply_ |
| Payout wallet | Receives settled payments; should differ from the owner | _to supply_ |
| Relayer (API) | Separate, low balance; pays reserve/settle gas; key goes only into Render as `MAINNET_RELAYER_KEY` | _to supply_ |
| Demo customer | Funded with ~1.05 USDC (1.00 demo + gas) | _to supply_ |

Provider metadata (same derivation as testnet, where the onchain hash equals `keccak256` of this exact string): `{"name":"TextLab API","service":"textlab.summarise.v1","priceMicroUsdc":"100000"}` → `metadataHash = 0xd8b503e7d7fd2e32e99b10acf19f81d75130a55e9806f9a33c9b2799dc3e18af`.

## Transactions for approval (estimates at 25 gwei; recheck with `bun scripts/mainnet-gas.ts`)

| # | Transaction | Signer | Moves | Gas | Fee (USDC) |
|---|---|---|---|---|---|
| 1 | Deploy `UnspentVault(0x3600000000000000000000000000000000000000)` | deployer | 0 | 2,380,354 (live `eth_estimateGas` on mainnet) | 0.0595 |
| 2 | `registerProvider(payoutWallet, 0xd8b5…18af)` | provider owner | 0 | 96,547 | 0.0024 |
| 3 | USDC `approve(vault, 1000000)` | demo customer | allowance 1.00 | 55,438 | 0.0014 |
| 4 | `deposit(providerId, 1000000)` | demo customer | 1.00 into vault | 152,237 | 0.0038 |
| 5 | `reserveWithSignature` (customer signs `ReserveAuthorisation`, maxAmount 100000) | relayer | 0 | 232,282 | 0.0058 |
| 6 | `acceptAndSettle` (customer signs `DeliveryAcceptance`, amount 100000) | relayer | 0.10 to payout wallet | 207,674 | 0.0052 |
| 7 | `refund(providerId, 900000)` | demo customer | 0.90 back to customer | 96,734 | 0.0024 |

Total ≈ 0.0805 USDC in fees at 25 gwei (≈ 0.161 at 2x). Gas units for 2–7 are from Arc Testnet receipts. At risk in the demo: 1.00 USDC, of which 0.10 goes to your own payout wallet. Suggested deployment command (keystore, never a raw key):
`forge create contracts/UnspentVault.sol:UnspentVault --constructor-args 0x3600000000000000000000000000000000000000 --rpc-url https://rpc.mainnet.arc.io --account <keystore-name> --broadcast`

## Hosting changes after deployment

1. `deployments.json` → `mainnet`: `vault`, `deploymentBlock`, `deploymentTx`, `providerId`, `providerOwner`, `providerPayout`, `providerMetadata`; then `bun run sync:deployments` (writes `src/contracts` and `recovery/src/contracts`).
2. API (Render): a **separate** mainnet service (recommended, so the testnet service keeps working) with `NETWORK=mainnet`, `MAINNET_RELAYER_KEY`, `LLM_*`, `DATABASE_URL` (separate database), `CORS_ORIGINS` = the mainnet app origin.
3. App (Vercel `unspent`): `VITE_NETWORK=mainnet`, `VITE_API_BASE` = the mainnet API URL, `VITE_RECOVERY_URL=https://unspent-recovery.pages.dev` (it currently points to `recovery-taupe.vercel.app`, the same host as the app).
4. Recovery (Cloudflare Pages `unspent-recovery`): rebuild with `npm ci && npm run build` in `recovery/`, setting the commit SHA for the build stamp, and upload; confirm the live stamp equals the approved commit.
5. After each transaction: verify the receipt, decode the events, and re-read balances from the chain; read `usdc()` on the new vault; compare its runtime code with the artifact.
