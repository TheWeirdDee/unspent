import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// base "./" keeps the bundle relocatable: host it at a domain root, a sub-path, IPFS, or open dist/index.html behind any static server.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "./" : "/recovery-client/",
  plugins: [react(), tailwindcss()],
  server: { host: "0.0.0.0", port: 5174, allowedHosts: true, fs: { allow: [".."] } },
  build: { sourcemap: false },
}));
