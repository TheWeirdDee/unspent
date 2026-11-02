# Verification record

The first section records the 2 Nov 2026 runs made on a local Windows checkout; the older sections below were produced in the Arc Studio sandbox on 1 Nov 2026 and are kept as recorded. Re-run commands are in the README.

## 2 Nov 2026 — local verification of the hardening work

Everything here was run against this working tree, not quoted from an earlier session.

| Check | Command | Result |
|---|---|---|
| Contract suite | `forge test` (Foundry 1.8.7) | 218 passed, 0 failed, 14 suites. 217 test functions plus the invariant campaign, which Forge counts as one test. |
| Mutation testing | `bun run test:mutation` | 9/9 mutants killed. Each mutant is an injected defect; a killed mutant means the named suite fails, which is the evidence that the behaviour is actually tested. |
| Unit tests | `bun run test:unit` | 74 passed, 0 failed across 4 files: delivery guard (31), lifecycle (22), store (9), retry/limiter/relay bucket (12). |
| Lint and typecheck | `bun run check` | clean (oxlint + three `tsc --noEmit` projects). |
| Builds | `bun run build`, `bun run recovery:build` | both succeed. |
| Browser matrix | `bun run test:browsers` | 45/45 checks: Chromium, Firefox and WebKit at 375, 768 and 1440 px over `/`, `/docs`, `/proof`, `/recover`, `/app`. Asserts no horizontal overflow, a visible header, HTTP < 400 and no uncaught page error. |

### What the new contract tests cover

`contracts/test/UnspentVault.Wallets.t.sol` (25 tests):

- **ERC-1271:** a contract-wallet customer reserves and accepts through `isValidSignature`; a foreign key is rejected; a wallet that returns the wrong magic value, reverts, or returns short data is rejected and never reaches the settlement path; `settleDirect` and `refund` work when the wallet calls them itself; replay after settlement is refused; an EOA customer still rejects a non-ECDSA signature.
- **Consent settlement:** a default reservation cannot be claimed by the provider (`NoSettlementConsent`); a claim before the signed time is refused; at the signed time the provider owner claims and the remainder returns to available; only that provider's owner may claim; a customer acceptance before the window wins; expiry still wins; the amount cap, zero amount and zero response hash are enforced; a deactivated provider can still be claimed; replay is refused; a consent timestamp at or before the signed deadline, or at or after expiry, is refused at reserve time; changing the consent timestamp after signing invalidates the signature; a fuzz test over every claimable amount keeps the account identity and `solvency()` intact.

### What the store tests prove (and do not)

`scripts/store.test.ts` runs the real SQL against **PGlite**, Postgres compiled to WASM — the same engine and the same statements, not a hand-written fake. It covers one row per request, reload after restart, atomic counters under 25 concurrent increments, a failing durable write leaving no row behind, an interrupted counter update writing neither counter, a failed write not blocking the next, prune deleting stale rows in the database, and revocation reaching stored token hashes.

It does **not** prove behaviour against a hosted Neon instance under network partitions, and it does not make the API multi-instance safe: the one-model-call lock is still process-local.

### What the browser matrix proves (and does not)

It proves the pages render in three engines at three widths without layout overflow, a missing header or an uncaught exception. It found a real defect on the way: the app's first-choice transport `/rpc/<network>` exists only as a Vercel rewrite, so in local dev every read paid a 404 before falling back (and WebKit reported the resulting fallback as a CORS failure). `vite.config.ts` now proxies `/rpc/mainnet` and `/rpc/testnet`, matching the deployment.

It does **not** prove a wallet flow: no extension wallet is installed, and these are not `scripts/e2e-*.ts`.

## Contract (Foundry)

`forge test` (Foundry 1.8.7, clean clone of `main` at `2376af9`, 2026-11-01): 193 passed, 0 failed, 12 suites. Forge counts the invariant campaign as one test; it checks 8 invariant properties (256 runs, depth 150, 38,400 calls, 0 reverts), so the earlier "200" is 192 tests plus 8 invariants. Foundry 1.7.1 lists the 8 properties separately and prints 200. Includes fuzz (512 runs).

Application unit tests (`bun run test:unit`, run in CI): `scripts/delivery.test.ts` (the acceptance guard: a mismatched delivery never reaches the wallet) and `scripts/lifecycle.test.ts` (one model call per reservation, durable intent before irreversible steps, output retention, reconciliation of interrupted records), 53 tests with stand-ins for the chain, model and database. Browser checks for resuming a request, stale results in the recovery client and navigation at 375 to 1280px were run by hand and are not in CI.
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

Real wallets (MetaMask, Rabby) on a physical browser; mobile devices; the real API journey; recovery with a wallet on the wrong network end to end; mainnet anything. Firefox (Gecko) and WebKit are now covered by the automated browser matrix recorded in the 2 Nov 2026 section above, which is neither a real wallet nor iOS Safari itself.

## Sandbox note for screenshots

Chromium needs shared libraries and fonts that the sandbox lacks. They were unpacked from Debian trixie packages into `/tmp/debs` and used via `LD_LIBRARY_PATH` and `FONTCONFIG_FILE`. This affects only local screenshots.
