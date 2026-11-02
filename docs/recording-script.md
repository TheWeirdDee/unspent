# UNSPENT submission video — 180 seconds

All transaction footage reviews the completed 1 Nov 2026 run. Never request signatures or initiate transactions. Record the deployed app; do not recreate its interface. Studio footage must show the authenticated project and genuine history, not just Git author names.

## 0:00–0:18 — Problem
Show the landing page, then enter the app.
“You prepaid for an API. Its billing backend goes down. Can you still get your unused money back? UNSPENT keeps prepaid USDC credits in an Arc smart contract, so your refund does not depend on the provider’s database.”

## 0:18–0:45 — Arc Studio
Show the project name, real contract/test work, build conversation and preview. Requires the owner's authenticated session.
“Here is the UNSPENT project in Arc Studio. Studio built UnspentVault, its contract tests, the application and the API integration. The contract records deposits, reservations, settlements and refunds. Later reliability fixes and mainnet deployment preparation happened outside Studio. The owner signed the mainnet transactions; Studio did not sign or deploy them.”

## 0:45–1:05 — Application
Show the actual deposit and API screens without clicking transaction controls.
“Approval permits an exact transfer; deposit moves USDC and creates credits in one transaction. Available credits are refundable. A customer’s signed authorization reserves a bounded amount: here, ten cents per request. The provider is paid only when the customer accepts the response.”

## 1:05–1:55 — Completed mainnet journey
Persistent label: Reviewing the completed mainnet run · 1 Nov 2026.
Show deposit, reserve, recorded response, settlement and refund receipts. Hold network, success, amounts and destinations legibly. Verify the response hash against the settlement. If original output footage is unavailable, show the public documentation labelled Recorded response from completed run.
“We are reviewing the completed November first mainnet run, not making new transactions. Twenty cents entered the vault. The customer authorized a ten-cent reservation, and the API returned this recorded Gemini response. These lines come from the documented run. Their matching hash binds this text to the customer’s acceptance; it does not independently certify Google’s authorship. Acceptance settled ten cents to the provider’s payout wallet. The remaining ten cents was refunded to the customer. The provider wallet belongs to the same owner. This is one small demonstration with real USDC.”

## 1:55–2:25 — Independent recovery
Open the actual recovery client on mainnet. Read customer 0xE306b8ae6e958F7C8e3401f1f12d550E5DAecab6, provider 1. Require live figures: Available 0; Reserved 0; Spent 0.10; Refunded 0.10.
“This recovery client lives on a separate host. It reads the vault through RPC, optionally through its own read-only relay, without the primary API, database or relayer. The live account shows zero available, zero reserved, ten cents spent and ten cents refunded. The actual API-suspension recovery test was on testnet. No mainnet outage test has been performed.”

## 2:25–2:45 — Evidence and limitations
Show /proof, mainnet first, then the public repository.
“The proof page checks existing receipts against the chain, and the source is public. This is an experimental, unaudited contract. MetaMask’s domain warning remains unresolved. A customer can decline acceptance, creating nonpayment risk for the provider.”

## 2:45–3:00 — Close
Return to the live product. Keep app and repository links legible.
“UNSPENT makes prepaid credits verifiable and unused balances recoverable. The next step is a security review and a reusable integration for other API providers. Explore the app and public repository at the links on screen.”

## Export and verification
Exactly 180 seconds; 1920×1080; H.264/AAC; readable burned-in captions; narration. No upload. Target C:\Users\DELL\Desktop\UNSPENT-Demo-3min.mp4. Verify with ffprobe and watch the complete export. Disclose if audio was not auditioned. Do not claim completion while authenticated Studio footage is missing.
