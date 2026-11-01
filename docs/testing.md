# Verification record

All results below were produced in the Arc Studio sandbox on 1 Nov 2026. Re-run commands are in the README.

## Contract (Foundry)

`forge test`: 200 passed, 0 failed (13 suites). Includes fuzz (512 runs) and invariant suites (256 runs, depth 150).
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

## Not verified

Real wallets (MetaMask, Rabby) on a physical browser; mobile devices; the real API journey; recovery with a wallet on the wrong network end to end; Firefox and Safari; mainnet anything.

## Sandbox note for screenshots

Chromium needs shared libraries and fonts that the sandbox lacks. They were unpacked from Debian trixie packages into `/tmp/debs` and used via `LD_LIBRARY_PATH` and `FONTCONFIG_FILE`. This affects only local screenshots.
