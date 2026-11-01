# Recording script (about 6.5 minutes)

Rule for the whole video: **nothing is re-staged.** Every transaction shown is an existing receipt from 1 Nov 2026 and the video says so. Any clip, screenshot or page that was not recorded live carries an on-screen label with its original date, for example "Recorded 1 Nov 2026, not a new transaction". No new funded transaction is made for this recording.

## Before recording

- Open these in tabs, in order: Studio project (signed in), GitHub commits page, `/proof`, `/app/use`, the five mainnet explorer links from [SUBMISSION.md](SUBMISSION.md), the recovery client, MetaMask issue #308206.
- Browser: ad and privacy extensions off or allowed for these sites, so nothing is cancelled on camera. Hide bookmarks, other tabs and your wallet's full account list.
- Do not connect a wallet and do not click any button that sends a transaction. Everything below is read-only.

## 1. Opening (0:00 to 0:30)

**Show:** the app landing page.
**Say:** "UNSPENT is refundable, USDC-backed prepaid API credits on Arc. You pay a provider only for a response you accept, and you can withdraw what's unspent at any time. Before anything else: the contract is not audited, MetaMask flags our domains and we haven't resolved why, and the mainnet evidence is one small run."

## 2. What was built in Arc Studio, and what came after (0:30 to 1:45)

**Show:** the Studio project and its build history (signed-in; owner-only). Then the GitHub commit list for `main`.
**Say:** "This was built in Arc Studio. On GitHub, 72 commits are authored by Arc Studio, from the first checkpoint at 02:22 UTC on 1 November to 08:05 UTC: the contract and its tests, the testnet deployment, the API, the app and the independent recovery client." (Scroll to `2608e2a`, then to `491a509`.) "Everything after that, over 40 commits, came afterwards in VS Code with Claude Code: build fixes, the mainnet deployment record, the proof page's mainnet section, an RPC fix for privacy extensions, and documentation. Those are not Studio work."
**On screen:** SUBMISSION.md's table, "What was built in Arc Studio, and what was done afterwards".
**Note:** Studio's own history is only visible to its owner. Say so if a reviewer will not have access.

## 3. The working hosted app (1:45 to 2:45)

**Show:** https://unspent-xi.vercel.app. Point at the "Arc" network badge, the contract card (vault `0xa737…5f49`, held 0, owed 0), then the footer build stamp.
**Show:** `/proof`. Scroll to "Arc mainnet (chain 5042)": the "Real USDC, unaudited contract" tag, the seven receipts each marked confirmed, and the paragraph about the MetaMask warning.
**Say:** "The proof page re-reads every receipt from the chain when it loads; a receipt it can't read shows as not verified instead of a green tick."

## 4. The real Gemini output (2:45 to 3:35)

**Show:** the saved screenshot of the Use the API page from the mainnet run (labelled "Recorded 1 Nov 2026, not a new request"). It shows the three Gemini bullets and the response hash `0x5b47fb6c…3b6d2e`.
**Say:** "These three lines are what the model returned. The customer signed acceptance of exactly this response hash."
**Show (terminal):**
`cast keccak $'- Conducted mainnet test of prepaid refundable USDC credits\n- Utilized the Arc platform for the testing phase\n- Scheduled and executed on November 1, 2026'`
**Say:** "Hashing that text gives `0x5b47fb6c…e3b6d2e`. The next section shows the same hash inside the settlement transaction."

## 5. The mainnet deposit, settlement and refund (3:35 to 5:15)

**Say first:** "These are the existing receipts from 1 November, not new transactions."
For each, open the explorer link and show the decoded logs:
1. **Deposit** `0x3cae816d…d49cbf`: USDC transfer of 0.20 from the customer to the vault, and `CreditsDeposited`.
2. **Reserve** `0x95c1399e…02a1b1`: sent by the relayer, carrying the customer's signature; 0.10 reserved.
3. **Settlement** `0xf69425cd…2d601f`: USDC transfer of 0.10 from the vault to the payout wallet, and `UsageSettled` containing response hash `0x5b47fb6c…e3b6d2e`. **Point at the match with section 4.**
4. **Refund** `0x0b8c3b32…bdd11b`: USDC transfer of 0.10 back to the customer, and `CreditsRefunded`.
**Show:** the vault address page: it holds 0 USDC.
**Say:** "In total 0.20 went in, 0.10 was paid to the provider's payout wallet, 0.10 came back, and the vault now holds nothing. The provider's owner and payout wallet are the same wallet, so the 0.10 went to a wallet the owner controls."

## 6. Independent recovery (5:15 to 5:50)

**Show:** https://unspent-recovery.pages.dev. It opens on Arc mainnet. Paste the customer address in the read-only box: available 0, reserved 0, spent 0.10, refunded 0.10.
**Say:** "This is a separate static site. It reads the contract directly and never calls the UNSPENT API. We tested real recovery during a real outage on testnet: we suspended the hosted API at its host and used this client to release two expired reservations and refund 1.00 USDC from a real MetaMask wallet." (Show [fresh-wallet-recovery-test.md](fresh-wallet-recovery-test.md), labelled "testnet, recorded 1 Nov 2026".) "We have **not** run an outage test on mainnet."

## 7. Close (5:50 to 6:30)

**Show:** the README status block, then GitHub issue #308206.
**Say:** "To be plain about what this does not show: the contract is unaudited, this is one small mainnet run, MetaMask flags both domains and the cause is unknown, and there's been no mainnet outage test. Everything you saw is checkable at the links in the submission."

## Do not

- Present a screenshot or earlier clip as live or as a new transaction.
- Say "audited", "mainnet-ready", "production-ready", or that the MetaMask warning is fixed or a false positive.
- Say the mainnet journey included an outage, or that Studio produced the later fixes.
- Run a new funded transaction just for the video.
