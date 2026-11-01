import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { arcChain, rpcTransport } from "@/lib/chains";

// EIP-6963 discovery is on by default, so every installed browser wallet appears as its own connector.
export const wagmiConfig = createConfig({
  chains: [arcChain],
  connectors: [injected()],
  transports: { [arcChain.id]: rpcTransport() },
  multiInjectedProviderDiscovery: true,
  ssr: false,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
