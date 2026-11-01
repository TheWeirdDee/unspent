# Testnet reconciliation (generated 2026-11-01T08:03:49.509Z)

Rebuilt from vault events only (Arc Testnet, chain 5042002, vault `0x080442a50d3bdf7d1aa5ed6d9383b39a8a413f85`, blocks 70107731..70147930; chain time 2026-11-01T08:03:47.000Z), then compared with the contract's own account data. USDC amounts; ledger values are 6-decimal.

## Accounts: rebuilt ledger vs contract
| Customer | Provider | Available | Reserved | Deposited | Spent | Refunded | Matches contract | available+reserved+spent+refunded = deposited |
|---|---|---|---|---|---|---|---|---|
| `0xff78be8ada611dafc6d4555e465f6f9b8403a2bc` | 1 | 0.1 | 0.3 | 14 | 0.6 | 13 | yes | yes |

All accounts reconcile: **true**.

## Solvency
- vault.solvency(): token balance 0.4 vs liability 0.4; ERC-20 view 0.4; native view 0.4 (same asset, 18-decimal view).
- Sum of Available+Reserved over every account: 0.4. Covered: **true**.

## Every reservation
| ID | Owner | Provider | Status | Max | Settled | Expiry (UTC) | State vs chain time |
|---|---|---|---|---|---|---|---|
| 1 | `0xFF78be8ada611daFc6d4555E465f6f9b8403a2bc` | 1 | Settled | 0.1 | 0.1 | 2026-11-01T02:40:37.000Z | - |
| 2 | `0xFF78be8ada611daFc6d4555E465f6f9b8403a2bc` | 1 | Released | 0.1 | 0 | 2026-11-01T02:26:31.000Z | - |
| 3 | `0xFF78be8ada611daFc6d4555E465f6f9b8403a2bc` | 1 | Released | 0.1 | 0 | 2026-11-01T03:07:34.000Z | - |
| 4 | `0xFF78be8ada611daFc6d4555E465f6f9b8403a2bc` | 1 | Settled | 0.1 | 0.1 | 2026-11-01T06:27:13.000Z | - |
| 5 | `0xFF78be8ada611daFc6d4555E465f6f9b8403a2bc` | 1 | Settled | 0.1 | 0.1 | 2026-11-01T06:27:52.000Z | - |
| 6 | `0xFF78be8ada611daFc6d4555E465f6f9b8403a2bc` | 1 | Settled | 0.1 | 0.1 | 2026-11-01T06:28:27.000Z | - |
| 7 | `0xFF78be8ada611daFc6d4555E465f6f9b8403a2bc` | 1 | Settled | 0.1 | 0.1 | 2026-11-01T06:42:43.000Z | - |
| 8 | `0xFF78be8ada611daFc6d4555E465f6f9b8403a2bc` | 1 | Released | 0.1 | 0 | 2026-11-01T07:25:13.000Z | - |
| 9 | `0xFF78be8ada611daFc6d4555E465f6f9b8403a2bc` | 1 | Reserved | 0.1 | 0 | 2026-11-01T07:27:50.000Z | EXPIRED: releasable now |
| 10 | `0xFF78be8ada611daFc6d4555E465f6f9b8403a2bc` | 1 | Reserved | 0.1 | 0 | 2026-11-01T07:30:25.000Z | EXPIRED: releasable now |
| 11 | `0xFF78be8ada611daFc6d4555E465f6f9b8403a2bc` | 1 | Reserved | 0.1 | 0 | 2026-11-01T07:56:47.000Z | EXPIRED: releasable now |
| 12 | `0xFF78be8ada611daFc6d4555E465f6f9b8403a2bc` | 1 | Settled | 0.1 | 0.1 | 2026-11-01T08:06:48.000Z | - |

## Per-account event ledger (running balances after each event)
### 0xff78be8ada611dafc6d4555e465f6f9b8403a2bc
| Block | Event | Amount | Available | Reserved | Spent | Refunded | Tx |
|---|---|---|---|---|---|---|---|
| 70108043 | deposit | 1 | 1 | 0 | 0 | 0 | `0x39be57a51781638deb1f25428fb54a7a0188b9f7c848c64a2679dd3d7471c816` |
| 70108051 | reserve #1 | 0.1 | 0.9 | 0.1 | 0 | 0 | `0x279e1e852a4ea4217289ecab7e381a787bb0106b77ad29af2bfd889a8a3d66f9` |
| 70108059 | settle #1 | 0.1 | 0.9 | 0 | 0.1 | 0 | `0x53f4f06462fb87de5a6a3c8afdeddd3eb92f5a877fda8e427f7ec277b95fc7a0` |
| 70108068 | reserve #2 | 0.1 | 0.8 | 0.1 | 0.1 | 0 | `0x163633a8ecb55533c28fd71f58afc78e32754ef8ffaf72e6733cede60c081209` |
| 70108156 | release #2 | 0.1 | 0.9 | 0 | 0.1 | 0 | `0xdf32ac943809c95987421d0e2a97dfd77ce029dc118e6dacfcd1d89d49fbcadb` |
| 70108164 | refund | 0.9 | 0 | 0 | 0.1 | 0.9 | `0x497da0be6e73594f77cddca0c06c1d7975000232a082130f0f759339fd80fee3` |
| 70110476 | deposit | 1 | 1 | 0 | 0.1 | 0.9 | `0x027a921d5375dcdba31f3d9e92f91f7f1409341ad47c19ac4029ce5615a7d3fc` |
| 70110493 | refund | 1 | 0 | 0 | 0.1 | 1.9 | `0xa1e136c64f5bedd8a2a909f512aeea29c76a5c326e269b6e82c25b9e84e594ff` |
| 70110623 | deposit | 1 | 1 | 0 | 0.1 | 1.9 | `0x9226f8cf9ea0e47e1d21d319565165c644c675ff961b141e12f14781662abbc6` |
| 70110640 | reserve #3 | 0.1 | 0.9 | 0.1 | 0.1 | 1.9 | `0xce7a7c52756daba76df73c7ab558e037f2bf6c0fe57fd95a1a77a8d58be52772` |
| 70134171 | deposit | 1 | 1.9 | 0.1 | 0.1 | 1.9 | `0x3f5b1f764dcf892dc3b9597b3b495b293208f1c8e5b95d7ac0decdca5878520e` |
| 70134183 | reserve #4 | 0.1 | 1.8 | 0.2 | 0.1 | 1.9 | `0x7012c935ccd324dfb65915a74c0511b335d9e31a8a11bb438155937bdb4cef68` |
| 70134196 | settle #4 | 0.1 | 1.8 | 0.1 | 0.2 | 1.9 | `0x642bfd94d537ef0c6c35e8bfefb9ade256fbe5bd04ab4320b940fc6db2b4d60c` |
| 70134248 | deposit | 1 | 2.8 | 0.1 | 0.2 | 1.9 | `0x092b1bf8ea76ab07bde04f878d8ac3b394a2c648b870caa7266b59bce8cbb495` |
| 70134260 | reserve #5 | 0.1 | 2.7 | 0.2 | 0.2 | 1.9 | `0x34b8b4a6277d1577e2a08c5e4ea794029203176b7b86173f1d65065ea8f72537` |
| 70134272 | settle #5 | 0.1 | 2.7 | 0.1 | 0.3 | 1.9 | `0x56b59dde94b1e262f01ef22f22867279842ea7c234f358108b900c3c19c27c27` |
| 70134317 | deposit | 1 | 3.7 | 0.1 | 0.3 | 1.9 | `0xb842a48f7907ece87c315aabb35acea13d108ee8d76b9f43ae8d4d3cfe6158b0` |
| 70134330 | reserve #6 | 0.1 | 3.6 | 0.2 | 0.3 | 1.9 | `0xf1bab34f90fff15e73e120bba6f98b31b92f6257a97d2448839cfb332732318b` |
| 70134344 | settle #6 | 0.1 | 3.6 | 0.1 | 0.4 | 1.9 | `0x2c316300cd966aca122cab4ed4cdd341d66f133ad21221dd9c281b8be5579e73` |
| 70134360 | refund | 3.6 | 0 | 0.1 | 0.4 | 5.5 | `0x3e85c1e4002e8442324f1f1dfd2088b2182d38a610ba758332ec8bb1fe1c5e89` |
| 70134429 | release #3 | 0.1 | 0.1 | 0 | 0.4 | 5.5 | `0xff08c95c6d126b653ba3da2d0b0580c531f4de9ce1e5c04964145ffc5cbde5e4` |
| 70134577 | refund | 0.1 | 0 | 0 | 0.4 | 5.6 | `0xb00d0e64fbe3c3c2b39308848dfd243fa2b791558b992afff9e1c6f1486f0e6b` |
| 70135706 | deposit | 1 | 1 | 0 | 0.4 | 5.6 | `0xf8f4cfa45e43a372249ee6db18e9dbb848f172c1d3b96f5f15c9fe0f439b18e4` |
| 70135999 | deposit | 1 | 2 | 0 | 0.4 | 5.6 | `0x6841557340b3930d3c062ee7ba284237b66ced3682db7975d2ec02e473d1d840` |
| 70136012 | reserve #7 | 0.1 | 1.9 | 0.1 | 0.4 | 5.6 | `0x6e9db47d056b6ce4703175007e3e91afcfa6be4e19597260b58bcd2fd4aa122f` |
| 70136027 | settle #7 | 0.1 | 1.9 | 0 | 0.5 | 5.6 | `0x8f771e46fee9d1f22b359c6d4f315eab2b2c0d0c6644503994bdef08d5bb0a3a` |
| 70136043 | refund | 1.9 | 0 | 0 | 0.5 | 7.5 | `0x2857ace090e22f44241e8471c65a700c0bac0013718695df1712eab88845746c` |
| 70141012 | deposit | 1 | 1 | 0 | 0.5 | 7.5 | `0x0ad51932b611d21581d6af0ca0f262b4e0b261c696e9884b1841845b26cdf39f` |
| 70141026 | reserve #8 | 0.1 | 0.9 | 0.1 | 0.5 | 7.5 | `0xf47cf6306b7b97426093a4e799b1a2fdeb71736d6ecc02d72cd467e05e29867f` |
| 70141321 | deposit | 1 | 1.9 | 0.1 | 0.5 | 7.5 | `0xa98d6227e0c86bf2af0f7364537da5951b6d31ca2eadbb948bb2f373eb171f50` |
| 70141335 | reserve #9 | 0.1 | 1.8 | 0.2 | 0.5 | 7.5 | `0x0a5d6077747db2c2ecc95cad954cf03e61af2b8398f56b20d09862b789f5b4c9` |
| 70141627 | deposit | 1 | 2.8 | 0.2 | 0.5 | 7.5 | `0xbb87d05b6070f030e90ba7c1f23e294c9fd62f98c6800cac4390e6839aad760e` |
| 70141641 | reserve #10 | 0.1 | 2.7 | 0.3 | 0.5 | 7.5 | `0x58bb1c97a5f23d528e3771cd858341c5f157127eec3954f522cad90af765d50e` |
| 70144736 | deposit | 1 | 3.7 | 0.3 | 0.5 | 7.5 | `0xceb95847d83b5673670eb6527dd71980b738b31238ba81eeec5e9c5b91464ae2` |
| 70144751 | reserve #11 | 0.1 | 3.6 | 0.4 | 0.5 | 7.5 | `0xa51c8ae85d8b7293a2b18e88472b9822cfb7436112ae96cc96a2e52bd88636c2` |
| 70145917 | deposit | 1 | 4.6 | 0.4 | 0.5 | 7.5 | `0xaf048e39e842740aabdb3923757ce5057480a2b8eb2a90bc8e3b5a13bbd56072` |
| 70145932 | reserve #12 | 0.1 | 4.5 | 0.5 | 0.5 | 7.5 | `0xf1d925ba4beebab701a1f6f5a706a34f1395affc5a017025210526a98535509a` |
| 70145945 | settle #12 | 0.1 | 4.5 | 0.4 | 0.6 | 7.5 | `0x0c4dfed7e22a4482f5bd7e9eac80f0a2f83dcf5246767458464c540042333f6c` |
| 70145963 | refund | 4.5 | 0 | 0.4 | 0.6 | 12 | `0x35cd458451903a34b1757a7d271139f828bb9f7036f87464719336bf63dfebb9` |
| 70146024 | deposit | 1 | 1 | 0.4 | 0.6 | 12 | `0x883f899e5de410aafcd40b026cf8e02bcba39f398d0ccd4f6c278215a545f8c8` |
| 70146251 | refund | 1 | 0 | 0.4 | 0.6 | 13 | `0xc938c23a3b79d9f19681a3c0851e972eb4e47f679b7f6307cd30b408b9cf84f8` |
| 70147785 | release #8 | 0.1 | 0.1 | 0.3 | 0.6 | 13 | `0xebc5386d9e3ba203ac54b318a7fbcfa5e0a01f7dd9da78d77af5752e7f66dfc0` |
