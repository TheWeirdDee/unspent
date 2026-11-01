import { useQuery } from "@tanstack/react-query";
import { erc20Abi, type Address } from "viem";
import { useAccount, useSwitchChain } from "wagmi";
import { unspentVaultAbi } from "@/contracts/abi";
import { arcChain, publicClient, USDC, VAULT, dep } from "@/lib/chains";

export const PROVIDER_ID: bigint | undefined = dep.providerId ? BigInt(dep.providerId) : undefined;

export interface AccountState {
  available: bigint;
  reserved: bigint;
  totalDeposited: bigint;
  totalSettled: bigint;
  totalRefunded: bigint;
}

/** Wallet + network readiness shared by every transacting screen. */
export function useWalletReady() {
  const { address, isConnected, isConnecting, isReconnecting, chainId, connector } = useAccount();
  const { switchChainAsync, isPending: switching, error: switchError } = useSwitchChain();
  const wrongNetwork = isConnected && chainId !== arcChain.id;
  return {
    address: address as Address | undefined,
    isConnected,
    isConnecting: isConnecting || isReconnecting,
    wrongNetwork,
    ready: isConnected && !wrongNetwork,
    connectorName: connector?.name,
    switchToArc: () => switchChainAsync({ chainId: arcChain.id }),
    switching,
    switchError,
  };
}

/** Direct contract read. Never a cache of the backend: this is the authoritative balance. */
export function useAccountState(address: Address | undefined, providerId: bigint | undefined = PROVIDER_ID) {
  return useQuery({
    queryKey: ["account", arcChain.id, VAULT, providerId?.toString(), address],
    enabled: Boolean(address && VAULT && providerId !== undefined),
    refetchInterval: 8_000,
    queryFn: async (): Promise<AccountState & { block: bigint }> => {
      const block = await publicClient.getBlockNumber();
      const [available, reserved, totalDeposited, totalSettled, totalRefunded] = await publicClient.readContract({
        address: VAULT!,
        abi: unspentVaultAbi,
        functionName: "getAccount",
        args: [providerId!, address!],
        blockNumber: block,
      });
      return { available, reserved, totalDeposited, totalSettled, totalRefunded, block };
    },
  });
}

export function useUsdcBalance(address: Address | undefined) {
  return useQuery({
    queryKey: ["usdc-balance", arcChain.id, address],
    enabled: Boolean(address),
    refetchInterval: 10_000,
    queryFn: () => publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [address!] }),
  });
}

export function useAllowance(address: Address | undefined) {
  return useQuery({
    queryKey: ["usdc-allowance", arcChain.id, address, VAULT],
    enabled: Boolean(address && VAULT),
    refetchInterval: 10_000,
    queryFn: () => publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [address!, VAULT!] }),
  });
}

export function useSolvency() {
  return useQuery({
    queryKey: ["solvency", arcChain.id, VAULT],
    enabled: Boolean(VAULT),
    refetchInterval: 15_000,
    queryFn: async () => {
      const [tokenBalance, liability] = await publicClient.readContract({ address: VAULT!, abi: unspentVaultAbi, functionName: "solvency" });
      return { tokenBalance, liability, block: await publicClient.getBlockNumber() };
    },
  });
}

export function useProviderOnchain(providerId: bigint | undefined = PROVIDER_ID) {
  return useQuery({
    queryKey: ["provider", arcChain.id, VAULT, providerId?.toString()],
    enabled: Boolean(VAULT && providerId !== undefined),
    refetchInterval: 20_000,
    queryFn: async () => {
      const [p, outstanding] = await Promise.all([
        publicClient.readContract({ address: VAULT!, abi: unspentVaultAbi, functionName: "getProvider", args: [providerId!] }),
        publicClient.readContract({ address: VAULT!, abi: unspentVaultAbi, functionName: "providerOutstanding", args: [providerId!] }),
      ]);
      return { ...p, outstanding };
    },
  });
}
