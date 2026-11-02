# Hosting (free services only)

Status (1 Nov 2026): the components below are deployed. The table underneath is the original plan, kept for the reasoning behind each choice.

| Component | Where it runs now |
|---|---|
| App | Vercel project `unspent`: https://unspent-xi.vercel.app. Built for Arc mainnet (`VITE_NETWORK=mainnet`); `vercel.json` also forwards `/rpc/mainnet` and `/rpc/testnet` to Arc's public RPC so reads are same-origin. |
| Mainnet API + relayer | Render free web service `unspent-api-mainnet` (https://unspent-api-mainnet.onrender.com), own Neon Postgres database. |
| Testnet API + relayer | Render free web service `unspent-api` (blueprint `render.yaml`). Suspend it when unused: the free tier shares 750 instance hours across services. |
| Independent recovery client | Cloudflare Pages project `unspent-recovery`: https://unspent-recovery.pages.dev (a different provider and domain from the app). Opens on mainnet; `?network=testnet` for testnet. `recovery/functions/rpc/[net].ts` is an optional read-only RPC pass-through (not the UNSPENT API) for browsers whose blockers cancel `*.arc.io`; without it the client uses the direct endpoints. Deploy from `recovery/` with `wrangler pages deploy dist` so the function is included. |

Each hosted component was set up with a free plan. Re-check provider limits before relying on them.

Limits to know about:
- **Single API instance only.** The one-model-call-per-reservation lock is process-local, so do not run two instances against one database. Metadata is no longer one snapshot blob: it is one row per request plus one counter row per `(day, scope)`, with counters incremented inside the database and usage written in a single statement, so a partial update cannot happen. Writes for irreversible steps are still awaited before the step (see `server/store.ts`, `scripts/store.test.ts`).
- **Output retention:** model output is kept in memory for 30 minutes (enforced on every read) and is cleared on restart; the contract, not this service, is the record of money.
- **The two RPC pass-throughs differ.** The Cloudflare relay for the recovery client allows only read-only JSON-RPC methods, at most 20 calls and 100 KB per request, fails over across Arc's public endpoints, and applies a per-client token bucket (30 burst, 2 reads/second) that lives in module scope — per Cloudflare isolate, not global, so it is an abuse brake rather than a quota. The Vercel `/rpc/<network>` rewrite for the app is a plain forward with no method list and no rate limit; add a host-level rule if abuse appears.
- **CI** (`.github/workflows/ci.yml`) runs the lint, typecheck, unit tests, builds and contract tests on every push.

| Component | Service (free tier) | Notes |
|---|---|---|
| Web app (Vite build) | Netlify, Vercel or Hugging Face static Space via Arc Studio's Integrations menu; or Render Static Sites | Set `VITE_NETWORK`, `VITE_API_BASE` (public API URL), `VITE_RECOVERY_URL`. Needs an SPA fallback (`/* /index.html 200`). |
| API + relayer | Render free web service from the repo `Dockerfile` / `render.yaml` | Secrets entered in the Render dashboard: `TESTNET_RELAYER_KEY`, `LLM_API_KEY`, `LLM_MODEL`, `DEMO_OPERATOR_TOKEN`, `DATABASE_URL`, `CORS_ORIGINS`. Render free services spin down after 15 minutes without traffic and take about a minute to wake; the filesystem is ephemeral; 750 free instance hours per month. During a cold start the app shows the "backend unreachable" state and keeps reading balances from the chain. |
| Durable metadata | Neon free Postgres (`DATABASE_URL`) | One row per request in `unspent_requests` plus `unspent_usage` counters, reloaded at boot. Verified locally against Postgres 18 (a request record and its bearer token survived an API restart: `scripts/test-persistence.ts`) and against a real Postgres engine in unit tests with injected write failures (`scripts/store.test.ts`). Neon free scales compute to zero after 5 minutes idle, does not pause projects, and has a 1 GB storage cap per project. Do NOT use Render's free Postgres for this: those databases expire 30 days after creation. |
| Independent recovery client | A static host that is NOT the app's host, e.g. Cloudflare Pages, GitHub Pages or a second Netlify site; optionally IPFS and a copy anyone can build from the repo | `bun run recovery:build`, publish `recovery/dist`. It needs no env vars and no API. Host it on a different provider and domain from the app so one outage cannot take out both. |
| Model | Google Gemini API, free tier, via `https://generativelanguage.googleapis.com/v1beta/openai` | Free-tier prompt-handling terms are Google's; documented in `/docs#privacy`. No paid fallback is configured; if the free quota is exhausted the API returns `MODEL_UNAVAILABLE` and the reservation is released after expiry. |
| RPC | Public Arc RPC | Observed: `eth_getLogs` over a ~27,500-block range was rejected ("requested range too large"), and one burst of reads returned HTTP 429. The app and recovery client chunk log scans and fall back across RPCs; the recovery client lets users add their own endpoint. Measure again before depending on throughput. |

## How metadata survives restarts

Local dev: `data/state.json` (git-ignored). Hosted: Postgres via `DATABASE_URL`. Metadata is non-authoritative: if it were lost, balances, reservations and refunds are unaffected (they live in the contract); only in-flight request records (up to about 20 minutes old) and the daily model counters would be lost, and an interrupted reservation would be released after its expiry.

## Manual steps (you)

1. Create a Neon project; copy its connection string into Render as `DATABASE_URL`.
2. Create a Render web service from this repo (Blueprint `render.yaml`); add the secrets above; set `CORS_ORIGINS` to the app's URL.
3. Deploy the web app (Integrations menu) with `VITE_API_BASE` set to the Render URL.
4. Build and publish `recovery/dist` to a second static host; set `VITE_RECOVERY_URL` on the app.
5. Add the public Studio share link as `VITE_STUDIO_SHARE_URL`.
6. For mainnet: deploy the contract from your own wallet first (docs/mainnet-plan.md), update `deployments.json`, run `bun run sync:deployments`, rebuild everything, set `NETWORK=mainnet` on the API with a separate low-balance `MAINNET_RELAYER_KEY`.
