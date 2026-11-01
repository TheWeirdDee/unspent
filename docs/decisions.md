# Decisions and deviations from the PRD

- Vite + React instead of Next.js: Arc Studio's runtime is Vite. API is a separate Bun service proxied through Vite in preview.
- PostgreSQL, SIWE sessions and a separate indexer were not built. Metadata is a small JSON file; request outputs are never persisted; private request data is gated by a per-request access token; activity and history are read directly from chain events (starting at the deployment block). Add Postgres + SIWE before multi-tenant use.
- `refundFor` omitted (PRD says avoid it if not needed). No early customer cancel: a reservation can be released only after expiry, per the clarified rule.
- Reservation lifetime is 20 minutes from quote; signed submission window 5 minutes. On-chain maximum lifetime is 1 day.
- Wallet UI is custom (EIP-6963 via wagmi) rather than ConnectKit, for design control. WalletConnect is not included (needs a project ID).
- Response hash only proves what the customer accepted, never service quality.
- Smart-contract wallets (ERC-1271) are unsupported.
