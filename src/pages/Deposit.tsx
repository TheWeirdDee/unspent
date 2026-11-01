import { useState } from "react";
import { Link } from "react-router-dom";
import { erc20Abi } from "viem";
import { useAccountState, useAllowance, useProviderOnchain, useUsdcBalance, useWalletReady, PROVIDER_ID } from "@/hooks/useVault";
import { useProviderMeta } from "@/hooks/useProviderMeta";
import { useTx } from "@/hooks/useTx";
import { unspentVaultAbi } from "@/contracts/abi";
import { USDC, VAULT, addressUrl, dep, shortAddr } from "@/lib/chains";
import { formatUsdc, parseUsdc } from "@/lib/money";
import { Notice, TxStatus, Pill } from "@/components/ui";
import { WalletButton } from "@/components/WalletButton";
import { BalanceCard } from "@/components/BalanceCard";

const PRESETS = ["1", "5", "10"];

export default function Deposit() {
  const { address, isConnected, ready } = useWalletReady();
  const bal = useUsdcBalance(address);
  const allowance = useAllowance(address);
  const acct = useAccountState(address);
  const prov = useProviderOnchain();
  const meta = useProviderMeta();
  const [text, setText] = useState("1");
  const approve = useTx();
  const deposit = useTx();
  const amount = parseUsdc(text);

  if (!VAULT || PROVIDER_ID === undefined) return <Notice tone="warn" title={`Not deployed on ${dep.name}`}>No vault or provider is configured for this network.</Notice>;
  if (!isConnected) return (
    <div className="mx-auto max-w-lg py-10 text-center"><h1 className="text-3xl font-semibold">Buy credits</h1><p className="mt-3 text-muted">Connect a wallet holding USDC on {dep.name}.</p><div className="mt-6 flex justify-center"><WalletButton /></div></div>
  );

  const vault = VAULT;
  const walletUsdc = bal.data;
  const allow = allowance.data;
  const invalid =
    amount === null || amount <= 0n ? "Enter an amount greater than 0 with up to 6 decimals."
    : walletUsdc !== undefined && amount > walletUsdc ? `Your wallet holds ${formatUsdc(walletUsdc)} USDC.`
    : null;
  const needsApproval = amount !== null && amount > 0n && allow !== undefined && allow < amount;
  const allowanceKnown = allow !== undefined;
  const approvedNotDeposited = allowanceKnown && amount !== null && allow >= amount && approve.state.phase === "confirmed" && deposit.state.phase === "idle";
  const p = prov.data;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-3xl font-semibold">Buy credits</h1>
        <p className="mt-1 text-sm text-muted">Two separate wallet transactions: approve the amount, then deposit. Approval alone buys nothing.</p>
      </header>

      <section className="card p-5" aria-labelledby="s1">
        <h2 id="s1" className="label">1. Provider</h2>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">{meta.data?.name ?? "Provider 1"} {meta.data?.isDemo ? <Pill tone="info">Built-in sample</Pill> : null} {meta.data && !meta.data.verifiedByUnspent ? <Pill tone="warn">Not verified by UNSPENT</Pill> : null}</p>
            <p className="text-sm text-muted">{meta.data ? `${meta.data.description} ${meta.data.displayPriceUsdc} USDC per request.` : meta.isError ? "Name and price come from the sample API, which is unreachable. The payout details below are read from the contract." : "Loading…"}</p>
          </div>
          {p ? <p className="text-xs text-faint">Payout wallet <a className="link mono" href={addressUrl(p.payoutWallet)} target="_blank" rel="noopener noreferrer">{shortAddr(p.payoutWallet)}</a> · v{p.payoutVersion}</p> : null}
        </div>
        {p && !p.active ? <div className="mt-3"><Notice tone="warn" title="Provider is not accepting deposits">Existing credits can still be refunded.</Notice></div> : null}
      </section>

      <section className="card p-5" aria-labelledby="s2">
        <h2 id="s2" className="label">2. Amount</h2>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Preset amounts">
          {PRESETS.map((x) => <button key={x} type="button" className={`btn btn-sm ${text === x ? "btn-primary" : "btn-secondary"}`} aria-pressed={text === x} onClick={() => setText(x)}>{x} USDC</button>)}
        </div>
        <label htmlFor="dep-amount" className="sr-only">Deposit amount in USDC</label>
        <input id="dep-amount" className="input mt-3 text-lg" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} aria-invalid={Boolean(invalid)} aria-describedby="dep-help" />
        <p id="dep-help" className={`mt-1.5 text-xs ${invalid ? "text-bad" : "text-faint"}`}>
          {invalid ?? `Wallet balance: ${walletUsdc !== undefined ? formatUsdc(walletUsdc) : "…"} USDC. Gas is paid separately in USDC; keep a little spare.`}
        </p>
        {walletUsdc === 0n ? <p className="mt-2 text-sm text-muted">{dep.chainId === 5042 ? "No USDC in this wallet. This is Arc mainnet: you need real USDC on Arc, and USDC held on another network must be bridged to Arc first." : <>No USDC in this wallet. On {dep.name}, use the <strong>Get test USDC</strong> button in the Arc Studio sidebar.</>}</p> : null}
      </section>

      <section className="card p-5" aria-labelledby="s3">
        <h2 id="s3" className="label">3. Review and confirm</h2>
        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-muted">You deposit</dt><dd className="money font-medium">{amount !== null ? formatUsdc(amount) : "—"} USDC</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted">Refundable before any use</dt><dd className="money">{amount !== null ? formatUsdc(amount) : "—"} USDC</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted">Network</dt><dd>{dep.name} (chain {dep.chainId})</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted">USDC token (6 decimals)</dt><dd><a className="link mono" href={addressUrl(USDC)} target="_blank" rel="noopener noreferrer">{shortAddr(USDC)}</a></dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted">Vault contract</dt><dd><a className="link mono" href={addressUrl(vault)} target="_blank" rel="noopener noreferrer">{shortAddr(vault)}</a></dd></div>
        </dl>
        <p className="mt-3 text-xs text-faint">The vault is unaudited. You can withdraw available credits at any time; credits already paid to the provider are not refundable.</p>

        <div className="mt-5 space-y-3">
          {needsApproval || approve.state.phase !== "idle" ? (
            <>
              <button className="btn btn-primary w-full" disabled={!ready || approve.busy || Boolean(invalid) || !needsApproval}
                onClick={() => approve.run({ address: USDC, abi: erc20Abi, functionName: "approve", args: [vault, amount!] })}>
                {approve.busy ? "Approving…" : needsApproval ? `Step 1 of 2: Approve ${amount !== null ? formatUsdc(amount) : ""} USDC` : "Step 1 of 2: Approved"}
              </button>
              <TxStatus state={approve.state} onReset={approve.reset} confirmedText="Approved. No credits exist yet: now make the deposit." />
            </>
          ) : null}
          <button className="btn btn-primary w-full" disabled={!ready || deposit.busy || Boolean(invalid) || needsApproval || !allowanceKnown}
            onClick={() => deposit.run({ address: vault, abi: unspentVaultAbi, functionName: "deposit", args: [PROVIDER_ID, amount!] })}>
            {deposit.busy ? "Depositing…" : needsApproval ? "Step 2 of 2: Deposit (approve first)" : `${approve.state.phase !== "idle" ? "Step 2 of 2: " : ""}Deposit ${amount !== null ? formatUsdc(amount) : ""} USDC`}
          </button>
          {!ready ? <p className="text-xs text-faint">Connect on {dep.name} to continue.</p> : null}
          {!allowanceKnown && ready ? <p className="text-xs text-faint">Reading your USDC allowance…</p> : null}
          {approvedNotDeposited ? <Notice tone="warn" title="Approved, not deposited">Your approval is on chain but no credits have been created. Press Deposit to continue, or revoke the allowance in your wallet.</Notice> : null}
          <TxStatus state={deposit.state} onReset={deposit.reset} confirmedText="Your credits were created in the same transaction. The balance below is read from the contract." />
        </div>
      </section>

      {deposit.state.phase === "confirmed" ? (
        <section className="space-y-4" aria-label="Result">
          <BalanceCard q={acct} />
          <Link to="/app/use" className="btn btn-primary">Try the API</Link>
        </section>
      ) : null}
    </div>
  );
}
