import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import "./index.css";
import { wagmiConfig } from "@/lib/wagmi";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { installShareSync } from "@/lib/share";
import App from "./App";

installShareSync();
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } });

function ThemedToaster() {
  const { resolved } = useTheme();
  return <Toaster theme={resolved} position="bottom-right" />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
          <ThemedToaster />
        </QueryClientProvider>
      </WagmiProvider>
    </ThemeProvider>
  </StrictMode>,
);
