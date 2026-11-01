# Verification record

All results below were produced in the Arc Studio sandbox on 1 Nov 2026. Re-run commands are in the README.

## Contract (Foundry)

`forge test` (Foundry 1.8.7, clean clone of `main` at `2376af9`, 2026-11-01): 193 passed, 0 failed, 12 suites. Forge counts the invariant campaign as one test; it checks 8 invariant properties (256 runs, depth 150, 38,400 calls, 0 reverts), so the earlier "200" is 192 tests plus 8 invariants. Includes fuzz (512 runs).
Covered: atomic deposit and failed transfers; fee-on-transfer rejection; signature, domain, chain, contract, provider, payout-version, nonce and replay failures; deadline boundaries at deadline-1, deadline, deadline+1 (reserve), expiry-1, expiry, expiry+1 (settle and release); duplicate settle or release; provider and relayer cannot settle alone; partial settlement; bound payout after a payout update; refund of available only; refund and reservation races; token transfer failures leave state unchanged; reentrancy via token hooks and payout contracts; forced surplus creates no credit; per-account and global conservation under random sequences.
Static analysis (Slither): only intentional block.timestamp comparisons and one false positive on a handled recover result.
Review: one High finding (a provider payout set to the vault itself would burn credit without paying anyone). Fixed (payout may not be the vault or the token); covered by `UnspentVault.Payout.t.sol`. One Low finding (error context parameters) was not applied.
Not done: independent audit, formal verification, mutation testing.

## Arc Testnet (chain 5042002), real transactions

Protocol journey (`scripts/protocol-journey.ts`, log in `docs/testnet-protocol-journey.log`): approve creates no credits; deposit 1.00; relayer reserve 0.10; customer-signed settlement paid the bound payout wallet exactly 0.10; second reservation: early release reverted, settlement at expiry reverted, third-party release succeeded; refund of 0.90; vault ended at 0 held, 0 owed. The response hash in this run is a fixed test string, so it does NOT demonstrate the API.

Browser journey (`scripts/e2e-deposit-recover.ts`, Chromium with a test wallet that signs with a sandbox testnet key; the chain and app are real):
- Wallet chooser listed the injected wallet; connect worked.
- Approve (separate transaction) left credits unchanged; deposit created exactly 1.00 available.
- Overview showed 1.00 read from the contract.
- Simulated outage on: `GET /api/v1/providers` returned 503 `SIMULATED_OUTAGE`; the app showed the labelled banner and still showed 1.00.
- Independent recovery client (different origin and port) read 1.00 and refunded it; onchain `totalRefunded` rose by exactly 1.00. It made 0 requests to `/api/v1`.
- No page errors.

Use API (`scripts/e2e-use-api.ts`): quote verified against the contract, typed-data signature, relayer reservation confirmed (reservation #3, 0.10 moved Available to Reserved), then the model step failed honestly because no `LLM_API_KEY` is configured. The UI said the 0.10 stays reserved until expiry and showed a release path. Not yet completed: a real model response, acceptance and settlement through the UI.

## Frontend

- `bun run check`: 0 errors. Production builds of the app and the recovery client succeed.
- Responsive: 320, 375, 768, 1024, 1440 px on /, /proof, /docs, /recover, /app in dark and light: no horizontal overflow, no console errors (one overflow at 320 on /recover was found and fixed).
- Keyboard and a11y probe: hamburger is an icon button named "Open navigation" with no visible text; drawer closes on Escape and returns focus; FAQ toggles with Enter and Space; skip link is the first tab stop; with reduced motion the workflow animation does not auto-advance.
- Screenshots were inspected for landing (dark/light, 375 and 1440), the outage view of the app and the recovery confirm dialog.

## Real Gemini journey on Arc Testnet (final code)

`scripts/e2e-full-journey.ts` drives the app UI in Chromium with a test wallet backed by a sandbox testnet key; the chain, relayer, API and Gemini model are real. 25 of 25 checks passed: approval alone created no credits; deposit created exactly 1.00; the reservation moved 0.10 Available to Reserved without changing liability; the provider was not paid before acceptance; the response was three bullets from the model; the provider payout wallet received exactly 0.10 (checked in native 18-decimal and ERC-20 6-decimal views); `UsageReserved` and `UsageSettled` carried 100000 and the bound payout wallet; the settled response hash equals keccak256 of the response shown on screen; explorer links on screen pointed at the real hashes; the API and the contract both rejected a replayed acceptance and the replay moved no funds; the refund returned all available credits; customer, provider and vault deltas matched exactly (customer includes its own gas); the vault ended with 0 held and 0 owed. Transaction hashes are in `docs/real-journey.json` and on `/proof`. Two earlier runs of this script crashed on a selector bug after settling, so two extra 0.10 settlements exist in history.

Model: the configured Gemini model answered through `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` (the base URL is stored without that suffix; the code appends it once). It works with the configured free-tier key. I cannot see the Google account's billing status from here, so "free tier" rests on the key being the user's free key; the code contains no paid fallback and no canned responses.

## Abandoned reservation

Reservation #3 (0.10) was left open when the model was not yet configured. Its onchain expiry was 1793502454. It was released at block 70134429 (chain time 1793513358, 10,904 s after expiry) by the customer wallet through the independent recovery client, restoring 100000 micro-USDC to Available; the same client then refunded it. Details: `docs/release-reservation-3.json`. The first release attempt in the script was interrupted by an RPC 429 after the transaction had already confirmed; the state above was read back from the chain.

## Deployed bytecode

The deployed testnet runtime bytecode equals the freshly compiled artifact with the 15 immutable slots masked (identical keccak), and `registerProvider(vault)` and `registerProvider(USDC)` revert with `InvalidPayoutWallet` when simulated against the deployed address. The payout-wallet fix was applied before deployment; no redeploy was needed.

## Authentication and exposure

`scripts/test-auth.ts`: 13 of 13 passed. It also found a real exposure: the Vite dev server was serving `data/state.json` (which held plaintext bearer tokens) and server source. Fixed with `server.fs.deny`, hashed tokens at rest and a migration; see `docs/authentication.md`.

## Not verified

Real wallets (MetaMask, Rabby) on a physical browser; mobile devices; the real API journey; recovery with a wallet on the wrong network end to end; Firefox and Safari; mainnet anything.

## Sandbox note for screenshots

Chromium needs shared libraries and fonts that the sandbox lacks. They were unpacked from Debian trixie packages into `/tmp/debs` and used via `LD_LIBRARY_PATH` and `FONTCONFIG_FILE`. This affects only local screenshots.
