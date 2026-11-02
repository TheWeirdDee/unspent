# Response to the independent review of `e946c8b`

An independent review of the live deployment and repository at `e946c8b` (1 Nov 2026) confirmed the mainnet payment evidence and found eight application issues (F1 to F8) plus presentation items. It found no contract defect and no secret in history. The deployed contract was **not** changed. This document records what was done about each finding, how it was tested, and what is still limited. It is the project's own account, not a second audit.

Counting convention: the contract suite is 192 tests plus 8 invariant properties (200 checks). Foundry 1.8.7 prints 193 because it counts the invariant campaign as one test; the reviewer's Foundry 1.7.1 printed 200 because it listed the 8 properties separately.

## Findings

| # | Finding | Status | Fix (commits) | How it was checked |
|---|---|---|---|---|
| F1 | The browser trusted the API's response hash and amount when asking for the acceptance signature. | **Fixed** | `b527618` (guard), `7f5acce` (hook), `e058fce` (page) | `scripts/delivery.test.ts`: 31 tests, including text A with hash B, amounts above the quote or reservation, malformed amounts (`1e5`, `-1`, `0x10`, fractions, whitespace), wrong reservation owner, provider, request hash, payout and expiry. Every bad case asserts the wallet callback is never called (`19343a9`). Disabling the hash check makes the two hash tests fail. The page also re-hashes the text itself, shows the result, and disables Accept on a mismatch (browser-checked with a mocked API). After settlement the hook compares the contract's settled amount and response hash with what was signed (implemented, but not covered by a test). |
| F2 | Two concurrent execute calls could run the model twice for one reservation. | **Fixed** (single process) | `08b0c3a`, `1c8930c` | `scripts/lifecycle.test.ts` (`a56cfeb`): two and ten concurrent calls make exactly one model call; the others get `409 IN_PROGRESS`; a failed model call is not silently repeated. Removing the lock makes the race tests fail, which reproduces the reviewer's finding. The lock is process-local, which matches the single-instance deployment. |
| F3 | Refreshing or leaving the Use API page lost the pending request. | **Fixed** | `7f5acce`, `e058fce` | A minimal handle (the quote and its bearer token, never the prompt or the output) is kept in `sessionStorage`, scoped to network, vault and wallet, for at most an hour. On load the API and the contract are re-read and the view moves to the real step. Eight browser scenarios with a mocked API passed: after reserve, after delivery, a mismatched hash, output no longer retained, still confirming, settled, request unknown, quote only. Limits: tab-scoped; the text is not stored, so a confirmed-but-not-run request needs the same text pasted again. These browser scenarios were run by hand and are not in CI. |
| F4 | Restarts and uncertain relayer submissions were not reconciled. | **Fixed** | `c8d2e2a`, `08b0c3a`, `1c8930c` | The broadcast hash is persisted the moment a relayer transaction is sent; a confirmation timeout is reported as `TX_PENDING` (not failure) and the record stays `reserving` or `settling`; status reads and startup reconcile with receipts and contract events. Interrupted `executing` records become `service_failed` (`EXECUTION_INTERRUPTED`) and the paid call is never repeated. A delivered record whose output is gone returns `410 OUTPUT_UNAVAILABLE` instead of an empty success. Unit tests cover each branch; the real server was started with seeded interrupted records and reconciled them correctly against the live mainnet chain (read-only, no keys). |
| F5 | Database writes were fire-and-forget. | **Fixed, one limit remains** | `a7e64df`, `08b0c3a`, plus the 2 Nov 2026 storage rewrite | The intent to run the model and to broadcast is written and acknowledged first; if that write fails nothing is done and the caller gets `503 STORAGE_UNAVAILABLE`. Metadata is now one row per request with in-database counters, and fault injection runs against a real Postgres engine (PGlite): failed durable writes, interrupted counter updates, a failed write followed by a successful one, and reload after restart (`scripts/store.test.ts`). **Still limited:** the one-model-call lock is process-local, so one API instance remains the supported deployment (documented in `docs/hosting.md`). |
| F6 | Tablet widths (768 to 1023px) showed a menu button whose drawer was hidden. | **Fixed** | `04c152b` | Navigation is reachable at 375, 640, 767, 768, 820, 900, 1023, 1024 and 1280px on `/`, `/app` and `/proof` (clicked, drawer visible). The drawer also closes if the window grows past its breakpoint, so scrolling cannot stay locked. |
| F7 | The 30-minute output cache was only swept on later completions. | **Fixed** | `08b0c3a` | Expiry is enforced on every read (`OutputCache.get`); tested with a fake clock, including a replay after expiry. Responses remain in memory only and are cleared on restart. |
| F8 | The recovery client could show an earlier address's figures after switching. | **Fixed** | `c2a1fe4` | A slow-RPC browser test for address A while switching to B: the deployed client before the fix showed A's late figures for B; the fixed build, locally and live, never did. Results are scoped to a view key (network, vault, customer, provider) and stale loads are discarded. |

## Other items from the review

| Item | Status |
|---|---|
| Mainnet results buried on `/proof` | Done: mainnet section first with a one-line summary (`2ec180c`). |
| Duplicate `id="main"` | Done: the section anchor is `mainnet-evidence` (`2ec180c`). |
| "Withdraw at any time" / "can never strand" wording | Done: qualified in the landing page, workflow text, deposit page and README (`179b9c5`, `860fc36`, `75d3441`, `0943ae5`). Reserved credits return after expiry; withdrawals need the token and network to allow the transfer. |
| Landing integration snippet checked only reservation status | Expanded to check customer, provider, request, cap and time left and to run once; it still points to `server/lifecycle.ts` for the full version (`179b9c5`). |
| Cold-start message | Done: the status strip says the backend may be waking up and keeps the recovery link (`288d6f6`). |
| Recovery described as "no backend calls" | Done: it now says chain reads may use a read-only RPC relay on its own host, which is not the UNSPENT API (`a104324`, `625be39`, `179b9c5`). |
| README test comment | Done: no fixed count (`0943ae5`). |
| No CI | Added `.github/workflows/ci.yml` (`f28bbcf`): frozen installs, lint, typecheck, unit tests, both builds, `npm audit` for the recovery client, contract build and tests. Its first run passed all three jobs. |
| Relay reads the full body before checking its size | Fixed: the body is read with a cap and oversized requests are refused (`245bf55`). **Not done:** a per-client rate limit; that belongs at the host (Cloudflare rate-limiting rules). |
| Vercel `/rpc` rewrite is not the same allowlisted implementation | Acknowledged: it forwards whatever it is sent to Arc's public RPC. Only the Cloudflare relay enforces the read-only method list. |

## What this does not claim

- This is not an independent security audit of the contract or of the application, and the contract remains unaudited.
- The MetaMask classification is unresolved.
- The browser scenarios (resume, stale-result, navigation widths) were run by hand in a real browser against local builds and the live site; only the unit tests and build checks run in CI.
- No new funded transaction was made for any of this work.
