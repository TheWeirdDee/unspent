# What Arc Studio evidence exists, and what it does not prove

Studio is where the core build happened. This page lists the evidence for that claim and, just as importantly, what the evidence cannot establish. It exists because a passing Foundry suite says nothing about *where* the code was written, and an author string says little on its own.

## 1. The project

- **Project:** https://studio.arc.io/app/73cba122-05a1-4d3e-9f91-afb6132479b4
- **Owner-only.** Opening it without the owner's session lands on Studio's public homepage. Studio's Share menu offers hosting integrations (Netlify, Hugging Face, Vercel), not a public project-history link, so no share URL exists to publish. Reviewers cannot browse the build history themselves; the recordings below are how it is shown.
- **Environment variables provisioned by Studio** (`RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS`) are still read by the code as an optional RPC proxy, which is a small, checkable trace of the sandbox.

## 2. Recordings captured inside the authenticated project

These were captured by the owner while signed in, and are attached to the submission rather than committed (they are large binaries and live in the git-ignored `.demo-tools/`). Each row states what the capture is for; the file is the artefact to check.

| File | What it is meant to show |
|---|---|
| `studio-buildhistory.png`, `studio-history.png` | The project's build history list, as shown inside Studio |
| `studio-earlier.png` | An earlier point in that history |
| `studio-contract.png`, `studio-vault.png` | `UnspentVault.sol` open in the Studio editor |
| `studio-tests.png`, `studio-deadlines.png` | The contract tests and the deadline/expiry cases in Studio |
| `studio-preview.png` | The app running in Studio's preview |
| `studio-cut.mp4` | The edited Studio segment used in the submission video |
| `studio-record.log`, `studio-record.py`, `studio.ps1` | The capture script and its log, so the recording process is inspectable |

The recording plan in [docs/recording-script.md](recording-script.md) requires the authenticated project, not just the repository, and forbids presenting Git author names as the proof.

## 3. Repository evidence that anyone can check

- **Commit range:** 72 commits with the author field "Arc Studio", from `2608e2a` ("checkpoint 1: UnspentVault contract, 200 Foundry tests, project scaffold", 1 Nov 2026 02:22 UTC) to `491a509` (08:05 UTC) — roughly six hours of continuous work in one session.
- **Content of that range:** the contract and its Foundry suite, the Arc Testnet deployment and provider registration, the sample API and relayer, the Vite/React app, the recovery client, the deployment configuration, and the scripted journeys. `git log 2608e2a^..491a509 --stat` shows it without trusting any prose.
- **Deployment artefact:** the testnet vault `0x080442a50d3bdf7d1aa5ed6d9383b39a8a413f85` at block 70107731, with its deployment and provider-registration transactions in [deployments.json](../deployments.json), readable on the explorer.
- **Reproducible tests:** `forge test` on that range builds the same contract and runs the same suite, so the work described is not a claim about private files.

## 4. What the evidence does not prove

- **It does not prove authorship by a particular tool.** A Git author string can be set freely. The recordings and the reproducible artefacts are the stronger evidence; the commit count is consistent with them, not a substitute.
- **It does not prove the mainnet deployment came from Studio.** The mainnet vault was deployed later by the owner, signed in their own MetaMask; Studio did not sign or deploy it. [docs/mainnet-journey.md](mainnet-journey.md) records that run.
- **It does not prove hosting was configured from Studio's Integrations menu.** Whether Vercel, Render and Neon were connected through Studio or by hand cannot be determined from the repository, and is not claimed either way.
- **It does not prove the current contract source is deployed.** The source has moved ahead of both deployments (ERC-1271 and the consent-settlement window); see the README's verification section.
