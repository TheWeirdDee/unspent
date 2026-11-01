# AGENTS.md (project memory)

- Network default: Arc Testnet (5042002). Mainnet (5042) is NOT deployed; never deploy without explicit user approval.
- Testnet vault: 0x080442a50d3bdf7d1aa5ed6d9383b39a8a413f85 (block 70107731). Provider 1 = TextLab. See deployments.json.
- Source of truth for addresses/ABI: deployments.json + contracts/out. Run `bun run sync:deployments` after changes (writes src/contracts and recovery/src/contracts).
- Keys live in .env only (TESTNET_*). Never print or commit them.
- Real model required: LLM_API_KEY. Never substitute canned API output.
- The recovery client in recovery/ must never import from src/ or call /api.
- Screenshot tooling in this sandbox needs Chromium shared libs under /tmp/debs (see docs/testing.md).
