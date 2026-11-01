import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "@/lib/api";

export interface ProviderMeta {
  providerId: string;
  name: string;
  service: string;
  description: string;
  priceMicrounits: string;
  displayPriceUsdc: string;
  isDemo: boolean;
  verifiedByUnspent: boolean;
}

/** Display metadata comes from the sample API. It is NOT financial authority; payout config is read onchain. */
export function useProviderMeta() {
  return useQuery({
    queryKey: ["provider-meta"],
    retry: 0,
    refetchInterval: 30_000,
    queryFn: async (): Promise<ProviderMeta> => {
      const res = await fetch(apiUrl("/api/v1/providers"), { cache: "no-store", signal: AbortSignal.timeout(6000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()).providers[0] as ProviderMeta;
    },
  });
}
