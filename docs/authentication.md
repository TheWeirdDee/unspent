# Authentication and data exposure

## What is public and what is private

| Data | Where | Visibility |
|---|---|---|
| Balances, reservations, settlements, refunds, addresses, request/response hashes | Contract + events | Public by nature of the chain |
| `deployments.json`, ABI, `src/lib/proof.ts`, provider display metadata | Git + static bundle | Public, intentionally |
| Request records (customer address, request/response hashes, state, tx hashes, model name, latency) | `data/state.json` locally, or one Postgres row (`DATABASE_URL`) in production | Private to the API. Never served by the dev server (`server.fs.deny`, tested) and not reachable through any unauthenticated route |
| Per-request bearer tokens | Returned once at quote time; only a SHA-256 hash is stored | Private. The stored hash cannot be replayed |
| Prompts and model responses | Never stored. The response is held in memory for 30 minutes so a reload can show it | Private to the bearer-token holder |
| Provider portal totals (`/api/v1/provider/overview`) | API | Public; derived from public events plus request IDs |
| Relayer key, model key, operator token, database URL | Backend environment only | Secret. Never in `VITE_*`, never committed |

## How sensitive operations are authorised

No operation trusts a client-supplied address.

- Moving money needs the customer's EIP-712 signature, checked twice: by the API (`recoverTypedDataAddress`) and again by the contract (ECDSA recovery against `customer`, bound to chain ID and vault address). A relayer cannot alter amounts, deadlines, payout wallet or request hash.
- Running the model needs (a) the per-request bearer token and (b) a contract read showing an open reservation whose customer, provider, amount and request hash match the quote. A quote requested for someone else's address is inert: it cannot be reserved without that person's signature.
- Accepting a response needs the customer's signature over the stored response hash and amount; a replayed acceptance is rejected by the API (409 `ALREADY_SETTLED`) and by the contract.
- Reading a request record needs the bearer token (sent in the `Authorization` header).
- Provider settings (`updateProviderPayout`, `setProviderActive`) are contract calls restricted to the provider owner wallet, with no off-chain authority at all.
- The outage toggle needs `DEMO_OPERATOR_TOKEN` (compared by hash). It cannot touch contract state.

`scripts/test-auth.ts` exercises the negative cases (forged signature, missing or wrong token, execute without reservation, forged acceptance, operator token, files not served) and passes.

## Remaining gaps (honest list)

- **No SIWE.** There are no wallet-authenticated sessions. Consequences: the API cannot list "my past requests" for a wallet; anyone who obtains a request ID and its bearer token can read that request's record and in-memory output; quotes can be requested for any address (they are rate limited per IP, pruned after an hour, and grant nothing). History is read from the chain instead, which is public.
- **Per-wallet rate limiting** is not proven by signature at quote time; limits are per IP and per verified-reservation customer.
- Bearer tokens travel in request bodies/headers over TLS; there is no rotation.
- A single API instance is assumed (in-memory output cache, serialised relayer nonce queue).
- Add SIWE (nonce, domain, chain ID, expiry, single-use) before adding any wallet-scoped private data such as saved prompts, invoices or per-user settings.
