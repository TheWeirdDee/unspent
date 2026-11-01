import { useState } from "react";
import { useWalletReady, PROVIDER_ID, type AccountState } from "@/hooks/useVault";
import { useTx } from "@/hooks/useTx";
import { unspentVaultAbi } from "@/contracts/abi";
import { VAULT, addressUrl, dep } from "@/lib/chains";
import { formatUsdc, parseUsdc } from "@/lib/money";
import { TxStatus } from "@/components/ui";

/** Refund of AVAILABLE credits only. The destination is always the connected wallet (enforced by the contract). */
export function WithdrawPanel({ account, onDone }: { account: AccountState; onDone?: () => void }) {
  const { ready, address } = useWalletReady();
  const { state, run, reset, busy } = useTx();
  const [text, setText] = useState(formatUsdc(account.available, 2));
  const parsed = parseUsdc(text);
  const invalid = parsed === null || parsed <= 0n ? "Enter an amount greater than 0 with up to 6 decimals." : parsed > account.available ? "More than your available credits." : null;
  const remaining = parsed !== null && parsed <= account.available ? account.available - parsed : account.available;
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="wd-amount" className="label">Amount to withdraw (USDC)</label>
        <div className="mt-1.5 flex gap-2">
          <input id="wd-amount" className="input" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} aria-invalid={Boolean(invalid)} aria-describedby="wd-help" />
          <button className="btn btn-secondary" type="button" onClick={() => setText(formatUsdc(account.available, 2))}>Max</button>
        </div>
        <p id="wd-help" className={`mt-1.5 text-xs ${invalid ? "text-bad" : "text-faint"}`}>{invalid ?? `Refundable now: ${formatUsdc(account.available)} USDC. Reserved and spent credits are excluded.`}</p>
      </div>
      <dl className="space-y-1.5 rounded-xl bg-surface2 p-3.5 text-sm">
        <div className="flex justify-between gap-4"><dt className="text-muted">Destination</dt><dd className="mono truncate">{address}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-muted">Contract</dt><dd><a className="link mono" href={addressUrl(VAULT ?? "")} target="_blank" rel="noopener noreferrer">{VAULT?.slice(0, 10)}…</a></dd></div>
        <div className="flex justify-between gap-4"><dt className="text-muted">Available after</dt><dd className="money">{formatUsdc(remaining)} USDC</dd></div>
      </dl>
      <p className="text-xs text-faint">Irreversible once confirmed. Gas is paid separately in USDC from your wallet, on {dep.name}.</p>
      <button
        className="btn btn-primary w-full"
        disabled={!ready || busy || Boolean(invalid) || PROVIDER_ID === undefined}
        onClick={async () => { const r = await run({ address: VAULT!, abi: unspentVaultAbi, functionName: "refund", args: [PROVIDER_ID!, parsed!] }); if (r) onDone?.(); }}
      >
        {busy ? "Withdrawing…" : "Confirm refund"}
      </button>
      {!ready ? <p className="text-xs text-faint">Connect your wallet on {dep.name} to withdraw.</p> : null}
      <TxStatus state={state} onReset={reset} confirmedText="Your USDC was transferred back to your wallet." />
    </div>
  );
}
