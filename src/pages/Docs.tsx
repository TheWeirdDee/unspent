import { Link } from "react-router-dom";
import { dep, VAULT } from "@/lib/chains";
import { Notice } from "@/components/ui";

const TOC = [
  ["overview", "Overview"], ["credits", "What credits are"], ["deposit", "Deposit"], ["using", "Using the API"], ["signatures", "Signatures"],
  ["expiry", "Deadlines and expiry"], ["refunds", "Refunds"], ["recovery", "Recovery"], ["providers", "For providers"], ["trust", "Trust assumptions"], ["privacy", "Privacy"], ["limits", "Limitations"],
];

const Code = ({ children, label }: { children: string; label: string }) => (
  <pre aria-label={label} className="card overflow-x-auto p-4 text-[0.8125rem] leading-relaxed"><code className="mono">{children}</code></pre>
);
const H = ({ id, children }: { id: string; children: string }) => <h2 id={id} className="mt-14 scroll-mt-24 border-t border-line pt-8 text-2xl font-semibold first:mt-0 first:border-0 first:pt-0">{children}</h2>;
const P = ({ children }: { children: React.ReactNode }) => <p className="mt-3 max-w-prose leading-relaxed text-muted">{children}</p>;

export default function Docs() {
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[13rem_1fr]">
      <nav aria-label="Documentation" className="lg:sticky lg:top-24 lg:self-start">
        <p className="label mb-2">On this page</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm lg:block lg:space-y-1">
          {TOC.map(([id, t]) => <li key={id}><a className="text-muted hover:text-fg" href={`#${id}`}>{t}</a></li>)}
        </ul>
      </nav>
      <article className="min-w-0">
        <h1 className="text-3xl font-semibold sm:text-4xl">Documentation</h1>
        <div className="mt-6"><Notice tone="warn" title="Demonstration software">The UnspentVault contract has not been independently audited. Use small amounts. Network in this build: {dep.name} (chain {dep.chainId}).</Notice></div>

        <div className="mt-10">
          <H id="overview">Overview</H>
          <P>UNSPENT is a prepaid payment system for APIs. You deposit USDC into a smart contract, and the same transaction creates your credits. You spend credits per request with signatures you control, and you can withdraw anything unspent.</P>
          <P>Contract: <span className="mono break-all">{VAULT ?? "not deployed on this network"}</span>. Ledger values are integer micro-USDC (6 decimals). 0.10 USDC is 100000.</P>

          <H id="credits">What credits are</H>
          <P>Credits are an accounting entry inside the vault, not a token. One credit equals one USDC held by the contract. Every account is scoped to one customer and one provider, so credits for one provider can never be spent with another.</P>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted">
            <li><strong className="text-fg">Available</strong>: unreserved. Refundable now.</li>
            <li><strong className="text-fg">Reserved</strong>: locked for one in-flight request. Not refundable until settled or released.</li>
            <li><strong className="text-fg">Spent</strong>: paid to the provider after you accepted a response. Not refundable.</li>
          </ul>
          <P>Invariant per account: available + reserved + spent + refunded = total deposited. Contract-wide, the USDC the vault holds is at least everything owed to customers.</P>
          <Notice tone="info" title="Arc units">On Arc, USDC is also the native gas token. Gas uses 18 decimals; the ERC-20 interface used by this app and contract uses 6. They are one asset seen two ways, never two balances. This app only ever shows the 6-decimal ERC-20 view.</Notice>

          <H id="deposit">Deposit</H>
          <P>Two separate wallet transactions: <span className="mono">approve</span> lets the vault pull the exact amount, then <span className="mono">deposit(providerId, amount)</span> pulls it and creates credits atomically. An approval alone creates nothing; if you approve and stop, the allowance stays and you can revoke it in your wallet. A reverted transfer creates no credits.</P>

          <H id="using">Using the API</H>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-muted">
            <li>You enter text. The app asks the sample API for a quote: price, request hash, deadlines.</li>
            <li>The app checks the quote against the contract (price, payout wallet, chain), then asks you to sign a bounded <em>ReserveAuthorisation</em>.</li>
            <li>A relayer submits it. The contract moves 0.10 from Available to Reserved. The service runs only after the contract shows that reservation.</li>
            <li>You read the real response. If you are happy, you sign a <em>DeliveryAcceptance</em> for its hash and the amount, and the relayer settles it. The provider is paid; any unused remainder returns to Available.</li>
          </ol>
          <P>Nothing is ever settled because a server said &ldquo;200&rdquo;. A response you do not accept is not paid.</P>

          <H id="signatures">Signatures</H>
          <P>Both messages are EIP-712 typed data. The domain binds the chain and the vault address, so a signature cannot be replayed elsewhere. Only EOA (ECDSA) signatures are supported.</P>
          <Code label="EIP-712 types">{`domain: { name: "UnspentVault", version: "1", chainId, verifyingContract }

ReserveAuthorisation(
  address customer, uint256 providerId, address payoutWallet, uint32 payoutVersion,
  bytes32 requestHash, uint256 maxAmount, uint256 nonce, uint256 authDeadline, uint256 expiry)

DeliveryAcceptance(
  address customer, uint256 reservationId, bytes32 responseHash,
  uint256 amount, uint256 nonce, uint256 deadline)`}</Code>
          <P>The payout wallet and its version are part of what you sign. If a provider changes its payout wallet, your old authorisation stops working, and a reservation you already made still pays the wallet it was bound to.</P>

          <H id="expiry">Deadlines and expiry</H>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted">
            <li><strong className="text-fg">authDeadline</strong>: the latest time a signed reservation may be submitted. Submitting at the deadline works; one second later reverts.</li>
            <li><strong className="text-fg">expiry</strong>: when the reservation ends. It must be later than authDeadline and at most one day after submission. Both values are signed by you.</li>
            <li>Settlement requires <span className="mono">block.timestamp &lt; expiry</span>. Release requires <span className="mono">block.timestamp &gt;= expiry</span>. They never overlap, so a reservation is settled or released, never both.</li>
          </ul>
          <P>These boundaries are tested at one second before, at, and one second after each deadline.</P>

          <H id="refunds">Refunds</H>
          <P><span className="mono">refund(providerId, amount)</span> sends available credits to the calling wallet. It cannot send anywhere else, cannot touch reserved or spent amounts, and keeps working even if the provider is deactivated.</P>

          <H id="recovery">Recovery</H>
          <P>The <Link className="link" to="/recover">recovery client</Link> is a static bundle containing the ABI, contract address and network config. It reads accounts and reservations over RPC, refunds available credits and releases expired reservations. Host it anywhere (any static host, IPFS, your own machine). Build it with <span className="mono">bun run recovery:build</span>. It makes no request to the UNSPENT API.</P>
          <Code label="Read your balance without any app">{`cast call ${VAULT ?? "<VAULT>"} \\
  "getAccount(uint256,address)(uint256,uint256,uint256,uint256,uint256)" \\
  ${"<PROVIDER_ID>"} ${"<YOUR_ADDRESS>"} --rpc-url ${dep.rpcUrls[0]}

cast send ${VAULT ?? "<VAULT>"} "refund(uint256,uint256)" <PROVIDER_ID> <MICRO_USDC> \\
  --rpc-url ${dep.rpcUrls[0]} --account <your keystore>`}</Code>

          <H id="providers">For providers</H>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-muted">
            <li>Register: <span className="mono">registerProvider(payoutWallet, metadataHash)</span> from your owner wallet. Keep the returned provider ID.</li>
            <li>Publish your service and a fixed price per call. The price is enforced by your server, and customers sign a hard maximum.</li>
            <li>Run a relayer that submits customer signatures. It needs gas only and cannot alter signed amounts or destinations.</li>
            <li>Execute the service only after you read the reservation from the contract and it matches the customer, provider, request hash and amount.</li>
            <li>Return the response and its hash. Submit the customer&rsquo;s acceptance signature. You are paid exactly the signed amount.</li>
          </ol>
          <Code label="Provider settlement example (TypeScript, viem)">{`import { keccak256, toHex } from "viem";

const r = await publicClient.readContract({
  address: VAULT, abi: unspentVaultAbi,
  functionName: "getReservation", args: [reservationId],
});
if (r.status !== 1 || r.customer !== customer || r.maxAmount !== price) throw new Error("not a valid open reservation");
if (BigInt(Math.floor(Date.now() / 1000)) + 60n >= r.expiry) throw new Error("too close to expiry");

const output = await runYourService(input);          // your real service
const responseHash = keccak256(toHex(output));       // the customer signs THIS hash

// ...customer signs DeliveryAcceptance(customer, reservationId, responseHash, price, nonce, deadline)
await relayer.writeContract({
  address: VAULT, abi: unspentVaultAbi,
  functionName: "acceptAndSettle", args: [acceptance, signature],
});`}</Code>
          <Notice tone="info" title="Commercial trade-off">A customer can decline to sign acceptance after receiving a response, and then the reservation expires back to them. This version is customer-first by design. Mitigate it with small per-call prices and pricing in the risk.</Notice>

          <H id="trust">Trust assumptions</H>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted">
            <li><strong className="text-fg">Contract</strong>: immutable, no owner, no pause, no upgrade, no rescue function. Unaudited.</li>
            <li><strong className="text-fg">USDC</strong>: you trust Circle&rsquo;s token and network. If transfers to your address are blocked, a refund cannot succeed.</li>
            <li><strong className="text-fg">Relayer</strong>: can delay a transaction but cannot change a signed amount, destination or deadline. You can submit directly instead.</li>
            <li><strong className="text-fg">Provider</strong>: can refuse service. The contract does not judge service quality.</li>
            <li><strong className="text-fg">Frontend</strong>: a fake site could ask for bad signatures. Check the network, contract and amounts in your wallet prompt; the recovery client lets you verify independently.</li>
            <li><strong className="text-fg">Time</strong>: deadlines use block timestamps, which on Arc can be shared by several blocks.</li>
          </ul>

          <H id="privacy">Privacy</H>
          <P>Your prompts and responses are never written onchain; only 32-byte hashes are. The sample API receives your text after your reservation confirms, sends it to a language-model provider to produce the summary, and does not store the raw input or output (a short-lived in-memory copy lets you reload the result). Wallet addresses, amounts and hashes are public by nature of the blockchain. The app stores your theme and wallet preference in your browser.</P>

          <H id="limits">Limitations</H>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted">
            <li>No audit. Not for large amounts.</li>
            <li>Credits already paid to a provider are not refundable.</li>
            <li>EOA wallets only. No gas sponsorship; you need a little USDC for gas.</li>
            <li>The sample provider is a demonstration, not a verified merchant.</li>
          </ul>
        </div>
      </article>
    </div>
  );
}
