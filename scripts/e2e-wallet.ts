// Test-only browser wallet: an EIP-1193/EIP-6963 provider whose signing is done by a TESTNET key in this sandbox.
// It signs and broadcasts real transactions on Arc Testnet; it mocks nothing about the chain or the app.
import type { Page } from "playwright-core";
import { createWalletClient, http, type Hex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chain, net, pub, env } from "./lib";

export async function installTestWallet(page: Page, keyName = "TESTNET_CUSTOMER_KEY", opts: { reject?: boolean } = {}) {
  const account = privateKeyToAccount(env[keyName] as Hex);
  const wc = createWalletClient({ account, chain, transport: http(net.rpcUrls[0]) });
  const log: string[] = [];
  let chainId = chain.id;
  let connected = false;
  await page.exposeFunction("__walletRequest", async (method: string, params: unknown[]) => {
    log.push(method);
    switch (method) {
      case "eth_requestAccounts":
        if (opts.reject) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
        connected = true;
        return [account.address];
      case "eth_accounts":
        return connected ? [account.address] : [];
      case "eth_chainId": return `0x${chainId.toString(16)}`;
      case "wallet_switchEthereumChain": chainId = chain.id; return null;
      case "eth_signTypedData_v4": {
        const td = JSON.parse((params as string[])[1]);
        const { EIP712Domain: _d, ...types } = td.types;
        return account.signTypedData({ domain: td.domain, types, primaryType: td.primaryType, message: td.message });
      }
      case "personal_sign": return account.signMessage({ message: { raw: (params as Hex[])[0] } });
      case "eth_sendTransaction": {
        const t = (params as Record<string, string>[])[0];
        return wc.sendTransaction({ to: t.to as Address, data: t.data as Hex, value: t.value ? BigInt(t.value) : undefined, gas: t.gas ? BigInt(t.gas) : undefined });
      }
      default: return pub.request({ method: method as never, params: params as never });
    }
  });
  await page.addInitScript(({ address }) => {
    const listeners: Record<string, ((a: unknown) => void)[]> = {};
    const provider = {
      request: async ({ method, params }: { method: string; params?: unknown[] }) => (window as unknown as { __walletRequest: (m: string, p: unknown[]) => Promise<unknown> }).__walletRequest(method, params ?? []),
      on: (e: string, f: (a: unknown) => void) => { (listeners[e] ??= []).push(f); },
      removeListener: (e: string, f: (a: unknown) => void) => { listeners[e] = (listeners[e] ?? []).filter((x) => x !== f); },
    };
    const info = { uuid: "e2e-test-wallet-0001", name: "E2E Test Wallet", icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiI+PHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSIjMzNjIi8+PC9zdmc+", rdns: "test.e2e.wallet" };
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
    void address;
  }, { address: account.address });
  return { account, log };
}
