# Mainnet plan (NOT executed; needs your explicit approval)

Arc Studio does not sign or submit mainnet transactions. You run these from your own wallet. Nothing here has been done.

Verified against official docs and the live RPC on 1 Nov 2026: chain ID 5042, RPC https://rpc.mainnet.arc.io, explorer https://explorer.arc.io, USDC ERC-20 interface 0x3600000000000000000000000000000000000000 (6 decimals, code present, `decimals()` = 6). Native gas uses 18 decimals; the minimum fee floor is 20 gwei. Live gas price read: 25 gwei.

## Preconditions

1. Independent review of `contracts/UnspentVault.sol` (this project has no audit).
2. A deployer wallet you control with a little USDC for gas. Never share its key; use a keystore.
3. Decide the provider owner wallet and the payout wallet (they should be different; the payout wallet receives money).
4. A relayer wallet (separate, low balance) for the sample API, and a funded customer wallet for the demo.

## Steps, amounts and estimated gas (at 25 gwei; gas figures measured on testnet)

| # | Action | From | Amount moved | Est. gas | Est. fee (USDC) |
|---|---|---|---|---|---|
| 1 | Deploy `UnspentVault(0x3600000000000000000000000000000000000000)` | your deployer | 0 | 2,502,398 | 0.0626 |
| 2 | `registerProvider(payoutWallet, metadataHash)` | provider owner | 0 | 96,547 | 0.0024 |
| 3 | Update `deployments.json` (mainnet vault, block, provider ID), `bun run sync:deployments`, `bun run recovery:build`, redeploy app and recovery client | you | 0 | - | - |
| 4 | `approve(vault, 1.00 USDC)` on USDC | demo customer | 1.00 (allowance only) | 55,438 | 0.0014 |
| 5 | `deposit(providerId, 1.00)` | demo customer | 1.00 into the vault | 152,237 | 0.0038 |
| 6 | `reserveWithSignature` (0.10) | relayer | 0 | 232,282 | 0.0058 |
| 7 | `acceptAndSettle` (0.10) | relayer | 0.10 to payout wallet | 207,674 | 0.0052 |
| 8 | `refund(providerId, 0.90)` | demo customer | 0.90 to customer | 77,143 | 0.0019 |

Total fees were about 0.084 USDC at the 25 gwei reading above. That is not a fixed cost: the fee market moves, and Arc's base fee has a 20 gwei floor and a 20,000 gwei ceiling. **Recalculate with `bun scripts/mainnet-gas.ts` immediately before you approve anything**; it reads the live gas price and prints the table (and a 2x-price case). Funds at risk in the demo: 1.00 USDC (0.10 goes to your own payout wallet).

Latest reading (block 28,944,263): base fee 20 gwei, gas price 25 gwei.

## Checks after each step

Read `chainId` = 5042; confirm the constructor argument; read `usdc()` = the address above; compare the deployed bytecode with `contracts/out/UnspentVault.sol/UnspentVault.json` (`forge build` at the recorded commit); verify the source on the explorer when possible; record the deployment block for the indexer start point.

## Not claimed until receipts exist

No mainnet deposit, settlement or refund is claimed anywhere. `/proof` shows mainnet as "Not deployed" until `deployments.json` has a mainnet vault, and its transaction list is always re-read from the chain.
