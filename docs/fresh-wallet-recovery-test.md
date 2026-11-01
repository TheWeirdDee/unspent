# Fresh-wallet hosted recovery test (Arc Testnet, 2026-11-01)

Separate from the sandbox-wallet tests in `docs/testing.md`, `docs/testnet-reconciliation.md` and `docs/release-reservation-3.json`. This test used **the owner's own MetaMask wallet** (a real browser wallet, not a sandbox adapter), a wallet that had never touched the vault. No sandbox wallet balance was touched. Nothing here involves mainnet.

- Chain: Arc Testnet, chain ID `5042002`
- Vault: `0x080442a50d3bdf7d1aa5ed6d9383b39a8a413f85`; provider 1 (TextLab); token USDC `0x3600000000000000000000000000000000000000`
- Test wallet: `0xE306b8ae6e958F7C8e3401f1f12d550E5DAecab6`
- Main app: https://unspent-xi.vercel.app (served commit `bc27004` at the time of the deposit; docs-only commits since)
- API: https://unspent-api-fvx6.onrender.com (Render service `unspent-api`, `srv-dbje1mu7bikc73f68ck0`)
- Independent recovery client: https://unspent-recovery.pages.dev (Cloudflare Pages `unspent-recovery`, build stamp `e0462192210276f9ac9754ffcc2d319426046b01`)

## Result

The deposit and reservation were made through the hosted app while the API was up. Both reservations were then released and the full deposit refunded **through the independent recovery client while the API was actually suspended** at its host. Every transaction below was signed by the owner in MetaMask and verified afterwards from the chain (receipt, decoded events, balances), not from the UI.

**Pass**, with the caveats listed below.

## Transactions

| # | Action | Tx | Block | UTC | Signer | Amount | Gas (USDC) |
|---|---|---|---|---|---|---|---|
| 1 | USDC `approve(vault, 1.00)` | `0x65ea6e2e37a99ce34605b00ad7241b0e7fc91e686fff80a7fdd56c960d7078aa` | 70181765 | 12:50:39 | wallet | allowance 1.00 | 0.00138595 |
| 2 | `deposit(1, 1.00)` | `0x3e74a618e4ef53b1ba179bdd7d78a9831f1d8d7ded1595be0dbf48b1ad16aa5c` | 70182257 | 12:54:49 | wallet | 1.00 in | 0.002950925 |
| 3 | `reserveWithSignature` #15 (EIP-712, 0.10) | `0x4ae6e15b87f542b3d33ad1a545cbe1bb22369744b39ee22d17747f152e6eafcf` | 70182597 | 12:57:41 | relayer `0x2C1a…5d89` | 0.10 reserved | relayer-paid |
| 4 | `reserveWithSignature` #16 (EIP-712, 0.10) | `0x2e4d3a01a4098031b5872eb20415bca605e18f12ef58007dc2848ad0e33f35e8` | 70182887 | ~13:00 | relayer | 0.10 reserved | relayer-paid |
| 5 | `releaseExpired(15)` (recovery client, API down) | `0xf451e245e05639a825b636e256c7e96343d62c8770474e166a0b192a05b0c2fe` | 70190106 | 14:01:22 | wallet | 0.10 to Available | 0.001216625 |
| 6 | `releaseExpired(16)` (recovery client, API down) | `0x13c0caed5b16e4fdc261a48a5f97d2a7a4cb4c2a5070c2a3281de953e61fcf5b` | 70190674 | 14:06:11 | wallet | 0.10 to Available | 0.001096625 |
| 7 | `refund(1, 1.00)` (recovery client, API down) | `0xe3537dcbd92cb8cf0ab5203b136476b0a838a2f34fd31669c18ac06ead299a66` | 70190939 | 14:08:26 | wallet | 1.00 to wallet | 0.002168575 |

Explorer: `https://explorer.testnet.arc.io/tx/<hash>`. Decoded events: #1 `Approval(owner=wallet, spender=vault, value=1000000)`; #2 USDC `Transfer(wallet→vault, 1000000)` + `CreditsDeposited(1, wallet, 1000000)`; #3/#4 `UsageReserved` (ids 15/16, 100000 each, expiries 13:17:22 and 13:19:56 UTC); #5/#6 `ReservationReleased(15|16, 1, wallet, 100000)`; #7 USDC `Transfer(vault→wallet, 1000000)` + `CreditsRefunded(1, wallet, 1000000)`.

The two reservations were deliberately left unaccepted: no response was accepted and nothing was paid to the provider (settled = 0.00).

## Balances (read from the chain)

| Point | Block | Wallet USDC | Allowance | Available | Reserved | Deposited | Refunded |
|---|---|---|---|---|---|---|---|
| Opening (before faucet) | 70176998 | 0 | 0 | 0 | 0 | 0 | 0 |
| After faucet (20 USDC) | 70177321 | 20 | 0 | 0 | 0 | 0 | 0 |
| After approve | 70182038 | 19.998614 | 1.00 | 0 | 0 | 0 | 0 |
| After deposit | 70182344 | 18.995663 | 0 | 1.00 | 0 | 1.00 | 0 |
| After reservations | 70182960 | 18.995663 | 0 | 0.80 | 0.20 | 1.00 | 0 |
| After release #15 | 70190280 | 18.994447 | 0 | 0.90 | 0.10 | 1.00 | 0 |
| After release #16 | 70190760 | 18.993350 | 0 | 1.00 | 0 | 1.00 | 0 |
| **Final** | 70191092 | **19.991181** | 0 | **0** | **0** | 1.00 | **1.00** |

Conservation: final wallet 19.991181 = 20 faucet − 0.0088187 total gas paid by the wallet (0.00138595 + 0.002950925 + 0.001216625 + 0.001096625 + 0.002168575). Available + Reserved + Settled + Refunded = 0 + 0 + 0 + 1.00 = Deposited. The wallet's final nonce is 5, matching the five transactions it sent. The vault's overall `solvency()` after the test read token balance 1.3 = liability 1.3 (the remainder belongs to the earlier sandbox wallets, untouched).

## Evidence the API was unavailable

Render dashboard state before the test: service `unspent-api`, Docker, Free, Oregon, deployed commit `491a509`, **Suspended** ("Suspended by you"; Render shows no timestamp). The owner resumed it at ~12:02 UTC (health: HTTP 200, relayer and model configured, commit `491a509`), suspended it again before 13:30 UTC, and resumed it after the refund.

Probes (`/api/v1/health`, `/api/v1/providers`) returned **HTTP 503 "Service Suspended: This service has been suspended by its owner"**, Render's own page, not the app's simulated-outage JSON:

- 13:30:29 to 13:30:36Z: six probes, all 503.
- 13:52:54Z and 13:52:55Z: 503.
- 14:02:54Z: 503. 14:07:03Z: 503 (about 80 seconds before the refund).
- 14:10:47Z: first **HTTP 200**, after the owner resumed the service (body: version `491a509…`, relayer and model configured, outage not active).

Releases #5 and #6 and the refund were confirmed at 14:01:22Z, 14:06:11Z and 14:08:26Z, inside the window bracketed by those probes. No probe was taken between 14:07:03Z and the resume, so the outage after 14:07:03Z is inferred from the owner's report that the service stayed suspended until after the refund. Raw probe log: kept in the assistant's session scratch directory, not committed.

## Primary-API requests from the recovery client

The owner kept Chrome DevTools open on the recovery tab with **Preserve log** on and the filter `onrender`. The count of matching requests stayed at **0** across the session: 0/7 (page load), 0/48 (after release #15) and 0/101 (after the refund). The client's own source has no reference to the API, and a separate headless run showed only requests to `unspent-recovery.pages.dev` and `rpc.testnet.arc.io`. This count comes from one browser tab and does not cover other tabs or devices.

## Caveats and failures (not hidden)

- **MetaMask warned on both sites.** On connection, MetaMask showed "Continue at your own risk… signs of phishing or wallet-draining activity" and the badge "Malicious — flagged as unsafe", on `unspent-xi.vercel.app` and on `unspent-recovery.pages.dev`; the transaction request also showed "Request from" with an alert icon and a "Review alert" button. The owner chose to proceed on testnet funds after checking each request. **The classification is unresolved.** Review request: https://github.com/MetaMask/eth-phishing-detect/issues/308206. No domain was changed to avoid it.
- **Second reservation not explained.** Two reservations (#15 and #16) exist, but the owner intended one. The vault only creates a reservation from a signature the wallet produced, so a second signature was approved around 13:00 UTC (probably a repeated "Reserve and run"); this was not confirmed. It did not affect the result; both were released.
- **Browser extension blocked the RPC.** Before the deposit, the app's balance read stayed at "…" because a Chrome extension returned `net::ERR_BLOCKED_BY_CLIENT` for every request to `rpc.testnet.arc.io`. Disabling extensions fixed it; the extension was not identified. The app shows only "…", with no explanation.
- **Public RPC rate limiting.** The recovery page logged HTTP 429 from `rpc.testnet.arc.io` on some reads; balances still rendered correctly.
- **Faucet.** Circle's faucet sent 20 USDC (one request).
- **Release waits for chain time.** Release was possible only after each reservation's onchain expiry (~20 minutes after reservation); the owner waited until after 13:20 UTC.
- The main app served commit `bc27004` at deposit time and `94b0f1d` later; the commits in between add only files under `docs/`.
