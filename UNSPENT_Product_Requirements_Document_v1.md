# UNSPENT — Product Requirements Document

**Version:** 1.0  
**Status:** Build-ready specification; technical and commercial assumptions remain subject to validation  
**Date:** 30 October 2026  
**Target:** Arc Microgrants: Built with Arc Studio  
**Network:** Arc Mainnet (chain ID 5042)  
**Product category:** Refundable USDC-backed prepaid credits for API services  
**Product statement:** *Buy API credits. Use what you need. Withdraw what you don't.*

> **Critical product boundary:** UNSPENT makes the customer's onchain credit balance independently verifiable and refundable. It does **not** cryptographically prove that an offchain API delivered correct service, guarantee a refund of money already spent, protect against lost wallet keys, or eliminate all merchant/customer disputes. Initial mainnet use must be limited to small funds until independent contract review.

---

## 1. Executive summary

UNSPENT is a prepaid payment system for developers and AI-service operators. Customers deposit real USDC into a smart contract on Arc. The same atomic onchain operation establishes a provider-specific credit balance. Customers spend credits on API calls using a bounded reservation and customer-authorised settlement flow. Unspent available funds remain withdrawable by the customer's wallet, including through an independent recovery interface if the provider's normal application or database is unavailable.

**The demonstrated failure:** In public reports involving Conway's Automaton, users described completed onchain USDC top-ups that were not reflected in their application credit balance. These are incident reports, not proof that every provider has this issue. UNSPENT targets the architectural mismatch that makes this class of failure possible: payment and credit issuance occurring in separate systems with different failure modes.

**The dominant mechanism:** *A USDC deposit and its onchain credit issuance are one transaction; unused credits remain controlled by contract rules rather than an application database.*

**The memorable product demonstration:** A customer purchases credits, successfully pays for one real AI API response, sees the provider's settlement on Arc, then sees the normal billing backend fail. They can still read and withdraw their remaining credit from a standalone recovery page that communicates directly with the contract.

### Goals

- Eliminate paid-but-uncredited states **inside UNSPENT's onchain accounting system**.
- Show real USDC moving through a purpose-built contract on Arc Mainnet: deposit, provider settlement, refund.
- Build contracts, tests, and application with Arc Studio and preserve verifiable Studio project evidence.
- Give customers a recognisable balance, usage receipt, transaction history, and refundable amount.
- Give one real sample API and at least one merchant the ability to accept backed credits, settle approved consumption, and reconcile transactions.
- Make the product independently understandable within ten seconds, with a complete first-use journey and an unmistakable recovery moment.

### Non-goals / explicit boundaries

- No yield, lending, token issuance, price speculation, stablecoin swaps, or cross-chain bridging. These do not strengthen the credit-recovery mechanism.
- No arbitrated refunds for already-consumed API services. The onchain contract cannot objectively judge offchain service quality.
- No merchant power to charge unapproved usage or redirect customer refunds.
- No implication that a Studio-generated contract is audited or generally safe for large deposits.
- No claim that a provider must honour credits when its offchain service is unavailable; the customer's safeguard is withdrawal of unspent, unreserved funds.
- No fabricated transaction, fake merchant customer, invented usage activity, or silently simulated failure in public evidence.

---

## 2. Problem, evidence, and target market

### 2.1 User problem

A developer pays a service upfront for API usage. The payment settles, but a separate backend step fails to grant credits. The developer loses immediate access to both the purchased service and a convenient refund route. Manual support, reconciliation, or reprocessing is needed.

### 2.2 Specific anchor

- Conway Automaton GitHub issue #408 (27 September 2026): reporter described a 5 USDC x402 top-up with a failed application credit grant and HTTP 500 response. Original incident occurred on Base; UNSPENT is an Arc-based proposed solution to this failure class, not a claim it already fixes the affected service.
- Conway Automaton GitHub issue #237 (26 February 2026): reporter described three 5 USDC transfers whose purchased credits did not appear.
- Both are user-reported cases. Their root causes, prevalence, and outcomes have not been independently verified for this PRD.

### 2.3 Initial market

Primary customers: developers buying prepaid AI inference, text extraction, document parsing, and automation API usage. Primary adopting organisations: small API providers with prepaid balance systems, especially those willing to exchange immediate control of unspent funds for customer assurance and simpler reconciliation.

### 2.4 Personas

**Customer / developer:** Has an EVM wallet and USDC on Arc. Wants a few dollars of reliable API credits, transparent charges, and a straightforward refund. Does not want to understand Solidity or reconciliation workers.

**Provider / API operator:** Registers a payout wallet and service metadata, sets published per-call prices, returns a useful response, collects only customer-authorised charges, and sees payment receipts that match chain events.

**Autonomous client (later integration):** A programmatic API consumer capable of signing individually bounded authorisations. The initial product proves this with explicit customer signatures; unattended delegated session keys are a separate, security-reviewed extension.

**Hackathon judge:** Arrives with no account or USDC. Must understand the product and inspect real proof, with an optional wallet-funded live path. Never require judges to spend money to evaluate the core story.

### 2.5 Key unanswered adoption question

Do providers value refundability enough to accept that unconsumed prepayments remain escrowed? Conduct and document at least three actual operator conversations before making claims about commercial readiness. A provider's enthusiastic comment is not a signed integration agreement.

---

## 3. Outcome definitions and release metrics

### 3.1 User outcome

After a completed USDC deposit, a customer's provider-specific available balance increases atomically and can be read from the contract without the application's database. After one consumed call, provider settlement and the reduced refundable balance reconcile exactly. A customer can initiate refund of available credits even when the normal billing API has been intentionally disabled.

### 3.2 Required launch proof

1. One confirmed `CreditsDeposited` event on Arc Mainnet showing actual USDC entering the contract.
2. One confirmed `UsageSettled` event releasing customer-authorised USDC to the provider.
3. One confirmed `CreditsRefunded` event returning the remaining available USDC to the customer.
4. Public links to the deployed contract and each transaction.
5. Arc Studio project URL and evidence showing contracts, tests, and app work inside Studio.
6. A deployed usable app, public source repo, working sample API, and film showing real transaction outcomes.
7. A recorded failure/recovery demonstration with the test condition clearly labelled.

### 3.3 Product measurements

- Deposit correctness: every **confirmed successful contract deposit** produces the exact corresponding available credit increase in the contract, as measured over all recorded deposit tests.
- Financial conservation: across tests, available + reserved liabilities never exceed contract-held accounting reserves, except where prohibited external token behaviour makes transfers impossible; all cases investigated rather than masked.
- Double-settlement attempts: must always reject in tests.
- Double-refund attempts: must always reject in tests.
- Backend-independent recovery: successful direct contract reads and refunds while the application backend is unavailable, subject to RPC and wallet availability.
- Failed/reverted transactions surfaced clearly; do not display them as confirmed or as new credits.
- Document real counts, denominators, conditions, and any misses. Never claim 100% production reliability from a short controlled test.

---

## 4. Product model and financial rules

### 4.1 Unit of account

One displayed USDC-denominated credit equals one USDC of redeemable prepaid value with precision to six decimals. Credits are internal accounting units, **not** a transferable ERC-20 token. All balances in contract storage are integer micro-USDC units. A provider can price a request at, for example, 0.10 credits (100,000 micro-units).

### 4.2 Per-provider balances

A deposit belongs to one `(customer wallet, provider ID)` pair. Available credits with Provider A cannot be spent by Provider B. A provider's metadata and settlement wallet are recorded in a registration entry. Changing the payout address must not let a past authorisation silently settle to a different intended recipient: authorisations bind the payout address or a versioned provider payout configuration.

### 4.3 Three balances

- **Available:** deposited value not reserved or settled; refundable immediately.
- **Reserved:** value locked for an in-flight, customer-authorised request; not refundable until released or expired.
- **Spent:** cumulative customer-approved usage already paid to the provider; not refundable through the contract.

The customer dashboard must show **Available to use**, **In-flight / reserved**, and **Total paid for usage** separately. “Refundable now” equals **Available**, not Available + Reserved.

### 4.4 Core account equations

For each customer-provider account:

`available + reserved + spent + refunded = totalDeposited` (assuming no separate fees or refunds of settled services).

For the contract as a whole:

`contract-accounted outstanding customer liability = sum(available + reserved)` over all customers and providers.

Actual token balance must be at least this liability, allowing only independently documented accidental surplus from direct transfers. No function may give an administrator the ability to extract customer-backed USDC.

### 4.5 Pricing and fee policy

- Demo provider has a **fixed visible price per call** (recommended 0.10 USDC) and a per-request bound agreed before execution.
- UNSPENT platform fee is **0% for initial build**. This keeps settlement math and judge proof simple; introducing a fee would require new contract and UX acceptance tests.
- Gas is paid separately from wallet-held USDC. The UI must estimate it, keep a gas buffer, and avoid promising that the customer can transfer their entire balance without transaction costs.
- No minimum deposit enforced in the contract beyond positive amounts; the UI may suggest 1.00 USDC and validate enough credit for a sample call.

---

## 5. Core state machine

### 5.1 Purchase

`Wallet connected → correct network → allowance checked → approval (if needed) → deposit transaction → chain success → credits available`

The `deposit` contract function performs a standard USDC ERC-20 `transferFrom` and then credits the customer atomically. If transfer fails, the credit update reverts. **Do not mint credits merely because the backend received a transaction hash.** An ERC-20 `approve` alone does not purchase credits.

### 5.2 Request lifecycle

`DRAFT → RESERVING → RESERVED → PROCESSING → DELIVERED_AWAITING_ACCEPTANCE → SETTLED`

Alternative branches:

- Reservation transaction fails → no service executed, no charge.
- Service fails before returning result → reservation released by customer or designated safe release mechanism; amount returns to Available.
- Customer does not accept result → reservation remains until expiry and then customer can release it. This creates provider nonpayment risk, disclosed honestly.
- App/backend crashes at any stage → contract state remains recoverable. Any expired reservation can be released from the independent recovery page.
- Concurrent refund and reserve are serialized by contract transaction ordering; the operation without sufficient available credit reverts.

### 5.3 Settlement authorisation

**No provider-initiated debit without customer authorisation.** Two signatures govern the MVP:

1. Customer signs an EIP-712 `ReserveAuthorisation` limited to provider, payout configuration, request hash, maximum amount, unique nonce, and expiry. Any relayer may submit it onchain to reserve the funds. The customer's available balance decreases and reserved balance increases.
2. After receiving the actual result, the customer confirms delivery and signs an EIP-712 `DeliveryAcceptance` that binds reservation ID, response hash, final amount (no greater than the reservation), nonce, and expiry. Any relayer may submit this signature to settle to the registered provider payout address; unused reservation remainder returns to Available. A customer can alternatively call an equivalent direct-settlement method themselves.

Provider settlement is therefore never a unilateral action. No post-response acceptance means the provider cannot unilaterally collect, even if it performed legitimate work. This is a deliberate customer-protection trade-off, not a hidden promise of frictionless merchant economics.

**Time-bound reservations:** A reservation expires at a configured deadline after successful onchain creation, e.g., 15 minutes for the sample API. Once expired, the customer (or a permissionless caller for the benefit of the customer) can release it. Settlement must not be allowed after expiry. Exact expiry handling must be unit-tested at `deadline - 1`, `deadline`, and `deadline + 1`.

### 5.4 Refund

`Available balance > 0 → user selects amount → wallet transaction → confirmed transfer → CreditsRefunded event`

A refund returns USDC only to the customer wallet recorded as the account owner, not to an arbitrary address supplied by a provider, relayer, or URL. A malicious third party may call a permitted `refundFor(customer, provider)` method only if the payment still goes to that customer's wallet. Refunds must remain callable during application-level service pauses, except where token network-level restrictions prevent transfer.

---

## 6. User stories and acceptance criteria

| ID | Priority | User story | Must be true to accept |
|---|---|---|---|
| C01 | P0 | As a developer, I connect a wallet | Supported EVM wallet connects; wrong chain prompts switch to Arc; address and balances update on change/disconnect. |
| C02 | P0 | I buy 1 USDC of sample credits | Approval and deposit are distinct and legible; a confirmed deposit creates exactly 1.000000 available credit for the selected provider. |
| C03 | P0 | I can inspect my balance independently | Contract direct-read matches normal dashboard; a database outage does not change authoritative balance. |
| C04 | P0 | I make a real paid API request | UI shows price, asks for bounded reserve signature, waits for confirmed reservation, calls actual endpoint, and displays real response. |
| C05 | P0 | I consent to pay for delivered work | I inspect returned response and accept; contract transfers only the agreed charge to the exact registered provider payout wallet. |
| C06 | P0 | I recover unused funds | I refund Available credits using direct contract calls; reserved or spent value is excluded. |
| C07 | P0 | I recover after application failure | Independent static recovery page loads balance and executes refund with normal application backend intentionally disabled. |
| C08 | P0 | I know what happened | Every pending, failed, expired, and confirmed step is explicit; onchain confirmations have explorer links. |
| C09 | P0 | A request fails or stalls | No invisible charge; reserved funds can be released after failure or expiry, with precise status displayed. |
| P01 | P0 | As a provider, I register a payout identity | Onchain provider ID and payout wallet registered; only owner can update payout settings; authorisations bind configuration version. |
| P02 | P0 | I receive paid-for usage | Successful customer acceptance produces exactly one provider payout and one immutable usage event. |
| P03 | P0 | I can reconcile revenue | Provider UI lists accepted usage, amount, customer (abbreviated), reservation ID, transaction and explorer link. |
| J01 | P0 | As a judge, I understand it immediately | Public top section describes the paid-but-uncredited failure and shows “purchase → use → recover” journey without jargon. |
| J02 | P0 | I inspect proof without paying | Public evidence area has live app, source, Studio project, contracts, and example mainnet transaction links. |
| A01 | P1 | As a developer, I integrate the API | Documentation shows programmatic reserve, service request, result acceptance, and refund, with runnable code. |
| A02 | P1 | I inspect precise activity | History filters by deposit/reservation/settlement/release/refund and shows idempotency/receipt IDs. |

P0 means a complete user journey, not merely a screen mockup. P1 extends the same mechanism and should be implemented when it materially improves the real judge path. Do not cut logically coherent scoped features solely because the window is short.

---

## 7. Information architecture and exact UX specification

**Visual intent:** An understated developer-finance product, not a crypto trading terminal. Put understandable monetary outcomes first. Present contract and transaction details on demand, never above the primary task. The brand name and the core promise should appear immediately. No design-token values are specified here.

### 7.1 Global app shell

**Desktop:** Persistent top navigation with UNSPENT mark on left; links `Overview`, `Use API`, `Activity`, `Recover`, `For providers`, `Docs`; on right, Arc network badge and `Connect wallet` / shortened wallet address. Content area uses a centered maximum-width layout. A thin network/data-status indicator appears under the nav when connected.

**Mobile:** Single-row brand + network + wallet trigger. Navigation collapses into a clearly labelled menu; main account actions remain visible. Tables become stacked event cards. All transaction confirmations and error messages remain readable without horizontal scrolling.

**Universal states:** `Connect wallet`, `Wrong network`, `Loading onchain data`, `Ready`, `Awaiting wallet approval`, `Transaction submitted`, `Confirmed`, `Transaction failed`, `RPC unavailable`, `Backend unavailable`. Never show cached balances without a visible “last checked” or stale-data qualifier.

### 7.2 Public landing / first visit (`/`)

**Above fold:**

- Left side: small label `Refundable USDC API credits`; headline `Pay for API usage. Get back what you don't use.`
- Two short sentences: “Your prepaid balance lives in an Arc smart contract, not only in a provider database. Spend credits on a real API and withdraw what remains.”
- Main CTA `Open app`; secondary CTA `See live proof`.
- Right side: a real balance-and-usage visual using verified account or explicitly labelled example data. No fabricated transaction hash.

**Below fold:** three plainly described steps `Deposit`, `Use`, `Withdraw`; a concise explanation of why separate credit databases can go wrong; and a small evidence strip with verified transaction and source links. A short limitation line states that correctness of offchain service is not guaranteed by the contract.

### 7.3 Overview (`/app`)

**Top:** `Your credits` heading; subheading says `Backed by USDC on Arc`; connected wallet and refresh timestamp.

**Primary balance card:** large `Available: 0.90 USDC`; beneath it `Reserved: 0.00`, `Spent: 0.10`, `Total deposited: 1.00`. Label `Refundable now: 0.90 USDC` should be prominent. Show `Buy credits` and `Withdraw unused` buttons. If multiple providers exist, show provider picker directly above card and explain that balances are provider-specific.

**Next row:** compact account journey `1. Deposit → 2. Use API → 3. Recover` with each step linked. Highlight current state (e.g., “Ready to use TextLab”).

**Bottom left:** latest three events showing amount, direction, status and explorer action. **Bottom right:** `Why this is safe when an app goes down` card explaining contract-backed credits without claiming the entire product is trustless.

**Empty state:** “No credits yet. Add USDC to try the sample API.” CTA `Buy 1 USDC`. **Pending state:** display wallet signature or transaction stage without optimistically counting credits as settled.

### 7.4 Deposit flow (`/app/deposit`, also modal from Overview)

**Step A — Select provider:** default sample merchant `TextLab API`; show its published wallet, service and current price per request. Clearly indicate if it is a built-in sample merchant and whether it is verified by UNSPENT.

**Step B — Enter amount:** show presets `1`, `5`, and `10 USDC` plus custom amount; read wallet USDC balance; display estimated gas separately, avoiding promises about exact gas costs. Primary CTA `Continue`.

**Step C — Review:** merchant, deposit amount, refundable amount before usage, token/network/contract, wallet balance and concise risk/terms notice. If allowance < amount: first CTA `Approve USDC`; once confirmed, show `Deposit USDC`. If allowance already sufficient, skip approval. UI shows approval as **not** a deposit.

**Step D — Confirmation:** status progress `Awaiting wallet → Submitted → Confirmed`; show resulting credit balance, transaction hash, `View on Arc Explorer`, and `Try the API` CTA. Do not claim credit before receipt status is successful.

**Failure states:** user rejects approval, user rejects deposit, insufficient USDC/gas, wrong chain, approval finalised but deposit rejected, chain RPC failure, token transfer reverts. Each has direct next action; no duplicated auto-resubmissions.

### 7.5 Use API (`/app/use`)

**Left pane — Compose:** sample API title `TextLab / Summarise`; short explanation of actual processing; input textarea with suggested real-source prompt the user can replace; character limit; `Price: 0.10 USDC per request`; `Current available: 1.00`; action `Reserve 0.10 and run`. A mini-step indicator communicates `Authorise → Reserve → Run → Accept → Pay`.

**Right pane — Run:** four labelled sections visible as the request progresses:

1. `Authorisation` — maximum amount, provider, short request hash, signature status.
2. `Onchain reserve` — pending/confirmed and explorer link; available and reserved values update.
3. `Service output` — streamed or completed actual API output, elapsed time, model identity (where relevant), and error if real endpoint failed.
4. `Accept result and pay` — show exact amount, provider payout destination and final response hash; button `Accept & release 0.10 USDC to TextLab`. Acceptance requires wallet signature; once confirmed, the card becomes `Paid` with transaction link and updated balances.

**Important:** No automatic settlement based solely on a server saying `200`. The final debit occurs only after customer acceptance as specified in Section 5. If customer closes the tab or refuses delivery acceptance, show an in-flight reservation with expiry and a direct release path once eligible.

**API error:** display `No completed result; your 0.10 remains reserved until release/expiry`, not `Refunded` until onchain release actually happens.

### 7.6 Activity (`/app/activity`)

List account events newest first, sorted by blockchain block number and log index, not wall-clock timestamp alone. Filters: `All`, `Deposits`, `Reservations`, `Usage`, `Releases`, `Refunds`. Each event shows concise label, amount, provider, state, time for human convenience, transaction link, and optional expand panel for request/response hash (never plaintext private prompt onchain). Summary at top reconciles total deposited, settled, refunded, available and reserved.

### 7.7 Recover (`/recover`)

**This is a core product, not a help article.** Host a standalone static recovery application on a separate hosting surface or independent static bundle. It must not import the primary API client's authentication, database session, usage endpoint or backend balance cache. It should read the deployed contract directly using an independent RPC configuration and write refund/release transactions with the user's wallet.

**Top:** `Your funds, even if an app goes offline.` A short status banner states `Connected directly to Arc; provider API is not required`. Display network, contract address, provider and customer wallet.

**Balances:** Available / Reserved / Refunded, each with a clear explanation. If reserved items exist, list amount, request ID and exact expiry status. For expired reservations, offer `Release expired reserve` and explain that it returns to Available (not directly to the wallet). For available credits, show `Refund to my wallet` and destination locked to connected account.

**Confirmation drawer:** refund amount, onchain contract, wallet recipient, expected resulting balance, gas estimate and irreversible transaction caution. Final CTA `Confirm refund`. After confirmed status, show USDC transfer receipt and explorer link.

**Failure demonstration banner:** On public demo evidence screens, `SIMULATED APPLICATION BACKEND OUTAGE` is a conspicuous label when the operator triggers outage in the owned sample service. Actual wallet, chain reads and transfers remain live. Never imply there is a real unreported outage at any third-party service.

**If RPC fails:** try another verified RPC and show `Onchain data temporarily unavailable; no funds have moved` with a retry control. Do not invent balance. If the user's wallet lacks gas, explain that a small additional native USDC gas balance may be required; the product does not promise gas sponsorship.

### 7.8 Provider portal (`/provider`)

**Provider overview:** registered merchant name, provider ID, payout wallet, status and latest received payments. Cards show `Total settled`, `Settled today` (derived from indexed events), `Pending requests` (offchain informational), and `Credits outstanding` (onchain liability for that provider).

**Usage table:** request ID, customer shortened address, service, quoted price, state `reserved / awaiting acceptance / settled / expired`, amount paid, explorer link. Clearly distinguish requests that generated an API response from those paid by onchain acceptance.

**Settings:** update payout wallet with owner signature and bump payout version; warn that older signed reservations bound to previous configuration cannot be silently redirected. Edit service description/prices in authenticated app metadata with versioning and effective date. Payout-wallet change is always onchain.

### 7.9 Documentation (`/docs`)

Show what “credits” means, deposit instructions, service-use flow, signature schema, reservation expiry behaviour, refund procedure, links to verified code and contracts, and a runnable TypeScript example. Separate `Security assumptions` from promotional copy. Add a visible `Mainnet demo; contracts have not been independently audited` notice unless actually audited.

### 7.10 Public proof (`/proof`)

Public read-only page: problem link, one-sentence product thesis, `Live app`, `Arc Studio project`, `GitHub`, deployed contract, verified deposit/usage/refund hashes, and a short walkthrough film. A `Recreate with your own wallet` button links to the funded application but public proof does not require a deposit. All example records must refer to actual chain events or be explicitly labelled fixtures.

### 7.11 Responsive, accessible, and trust UX

- All pages keyboard reachable; focus order follows visible task order.
- Buttons show why disabled; every wallet step is described in words.
- Monetary amounts use fixed decimal formatting and never rely on floating-point JavaScript values for ledger math.
- Status never conveyed by colour alone. Wallet errors have readable explanations.
- Small screens show cards rather than dense tables; status labels and refund actions remain visible.
- Copy avoids “guaranteed safe”, “trustless everything”, or “instant” when RPC, wallet, service or network status can vary.

---

## 8. Smart contract specification

### 8.1 Deployment units

**One main contract: `UnspentVault.sol`**, with tested standard libraries for ERC-20 safe transfers, EIP-712 typed data, signature verification, reentrancy protection and controlled provider registration. Use a second registry contract **only** if Arc Studio's generated architecture has a clear, audited advantage; unnecessary contract factories expand review risk.

Network config:

- Arc Mainnet chain ID: `5042`
- Mainnet RPC: `https://rpc.mainnet.arc.io`
- Explorer: `https://explorer.arc.io`
- USDC ERC-20 interface: `0x3600000000000000000000000000000000000000`
- USDC ERC-20 precision: **6 decimals**; native gas representation uses **18 decimals**. Treat these as different numeric interfaces to the same underlying asset and never mix values without explicit unit conversions.
- Externalised config for testnet vs mainnet; no hardcoded fake USDC token at launch.

### 8.2 Suggested storage

`Provider { owner, payoutWallet, payoutVersion, active, metadataHash }`

`Account { available, reserved, totalDeposited, totalSettled, totalRefunded }`

`Reservation { id, customer, providerId, payoutWalletBound, requestHash, maxAmount, expiry, status, responseHash, settledAmount }`

`usedReserveNonce[customer][nonce]` and `usedAcceptanceNonce[customer][nonce]` (or robust random nonce replay protection). Global `totalOutstandingLiability`. Optional per-provider outstanding amount.

Provider IDs are immutable. Payout address changes increment `payoutVersion`; every reservation signature binds the version and payout destination. Original provider owner is authenticated onchain. Public display metadata and pricing in a separate versioned data store do not grant billing authority.

### 8.3 Required callable functions

| Function | Caller | Main contract effect |
|---|---|---|
| `registerProvider(payoutWallet, metadataHash)` | prospective provider | creates provider and immutable ID; emits event |
| `updateProviderPayout(providerId, newPayout)` | provider owner | validates nonzero address, increments version, emits event |
| `setProviderActive(providerId, active)` | provider owner | controls new reservations; cannot freeze existing customer withdrawals |
| `deposit(providerId, amount)` | customer | transfers ERC-20 USDC into contract; increments available and liabilities atomically |
| `reserveWithSignature(authorisation, signature)` | any relayer | verifies EIP-712 customer consent, provider configuration and nonce; moves available → reserved |
| `acceptAndSettle(acceptance, signature)` | any relayer | verifies customer approval, response hash, amount and expiry; reduces reserved, pays provider, returns unused reserved remainder to available |
| `releaseExpired(reservationId)` | any caller | after expiry, returns reserved funds to same customer's available balance; marks reservation released |
| `refund(providerId, amount)` | customer | decreases available and liability; sends USDC to msg.sender |
| `refundFor(providerId, customer, amount)` | any caller, optional | same refund but always to `customer`; avoid entirely if not needed |
| `getAccount(providerId, customer)` | read-only | returns full financial account state |
| `getReservation(reservationId)` | read-only | returns lifecycle and expiry fields |
| `getProvider(providerId)` | read-only | returns immutable identity and current payout configuration |

**Settlement ordering:** validate signatures and state, update reservation/account/liability state, then make the external USDC transfer, using reentrancy protection. If the transfer fails, the entire state change must revert. No partial settlement should be possible.

**Signature policy:** EIP-712 domain binds `name`, `version`, `chainId`, `verifyingContract`. Signed reserve includes customer, provider ID, payout wallet/version, request hash, maxAmount, unique nonce, deadline. Signed acceptance includes customer, reservation ID, response hash, final amount, unique nonce, deadline. If smart-contract wallets are supported, use a vetted ERC-1271 checker; otherwise clearly list the EOA-only support boundary.

### 8.4 Events

- `ProviderRegistered(providerId, owner, payoutWallet)`
- `ProviderPayoutUpdated(providerId, oldPayout, newPayout, version)`
- `ProviderStatusChanged(providerId, active)`
- `CreditsDeposited(providerId, customer, amount)`
- `UsageReserved(reservationId, providerId, customer, amount, expiry, requestHash)`
- `UsageSettled(reservationId, providerId, customer, amount, responseHash, payoutWallet)`
- `ReservationReleased(reservationId, providerId, customer, amount)`
- `CreditsRefunded(providerId, customer, amount)`

All financial events should expose a coherent customer/provider relationship and amount. Never place full API inputs, API outputs, secrets, email addresses or access tokens in events.

### 8.5 Atomicity and insolvency protections

- Deposit and credit balance increase are atomic.
- A reservation may move at most the available balance authorised by customer.
- A reservation can be settled once or released once, never both.
- A settlement may not exceed its reserved maximum.
- A customer may refund only Available; reservation remains segregated.
- Every provider payment reduces outstanding contract liability by the actual settlement amount.
- Every refund reduces outstanding contract liability by the actual returned amount.
- Any unspent reservation remainder returns to Available without increasing total liability.
- Only customer-backed available/reserved balances count as withdrawable liabilities; unsolicited token transfers are not minted into credits.
- No privileged rescue of owed funds; any surplus recovery would require an independently justified policy and must not be included casually.
- Provider deactivation and emergency pauses must not disable customer refunds or expiry releases. Emergency settlement suspension can be considered if refunds and releases continue.

### 8.6 Contract security

Check zero addresses, nonce reuse, expired signatures, malformed values, wrong provider, wrong chain, wrong verifying contract, payout-version changes, replayed acceptance, duplicate reservation IDs, reentrancy and all ERC-20 transfer return values. Use pinned and reviewed dependencies. Do not use an upgradeable proxy for this initial vault unless a reviewed design explicitly demands one; immutable code makes the trust assumption easier to explain. No funds should be accepted to an unreviewed mainnet address.

---

## 9. Backend and service architecture

### 9.1 Principle

The blockchain is the financial source of truth. The application database indexes events and stores usability metadata; it never invents customer balances, grants credits for unconfirmed receipts, or can prevent onchain withdrawals.

### 9.2 Components

1. **Web client:** Next.js app, wallet connection, reads/writes, request UI, provider dashboard, proof page.
2. **Recovery client:** small independently deployed static frontend with ABI, RPC config and wallet support; no dependency on primary backend or login.
3. **Application API:** Node/TypeScript server; authenticates SIWE sessions for private data; validates prices and requests; orchestrates sample AI calls.
4. **Relayer:** submits signed reserve and acceptance payloads, holds its own tightly limited gas-funded key; cannot modify amounts or customer destination inside signatures.
5. **Event indexer:** reads finalised Arc events; maintains re-playable materialised views and reconciliation status; indexes by `(blockNumber, logIndex)`.
6. **PostgreSQL:** non-authoritative provider metadata, requests, settlement evidence and indexer checkpoints.
7. **Sample text service:** actual API endpoint. Recommended operation: produce three concise bullet summaries of user-provided text using a real model; fixed quoted 0.10 USDC request price. Use a configured model provider, explicit timeout and visible failures; do not silently replace output with scripted demo text.
8. **Health/failure control:** owner-only toggle for **the sample backend**. It simulates a backend outage for the judge demo and is clearly marked. It must never affect customer onchain credit balances or recovery routes.

### 9.3 Request orchestration

- User enters text. Client calculates and displays quote (fixed v1 price), creates request ID and hash of canonical request body.
- Client signs reservation authorisation. Relayer verifies payload and submits to Arc.
- Service executes **only after** `UsageReserved` is confirmed and exactly matches the customer, provider, request hash and price.
- Backend sends actual response and response hash to client. If service fails, display and attempt cooperative release if an explicitly safe method exists; otherwise instruct customer about expiration and release.
- Customer approves delivered response; signs acceptance with reservation ID and response hash.
- Relayer submits settlement. UI waits for confirmed `UsageSettled`, then updates financial balance.
- Any server crash between steps leaves a readable reservation onchain; expiry release and refund are available without the original request session.

### 9.4 Event indexing and reconciliation

Process each onchain event idempotently by `(transactionHash, logIndex)`. Persist checkpoints by **block number**, not timestamp, because Arc blocks can share timestamps. Support restart/backfill. Recompute projected balances from events and periodically compare them with direct `getAccount` reads. If discrepancy appears, show `Reconciling` rather than a made-up balance; never change contract state to force alignment with the database.

### 9.5 Wallet authentication

Public onchain reads need no login. For private request history and provider changes, use SIWE login with server-issued nonce, domain, chain ID, issued-at/expiration and single-use nonce. Sessions are scoped to verified address, not a client-supplied wallet string. Avoid storing private wallet keys anywhere on the server. The relayer signs only its own transactions and cannot create a customer authorisation.

---

## 10. API contract

All APIs are versioned under `/api/v1`. Prefer JSON Schema or Zod validation at boundaries. Monetary values are returned as decimal strings plus integer base units; never JavaScript floats for settlement.

| Route | Method | Purpose |
|---|---|---|
| `/providers` | GET | published provider metadata; contract fields cross-checked |
| `/providers/:id` | GET | sample service, price and payout configuration |
| `/auth/nonce` | POST | issue single-use SIWE nonce |
| `/auth/verify` | POST | validate signature and create session |
| `/usage/quote` | POST | canonicalise input, generate request hash, quote max price and expiry |
| `/usage/reservations` | POST | validate customer EIP-712 signature, submit reserve via relayer, return tx hash |
| `/usage/:requestId/execute` | POST | only execute if onchain reservation matches request, provider, amount and status |
| `/usage/:requestId/accept` | POST | verify customer acceptance signature, relay settlement, return tx hash |
| `/usage/:requestId` | GET | offchain service status and onchain reservation/settlement proofs |
| `/activity` | GET | indexed onchain events; filter by authenticated wallet/provider |
| `/provider/overview` | GET | read-only aggregates and revenue status |
| `/health` | GET | public service health, distinct from chain health |
| `/demo/outage` | POST | operator-only temporary service failure mode with explicit status disclosure |

**Example request quote response:**

```json
{
  "requestId": "req_01J...",
  "providerId": "1",
  "service": "textlab.summarise.v1",
  "maxAmountMicrounits": "100000",
  "displayAmountUsdc": "0.10",
  "requestHash": "0x...",
  "reservationDeadline": 1793388000,
  "payoutVersion": 1,
  "chainId": 5042,
  "contract": "0x..."
}
```

**Execute response:** `requestId`, `reservationId`, `output`, `responseHash`, `latencyMs`, `serviceModel`, `usageAmountMicrounits`, `deliveryStatus`. Private plaintext inputs and responses should be returned only to the authenticated customer, never emitted onchain or exposed in public proof pages without consent.

### API protections

- Require idempotency key on mutation routes; repeat requests return the same record/tx rather than spending twice.
- Verify signatures on server **and** contract; server checks alone are not financial authorisation.
- Rate-limit public and authenticated endpoints; cap request size, runtime and cost.
- Enforce per-user and global sample-model budgets; fail closed on budget exhaustion.
- Never silently call a paid model twice for the same verified reservation ID.
- Return explicit codes `INSUFFICIENT_AVAILABLE`, `RESERVATION_EXPIRED`, `INVALID_SIGNATURE`, `WRONG_CHAIN`, `PROVIDER_INACTIVE`, `MODEL_UNAVAILABLE`, `ALREADY_SETTLED`, `TX_REVERTED`, `RECONCILING`.

---

## 11. Data schema

Only illustrative fields are shown; create actual migrations and indexes during implementation.

**`providers`**: `provider_id` (onchain ID PK), `owner_address`, `payout_address_cached`, `payout_version`, `name`, `slug`, `description`, `service_endpoint_id`, `price_microunits`, `price_version`, `is_demo`, `created_at`, `updated_at`.

**`api_requests`**: `request_id` PK, `provider_id`, `customer_address`, `request_hash`, `quoted_microunits`, `reservation_id` nullable, `state`, `response_hash` nullable, `service_model` nullable, `duration_ms` nullable, `error_code` nullable, `created_at`, `updated_at`. Store sensitive input/output only if needed, encrypt with a defined retention period, and default to not persisting raw text.

**`chain_transactions`**: `(tx_hash, chain_id)` unique, `kind`, `status`, `from_address`, `to_address`, `provider_id`, `customer_address`, `request_id`, `amount_microunits`, `block_number`, `first_seen_at`, `confirmed_at`, `failure_code`.

**`indexed_events`**: `(tx_hash, log_index)` unique, `block_number`, `event_name`, `provider_id`, `customer_address`, `reservation_id`, `amount_microunits`, `raw_decoded_event`, `processed_at`.

**`indexer_checkpoint`**: `chain_id` PK, `last_final_block`, `updated_at`.

**`sessions`**: `session_id`, `wallet_address`, `expires_at`, `revoked_at`; single-use SIWE nonce stored separately with consumed timestamp.

**`service_runs`**: `request_id` unique, `reservation_id` unique, `model`, `started_at`, `finished_at`, `state`, `response_hash`, `error_code`, `provider_cost_estimate` (non-authoritative).

**`outage_demo_state`**: controlled by operator, expiry time, visible label and reason. Never join this table into financial refund permissions.

Reconciliation jobs compare chain-derived sums with contract direct reads; cached aggregates carry block number and stale status.

---

## 12. Error and recovery catalogue

| Failure | User sees | Money consequence | Recovery |
|---|---|---|---|
| Wallet rejected deposit | `Deposit cancelled` | No debit / no credits | Retry intentionally |
| Approval confirmed; deposit never sent | `Approved, not deposited` | No credits issued; allowance may remain | Deposit later or revoke allowance |
| USDC transfer reverts | `Deposit failed` | No credits issued | Inspect balance/gas/allowance |
| Backend fails after deposit | `Service unavailable; credits remain onchain` | Available credit remains | Read/refund via standalone recovery |
| Reserve tx fails | `Request not started` | Available unchanged | Retry with new nonce if required |
| API fails after reserve | `No output delivered; credits reserved` | Reserved, not paid | Release after expiry; show countdown |
| API succeeds, customer declines acceptance | `Not paid; reservation expires` | Provider nonpayment risk | Merchant receives no settlement; release on expiry |
| Relayer fails after acceptance | `Payment pending; not confirmed` | Reserved until tx confirms or expires | Retry same signed acceptance safely if still valid; no double settle |
| User refunds available during in-flight call | `Available only refunded` | Reserved unaffected | Release reserved once eligible |
| Customer tries refund twice | `Insufficient available credits` | First only | Refresh direct contract state |
| Provider changes payout wallet | `Existing authorisation invalid` where version differs | No wrong-wallet payout | Customer signs fresh reservation |
| Primary site entirely unavailable | Recovery static page / direct explorer contract | Funds still governed by contract | Use independent recovery route or verified contract call |
| RPC unavailable | `Cannot verify chain right now` | Unknown status, do not assume failure | Alternate RPC and direct contract read |
| Insufficient gas | `Add a small USDC gas balance` | Funds not moved | Fund wallet then retry |
| USDC address blocked by issuer/network | Explicit unavailable transaction error | Refund may be impossible | Do not imply bypass; follow issuer/network procedures |

---

## 13. Security, privacy and governance

### 13.1 Threat model

Potential attackers: malicious provider, malicious customer, compromised relayer, replay attacker, fake frontend, compromised API backend, user phishing, and buggy upgrade/deployment. The PRD protects **customer balances and authorisation boundaries**, not the subjective quality of offchain API work.

### 13.2 Required mitigations

- EIP-712 signatures bind chain, contract, customer, provider, payout configuration, amount, request and deadlines.
- Contract rejects reused nonces, expired authorisations and mismatched response hashes.
- Separate available/reserved/spent accounting; no double-credit or double-settlement.
- Customer alone approves post-delivery payment; provider cannot manufacture acceptance.
- No admin function can change customer balances or seize outstanding backed funds.
- `refund` and `releaseExpired` remain usable if sample API fails or merchant deactivates.
- Minimal transaction relayer privileges; rate limits and balance monitoring.
- Pinned Solidity compiler/dependencies; static analysis, fuzzing, invariant and differential tests.
- Reentrancy protection, checked signatures, safe token calls, exact decimals tests and payout-version validation.
- Sensitive plaintext API inputs/outputs are not sent to the blockchain; hash only; publicly display only authorised demonstration material.
- Public site clearly shows mainnet network, contract and transaction destination to help users detect wrong-network or phishing prompts.
- No audit assertion unless an independent audit occurred. Limit mainnet pilot use to small sums and obtain independent review before real customer funds at scale.

### 13.3 Important limitation

The signed acceptance protects against arbitrary provider settlement **only if the customer is trustworthy as an acknowledgement source**. A customer who receives a result may refuse to sign acceptance and reclaim reserved funds after expiry. UNSPENT's v1 customer-first model does not solve nonpayment disputes between adversarial merchants and customers. A production merchant model might require metered sessions, independently verifiable delivery, a trusted mediator, or other commercial safeguards; those approaches materially change the trust model.

### 13.4 Platform/compliance

Any live financial service must evaluate applicable regulation, consumer disclosures, and sanctions restrictions. This PRD is not a legal conclusion that the design is exempt. Contract and UI should be able to show clear terms and limitations; do not claim endorsement by Circle or Arc.

---

## 14. Test plan and acceptance matrix

### 14.1 Contract unit tests

1. Successful USDC deposit credits exact amount and increases liability.
2. Reverted transfer creates no credit.
3. Deposit to unregistered/inactive provider rejected, while existing refunds remain allowed.
4. Reserved amount moves from available to reserved without changing total liability.
5. Wrong customer, chain ID, contract address, nonce, deadline, request hash, payout version or amount rejects reservation.
6. Provider alone cannot settle usage.
7. Valid post-delivery acceptance settles exact signed amount once and transfers real USDC to bound provider payout wallet.
8. Settlement for less than reserved returns excess to available.
9. Settlement over cap, after expiry, or with mismatched response hash reverts.
10. Duplicate acceptance/settlement/release reverts.
11. Expired reserve releases exactly once, only after permitted time.
12. Refund only available, not reserved; refund cannot exceed balance.
13. Refund returns tokens to recorded customer, not an attacker-controlled address.
14. Concurrent reserve/refund ordering cannot overspend account.
15. Provider payout update invalidates wrong-version new reservations but cannot strand existing credited balances.
16. Pause/deactivation does not block refunds and expiry release.
17. Full account and global liability invariant holds across random action sequences.
18. Fuzz large and tiny amounts, rounding, mixed providers and many customers.
19. Test `approve` then rejected deposit and leftover allowance UX.
20. Confirm differences between Arc native 18-decimal gas display and 6-decimal ERC-20 accounting never cause erroneous amount conversions.

### 14.2 Integration tests

- User with 1.00 deposited → reserve 0.10 → service returns real output → user signs acceptance → provider receives 0.10 → user refunds 0.90. Report actual gas charged separately.
- Server crashes after chain deposit but before database record: account still shows exactly 1.00 on direct read.
- Server crashes after reservation: refund of available works; expired reservation can be released independently.
- Customer sees output but does not accept: settlement never occurs, and the provider risk is visible.
- Delayed/duplicate relayer submissions do not duplicate charges.
- Rebuild the read model from scratch using indexed chain events and compare direct contract views.
- Primary backend blocked intentionally; independent recovery site still reads state and executes refund transaction.
- Wrong network, wallet disconnect, rejected signature, low gas, and failing RPC paths display correct status.

### 14.3 Test case log

Record test ID, environment, wallet type, inputs, expected result, actual result, transaction hash where applicable, observed latency, failure reason and fix commit. Publish honest counts and at least one real miss if any were found. Controlled tests are not production reliability benchmarks.

### 14.4 Human acceptance walk-through

Give a developer unfamiliar with UNSPENT the live app. Without architectural explanation, they should be able to say what is refundable, make a test request, distinguish reservation from payment, locate the onchain transaction, and withdraw what remains. Perform a muted 20-second screen-recording test; if they cannot describe the causal chain, fix the UI.

---

## 15. Arc Studio implementation and deployment requirements

1. **Create the project inside Arc Studio** and keep its publicly shareable Studio project URL.
2. Ask Studio to generate the Solidity vault, provider registration, EIP-712 workflow, full frontend, backend integration, contract tests and wallet UI. Iterate on Studio's code and trace panels rather than supplying an externally built app as a nominal Studio wrapper.
3. Compile, inspect generated code, run test suite and Studio's initial contract reviews. Record at least three sponsor-behaviour runs: time to acknowledgment, visible result, confirmation and failure handling.
4. Deploy Studio-generated contracts to **Arc Testnet** through supported Studio tooling and run a complete scenario there.
5. **Arc Studio does not sign, fund or submit mainnet transactions on the developer's behalf.** Export code; independently deploy the tested, reviewed compiled contracts to mainnet using controlled keys and your own deployment tool. Preserve clear provenance from Studio-generated source to the deployed bytecode and documented commit.
6. Confirm chain ID 5042, actual mainnet RPC, USDC interface address, explorer and wallet gas balance **before** sending transactions. Do not reuse testnet config in production.
7. Use the deployed mainnet contract address in the live frontend and independent recovery bundle; verify the deployed source and ABI when possible.
8. Run the real deposit, settlement and refund path with tiny but nonzero real USDC; capture transaction hashes and event logs.
9. Push the Arc Studio project code to a public repository. Include tests, deployment instructions, contract addresses, a concise limitation note, actual proof links, and the Studio URL. Never commit private keys or model API secrets.
10. Provide a public app and video walkthrough showing Studio, contract tests, product flow and mainnet transactions.

**Arc Studio capability caution:** Its advertised one-click deploy is for supported **testnets**; mainnet signing and deployment remain the builder's own responsibility.

---

## 16. Evidence-led demonstration and film

### 16.1 Judge entry point

The public proof page must work without a wallet. The first visible message: `A payment should never disappear into a broken credit database.` Immediately beneath: `UNSPENT: backed API credits you can spend or reclaim.`

### 16.2 Reproducible demonstration script

1. Show the public incident report with date, reported amount and clear attribution to its reporter.
2. Open live UNSPENT app and select TextLab.
3. Connect funded wallet and deposit **1.00 real USDC** on Arc Mainnet; wait for explorer-confirmed `CreditsDeposited`.
4. Enter an actual paragraph and buy a **0.10 USDC** TextLab request. Show reservation onchain before calling service.
5. Show a genuinely generated response; sign acceptance and show confirmed `UsageSettled`, with 0.10 paid to provider.
6. Account now shows 0.90 Available, 0.00 Reserved, 0.10 Spent.
7. Flip the clearly labelled **sample-backend outage toggle**. Show main application billing data unavailable, not a staged third-party outage.
8. Open the independent recovery site, connect the same wallet, read the 0.90 balance directly from Arc.
9. Refund **0.90 real USDC**; show `CreditsRefunded`, explorer link and zero outstanding account credit. Wallet gas is separate.
10. Close with contract link, Studio project, GitHub, explicit limitations and live product URL.

### 16.3 Film structure (approximately 2:20–2:40)

- 0:00–0:16 person and real reported failure.
- 0:16–0:30 problem with two disconnected financial records.
- 0:30–0:40 UNSPENT promise and first product view.
- 0:40–1:08 Arc Studio generation, tests and contract evidence.
- 1:08–1:40 real USDC deposit + service usage + provider settlement.
- 1:40–2:12 controlled outage + independently verified recovery/refund.
- 2:12–2:30 direct explorer evidence, what Arc enables and limitations.
- 2:30–2:40 real call to action + project/repo/Studio links.

Use clear labels during transaction waits. No misleading edits that imply pending funds are settled. Record from a frozen, working build and publish the film alongside a complete submission.

---

## 17. Delivery sequence and definition of done

### Build tranche A — financial truth

**Deliverables:** Studio project, provider registry, deposit, account read, refund, contract events and tests. **Exit gate:** testnet customer can deposit and refund a real testnet asset; account remains correct when backend is unavailable.

### Build tranche B — paid service loop

**Deliverables:** quote, reserve signature, relayer, actual sample API, acceptance signature, settlement, expiry release, full lifecycle tests. **Exit gate:** a customer-authorised request can pay a provider exactly once; failure, timeout and denied acceptance cannot steal customer funds.

### Build tranche C — complete app and recovery

**Deliverables:** landing, wallet/account, deposit wizard, Use API, Activity, independent Recover app, provider panel and proof page. **Exit gate:** all visible judge paths verified in a real browser, including mobile views and every error state the judge can trigger.

### Build tranche D — mainnet and proof

**Deliverables:** independent mainnet deployment, verified source/ABI, funded wallet, actual deposit/settle/refund receipts, static recovery deployment, repository and Studio link. **Exit gate:** financial balances reconcile to real mainnet logs and recovery succeeds with backend disabled.

### Build tranche E — submit

**Deliverables:** recorded film, concise README, live app, public repo, official submission form, wallet for any microgrant payout, builder profile, limitations. **Exit gate:** every submission field has a working URL, and the video shows what the product actually does.

### Final release gates — all mandatory

- [ ] Arc Studio project contains real generated and revised contract + app work.
- [ ] All required contract tests pass; manual inspection complete; critical invariant suite passes.
- [ ] Correct Arc mainnet contract, token address, chain ID and RPC verified.
- [ ] Confirmed deposit, settlement and refund transactions on mainnet with public hashes.
- [ ] Actual API call completed and charged only with customer acceptance.
- [ ] Provider cannot unilaterally collect or move another customer's unspent balance.
- [ ] Backend-independent recovery route demonstrably works.
- [ ] Honest caveats about service delivery and merchant nonpayment visible.
- [ ] Wallet, wrong-network, insufficient-gas, approval, nonce, expiry, timeout and RPC failure UX checked.
- [ ] Public website, source, Studio link, addresses, transactions and film all function.
- [ ] No invented results, pre-rendered proof disguised as live, or unaudited safety claims.
- [ ] Demo funds and relayer privileges remain intentionally limited.

---

## 18. Open decisions, risks, and honest claims

| Decision / risk | Build-time position | Evidence needed |
|---|---|---|
| Adoption of delayed provider settlement | High commercial risk | At least three merchant interviews; not yet validated |
| Customer post-delivery acceptance can be withheld | Explicit v1 trade-off | Demo and docs must explain it; merchant feedback |
| Multi-provider expansion | Contract supports independent provider IDs | Validate accounting with two providers and two customers |
| Smart-contract wallet support | Support only after EIP-1271 tests | Tested wallet list and signature compatibility |
| AI model availability | External dependency, not financial authority | Real request logs, timeout/error route |
| Contract safety | No audit by default | Independent audit before funds at scale |
| Arc Studio project provenance | Mandatory competition requirement | Studio URL, source history, tests, exported repo |
| Core failure scenario | Real incident inspires product; local outage intentionally simulated | Show real incident sources and label local fault injection |

**Claims we can make after execution:**

- “Each successful deposit creates credits in the same smart-contract transaction.”
- “Usage settlement is bounded by customer signatures.”
- “Available unspent USDC can be refunded independently of the provider's application backend, provided the chain, token and wallet permit transfers.”
- “The demo shows real Arc Mainnet USDC movement with public transaction hashes.”

**Claims we cannot make:** “All API failures are automatically refunded”, “The contract proves the service was delivered”, “No provider can ever lose money”, “Audited”, “Zero risk”, or “Every API provider would adopt this.”

---

## 19. Arc Studio build instruction to paste with this PRD

> Build **UNSPENT** from this PRD **inside Arc Studio**. Do not start by producing a landing-page mockup. First generate, compile, review and test `UnspentVault` with provider-scoped USDC deposits, available/reserved/spent accounting, EIP-712 bounded reservation signatures, customer-signed result acceptance and provider settlement, expiry release, and unconditional refunds of available credits to the customer wallet. Use Arc's native USDC via its ERC-20 interface (6 decimals; `0x3600000000000000000000000000000000000000`) and chain-aware configuration. Build the real React/Next.js app, actual sample text API, relayer, indexed transaction history, provider dashboard, and an **independently deployable static recovery application** that does not depend on the normal backend. Wire every UI state to real contract transactions and responses; show pending, reverted, expired, reserved, paid and refunded states precisely. Generate tests for financial invariants, signature replay, expired authorisations, provider payout updates, reentrancy, concurrent refunds, insufficient USDC/gas and backend-outage recovery. Run a complete end-to-end flow on Arc Testnet using Arc Studio; then export code for independently controlled mainnet deployment. Keep all keys server-side or in user wallets. Publish real transaction links, Studio project URL, source repo and explicitly labelled demo failure evidence. Do not silently mock the financial loop or let a merchant withdraw unapproved customer balances.

---

## 20. References and implementation documentation

- Arc Studio: https://studio.arc.io/
- Arc Studio official description and mainnet signing boundary: https://www.arc.io/blog/introducing-arc-studio-the-onchain-coding-agent
- Arc network/RPC/chain ID: https://docs.arc.io/arc/references/connect-to-arc
- Arc USDC address and decimal model: https://docs.arc.io/arc/references/contract-addresses
- Arc event indexing and block ordering: https://docs.arc.io/integrate/infrastructure/indexing-events
- Arc security and audit caveat: https://www.arc.io/security
- Arc Studio example full-stack workflow: https://www.arc.io/blog/build-a-usdc-revenue-splitting-app-with-arc-studio-no-code-required
- Original reported failure, issue #408: https://github.com/Conway-Research/automaton/issues/408
- Related reported failure, issue #237: https://github.com/Conway-Research/automaton/issues/237
- Hackathon submission requirements and rubric: user-provided Arc Microgrants page, 30 October 2026.

**Document owner:** UNSPENT product team. **Ready to start:** contract and end-to-end implementation in Arc Studio, subject to the mainnet safety gates above.
