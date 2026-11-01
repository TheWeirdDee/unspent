# Mainnet approval sheet (generated 2026-11-01T06:30:28.064Z)

**Nothing in this sheet has been executed. No real-fund transaction is submitted without your explicit approval. Never share a seed phrase or private key.**
Regenerate immediately before approving: `bun scripts/mainnet-prepare.ts` (it reads live chain data and sends nothing).

> Addresses still needed from you (public addresses only): deployer, providerOwner, payout, customer, relayer

## Network and token (read live from https://rpc.mainnet.arc.io)
- Chain ID: 5042 (expected 5042) · latest block 28945076 · base fee 20 gwei · gas price 25 gwei
- USDC ERC-20 interface: `0x3600000000000000000000000000000000000000` · code present: yes · symbol USDC · decimals 6 (ERC-20 view). Native gas uses 18 decimals: same asset.
- Explorer: https://explorer.arc.io

## Contract
- Contract: `UnspentVault` · Solidity 0.8.28 · EVM cancun · OpenZeppelin 5.6.1 · no owner, no proxy.
- Constructor argument: `0x3600000000000000000000000000000000000000` (USDC). Encoded: `0x0000000000000000000000003600000000000000000000000000000000000000`
- Reviewed source: file `contracts/UnspentVault.sol` last changed in commit `2608e2ae8240195245949692cd026a84172942a8`; repo HEAD when generated `5013b7586806dc1a81fb1821978fbb2b3e76b7cd`; keccak256(source) `0x3613dd097c63c49971bf139d191da50c7cd0317d93d1ca5a949bdc0977941809`.
- Creation bytecode keccak256 (artifact + constructor args): `0xe72df5ab67ba73de769e9d1c794398b3847ce3b7357b24c71dbc97920d5c870e`
- Review status: 200 Foundry tests, Slither, internal review. **No independent audit.**
- Deployer next nonce: ? → predicted vault address: `(needs deployer address)`

## Wallets
| Role | Address | Funding needed (USDC, incl. 2x gas headroom) | Current balance (USDC) | Status |
|---|---|---|---|---|
| Deployer | **NEEDED** | 0.1251199 | ? | needs funding |
| Provider owner (registers, can change payout) | **NEEDED** | 0.00482735 | ? | needs funding |
| Provider payout (receives 0.10) | **NEEDED** | 0 | n/a | receive-only |
| Demo customer (signs, deposits 1.00) | **NEEDED** | 1.0142409 | ? | needs funding |
| Relayer (hot key on the API host; low balance) | **NEEDED** | 0.0219978 | ? | needs funding |

## Transactions, in order
| # | Action | Sender | Funds moved | Est. gas | Est. fee at current price (USDC) |
|---|---|---|---|---|---|
| 1 | Deploy UnspentVault(USDC) | deployer | 0 | 2502398 | 0.06255995 |
| 2 | registerProvider(payout, metadataHash) | provider owner | 0 | 96547 | 0.002413675 |
| 3 | (offchain) update deployments.json with vault, block and provider ID; sync; rebuild; redeploy | you | 0 | | |
| 4 | USDC.approve(vault, 1.00) | customer | allowance 1.00 | 55438 | 0.00138595 |
| 5 | vault.deposit(providerId, 1.00) | customer | **1.00 USDC into the vault** | 152237 | 0.003805925 |
| 6 | reserveWithSignature (customer-signed limit 0.10) | relayer | 0.10 reserved | 232282 | 0.00580705 |
| 7 | acceptAndSettle (customer-signed acceptance of the real response) | relayer | **0.10 to the payout wallet** | 207674 | 0.00519185 |
| 8 | vault.refund(providerId, 0.90) | customer | **0.90 back to customer** | 77143 | 0.001928575 |

Amounts: deposit 1.00 · settlement 0.10 · refund 0.90 USDC (micro-USDC 1000000 / 100000 / 900000).
Estimated total fees at the current price: 0.083092975 USDC. With 2x headroom: 0.16618595 USDC. Not a fixed cost.
Customer funds at risk in the journey: 1.00 USDC (0.10 goes to your own payout wallet).

## Verification after each step
Chain ID 5042; vault `usdc()` equals the USDC address; deployed bytecode equals the artifact with immutables masked; provider owner/payout as intended; then each receipt, event amount and balance delta is re-read by `scripts/verify-claims.ts`-style checks before anything is reported.
