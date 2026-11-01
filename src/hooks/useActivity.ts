import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { fetchVaultActivity, withTimestamps } from "@/lib/activity";
import { arcChain, VAULT } from "@/lib/chains";

/** All vault events, read from RPC. Pass a customer to filter client-side. */
export function useActivity(customer?: Address) {
  return useQuery({
    queryKey: ["activity", arcChain.id, VAULT, customer?.toLowerCase() ?? "all"],
    enabled: Boolean(VAULT),
    refetchInterval: 15_000,
    queryFn: async () => {
      const { events, head, fromBlock } = await fetchVaultActivity();
      const mine = customer ? events.filter((e) => e.customer.toLowerCase() === customer.toLowerCase()) : events;
      return { events: await withTimestamps(mine), head, fromBlock };
    },
  });
}
