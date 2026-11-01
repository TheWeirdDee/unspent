import { useQuery } from "@tanstack/react-query";

export interface Health {
  ok: boolean;
  network: string;
  relayerConfigured: boolean;
  modelConfigured: boolean;
  outage: { active: boolean; label: string; until: number | null; reason: string | null };
}
export type BackendStatus =
  | { kind: "loading" }
  | { kind: "online"; health: Health }
  | { kind: "simulated-outage"; health: Health }
  | { kind: "unreachable" };

export function useBackendStatus(): BackendStatus & { updatedAt: number } {
  const q = useQuery({
    queryKey: ["backend-health"],
    refetchInterval: 8_000,
    retry: 0,
    queryFn: async (): Promise<Health> => {
      const res = await fetch("/api/v1/health", { cache: "no-store", signal: AbortSignal.timeout(6000) });
      if (!res.ok && res.status !== 503) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as Health;
    },
  });
  if (q.isPending) return { kind: "loading", updatedAt: 0 };
  if (q.isError || !q.data) return { kind: "unreachable", updatedAt: q.dataUpdatedAt };
  if (q.data.outage?.active) return { kind: "simulated-outage", health: q.data, updatedAt: q.dataUpdatedAt };
  return { kind: "online", health: q.data, updatedAt: q.dataUpdatedAt };
}
