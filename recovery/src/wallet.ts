import { useCallback, useEffect, useState } from "react";
import { createWalletClient, custom, type Address, type Chain, type EIP1193Provider } from "viem";

export interface Discovered { uuid: string; name: string; icon: string; rdns: string; provider: EIP1193Provider }

/** EIP-6963 wallet discovery, no libraries. */
export function useWallets(): Discovered[] {
  const [list, setList] = useState<Discovered[]>([]);
  useEffect(() => {
    const onAnnounce = (e: Event) => {
      const d = (e as CustomEvent).detail as { info: Omit<Discovered, "provider">; provider: EIP1193Provider };
      setList((prev) => (prev.some((p) => p.uuid === d.info.uuid) ? prev : [...prev, { ...d.info, provider: d.provider }]));
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => window.removeEventListener("eip6963:announceProvider", onAnnounce);
  }, []);
  return list;
}

export interface Session { wallet: Discovered; address: Address; chainId: number }

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async (wallet: Discovered) => {
    setError(null);
    try {
      const accounts = (await wallet.provider.request({ method: "eth_requestAccounts" })) as Address[];
      const chainId = Number(await wallet.provider.request({ method: "eth_chainId" }));
      if (!accounts[0]) throw new Error("No account returned");
      setSession({ wallet, address: accounts[0], chainId });
    } catch (e) {
      const err = e as { code?: number; message?: string };
      setError(err.code === 4001 ? "Connection rejected in your wallet. Nothing was connected." : "Could not connect. Unlock your wallet and try again.");
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    const p = session.wallet.provider;
    const onAccounts = (a: unknown) => { const acc = (a as Address[])[0]; setSession((s) => (acc && s ? { ...s, address: acc } : null)); };
    const onChain = (c: unknown) => setSession((s) => (s ? { ...s, chainId: Number(c) } : s));
    p.on("accountsChanged", onAccounts);
    p.on("chainChanged", onChain);
    return () => { p.removeListener("accountsChanged", onAccounts); p.removeListener("chainChanged", onChain); };
  }, [session?.wallet.uuid]); // eslint-disable-line react-hooks/exhaustive-deps

  const disconnect = useCallback(() => setSession(null), []);

  const switchTo = useCallback(async (chain: Chain) => {
    if (!session) return;
    const hex = `0x${chain.id.toString(16)}`;
    try {
      await session.wallet.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    } catch (e) {
      if ((e as { code?: number }).code === 4902 || (e as { code?: number }).code === -32603) {
        await session.wallet.provider.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: hex, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: chain.rpcUrls.default.http, blockExplorerUrls: [chain.blockExplorers!.default.url] }],
        });
      } else throw e;
    }
  }, [session]);

  const walletClient = useCallback((chain: Chain) => (session ? createWalletClient({ account: session.address, chain, transport: custom(session.wallet.provider) }) : null), [session]);
  return { session, connect, disconnect, switchTo, walletClient, error };
}
