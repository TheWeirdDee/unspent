# Arc mainnet demonstration (1 Nov 2026)

One small real-funds run of the hosted journey on **Arc mainnet (chain 5042)**: deposit, reservation, a real Gemini response, customer acceptance, provider settlement, refund. Every figure below was read back from the chain after each step, not taken from the UI.

**What this is not:** the contract is **unaudited**; this is **one run**, not a production claim; the app is **not** described as mainnet-ready. **MetaMask flagged both UNSPENT domains as malicious at wallet connection and the cause is unresolved** (review request: https://github.com/MetaMask/eth-phishing-detect/issues/308206). The owner reviewed each request and chose to proceed on their own funds. Nothing bypasses or hides the warning.

Separate from the testnet records (`docs/testing.md`, `docs/testnet-reconciliation.md`, `docs/fresh-wallet-recovery-test.md`).

## Setup

| | |
|---|---|
| Vault | `0xa73723023a25fB400A153AE82F7A87B93d305f49` (UnspentVault; solc 0.8.28, optimizer 200 runs, EVM cancun) |
| Token | Arc USDC `0x3600000000000000000000000000000000000000` (6-decimal ERC-20 view; native gas is the same asset at 18 decimals) |
| Customer (A) | `0xE306b8ae6e958F7C8e3401f1f12d550E5DAecab6` (the owner's MetaMask account) |
| Provider owner = payout (B) | `0x97f32Ba0b4DD5c274DFD9C2A7e6Aa403a9B7dE8d` (the owner's second MetaMask account; owner and payout are the same wallet) |
| Relayer | `0xd8B8D78526a72Bd26D8680A290B2dc61edCA05cA` (generated for this run; its key is only in the API host's environment) |
| App / API / recovery | https://unspent-xi.vercel.app / https://unspent-api-mainnet.onrender.com / https://unspent-recovery.pages.dev |
| Source commits | contract bytes verified against `2376af9`; app and API at `e3b22b3` or later (this page's commit is recorded in git) |

Deployed bytecode: the creation input is the creation code of the reviewed build (not an audit) (keccak `0x36f55f1fa3490ad50d6badc48dcef9e0daf1f5de7e658897c0b98b226ba3536b`) plus the USDC constructor argument; the runtime code equals a fresh build from a clean clone of `main` (immutable slots masked). `forge test` on that clone: 193 passed, 0 failed (192 tests plus 8 invariant properties).

## Transactions (all verified from receipts and decoded events)

| # | Action | Signer | Tx | Block | UTC | Result |
|---|---|---|---|---|---|---|
| 1 | Fund B (0.075) | A | `0x96fad5c46c421a8074d46db8d178e2fb8e91566ccc4624dd82c35e7d75dee015` | 29008416 | 15:25:41 | success |
| 2 | Fund relayer (0.03) | A | `0xa850c7a8f152a3c8cb2f1b7f7727f7e18db466b79a19600c8e02fe56a5ace7e7` | 29008475 | 15:26:11 | success |
| 3 | Deploy vault | B | `0xdfb7ece69d947060224e8f085fe8c2fa3bd4d2fab8630e5b0085d79e2a659b30` | 29009468 | 15:34:35 | contract `0xa737…5f49`, 2,360,453 gas |
| 4 | `registerProvider(B, 0xd8b5…18af)` | B | `0xe9668ea23884169a7372e192471df592ac005f000ba2479985a2338bac999df5` | 29010417 | 15:42:36 | `ProviderRegistered(1, B, B)` |
| 5 | `approve(vault, 0.20)` | A | `0xacf2c7989ebf3ad029796a9dff5dd25e40b971616201623005bce2349d8f0b84` | 29015402 | 16:24:43 | `Approval(A, vault, 200000)` |
| 6 | `deposit(1, 0.20)` | A | `0x3cae816db4c81a692c7efa3ab8dcad7442fc2934c1371470be54b40ec9d49cbf` | 29016019 | 16:29:56 | USDC `Transfer(A to vault, 0.20)`; `CreditsDeposited(1, A, 200000)` |
| 7 | `reserveWithSignature` #1 | relayer (A signed EIP-712) | `0x95c1399e5ca61df72671c67f8462580501f8dd5e476ab9d7cea3a7ba6502a1b1` | 29032349 | 18:47:54 | `UsageReserved(1, 1, A, 100000, expiry 19:07:44Z)` |
| 8 | `acceptAndSettle` | relayer (A signed EIP-712) | `0xf69425cd83bb79a8337913cc468925ff189d718b34022e6c39939b69162d601f` | 29033280 | 18:55:46 | USDC `Transfer(vault to B, 0.10)`; `UsageSettled(1, 1, A, 100000, 0x5b47fb6c…e3b6d2e, B)` |
| 9 | `refund(1, 0.10)` | A | `0x0b8c3b32e777677f1ea41e449db4882f53f35c1bc1ee02f033132bad38bdd11b` | 29033650 | 18:58:54 | USDC `Transfer(vault to A, 0.10)`; `CreditsRefunded(1, A, 100000)` |

Explorer: `https://explorer.arc.io/tx/<hash>`. The reservation's fields on the chain: customer A, provider 1, payout B (version 1), maxAmount 100000, request hash `0x100db6d5…6a4408`; the vault checked A's signature against its own EIP-712 domain ("UnspentVault", version 1, chain 5042, verifying contract the vault). The accepted response hash `0x5b47fb6c…e3b6d2e` and amount 100000 match what the page displayed for the real Gemini response (`gemini-3.5-flash-lite`).

## Balances (read at the block shown; USDC)

| | Opening (blk 29013822) | Final (blk 29033729) | Change |
|---|---|---|---|
| A (customer) | 0.592249 | 0.486129 | -0.106120 (0.10 paid to B + gas for approve, deposit, refund) |
| B (payout) | 0.018696 | 0.118696 | **+0.100000** |
| Relayer | 0.03 | 0.020324 | -0.009676 (gas for reserve and settle) |
| Vault holds / owes | 0 / 0 | **0 / 0** | |
| A's vault account | all 0 | deposited 0.20, settled 0.10, refunded 0.10, available 0, reserved 0 | |

Gas paid (USDC, from receipts): deploy 0.054290, register 0.002221, approve 0.001192, deposit 0.003273, reserve 0.005810 (relayer), settle 0.003866 (relayer), refund 0.001659, the two funding transfers 0.000452 each. The three receipts' gas for A sums to 0.006124; A's observed decrease beyond the 0.10 is 0.006120. The 0.0000035 USDC gap is within the rounding of the receipts' effective gas price; it is noted rather than explained away.

A held 0.698 USDC just before the funding transfers (block 29008415), about 0.105 USDC more than its earlier 0.593, because funds arrived at A before the transfers; the opening row above is taken after that and after the transfers.

## Things that went wrong or were unexpected (kept on the record)

- **MetaMask classification (unresolved).** "Deceptive site ahead / Continue at your own risk" at connection on both domains. At the provider-registration step the MetaMask popup showed the method as "Mirror Buy" and "You receive +0.00002 USDC", which the chain contradicts: the transaction's calldata equals the expected `registerProvider` calldata byte for byte, it emitted one `ProviderRegistered` event, and a fork simulation beforehand showed the only balance change was the fee. The origin of the label and estimate is unknown.
- **Signatures were not compared against the popup at signing time.** The owner did not inspect the typed-data fields when signing the reservation. They were verified afterwards from the chain (above) and matched. The acceptance signature was likewise verified from the chain.
- **Privacy blockers broke the app's reads.** EasyPrivacy contains `||arc.io^$third-party`, so browser extensions using it cancelled every request to `*.arc.io` RPC hosts (`net::ERR_BLOCKED_BY_CLIENT`) and the page could not read balances. Fixed by reading through the app's own domain first (`/rpc/<network>` rewrite, commits `8cd110c` and the two before it) and adding three fallback endpoints. **The independent recovery client still reads the `*.arc.io` hosts directly and is therefore still affected for users with such extensions.** Not yet fixed.
- **A second reservation was created by mistake on testnet** earlier in the day (documented in `docs/fresh-wallet-recovery-test.md`); it did not recur on mainnet.
- **The host disk filled during the session**, which broke one build until scratch files were deleted; no deployed artifact was affected (the deployed bundles were re-checked).
- **A CSS defect:** the navigation hamburger shows on desktop widths because `.btn` is declared outside Tailwind's layers. Cosmetic; not yet fixed.

## Not done

- No real **outage** test on mainnet (API suspended, refund through the independent recovery client). The mainnet recovery client was only read-only checked. The testnet outage test is in `docs/fresh-wallet-recovery-test.md`.
- No independent audit. No provider other than the owner's own.
- The mainnet provider's owner and payout wallet are the same wallet; settlement moved real USDC from the vault to a wallet the owner controls.

## Submission video: shot list (the video itself must be recorded by the owner)

1. https://unspent-xi.vercel.app/proof: the mainnet section, seven green receipts, the disclosure paragraph and the MetaMask warning note.
2. The vault on the explorer: https://explorer.arc.io/address/0xa73723023a25fB400A153AE82F7A87B93d305f49
3. Deposit tx (#6) decoded events; then `/app/use`: the reservation (#7) and the Gemini bullets.
4. The acceptance signature popup, then settlement tx (#8) showing USDC moving from the vault to B.
5. The refund (#9) and the final vault balance of 0.
6. Close on the limitations: unaudited, one run, MetaMask classification unresolved.
