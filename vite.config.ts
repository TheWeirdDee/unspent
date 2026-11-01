import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: true,
    proxy: {
      // The preview only exposes this port, so the browser reaches the billing API through here.
      "/api": { target: "http://localhost:3001", changeOrigin: true },
      // Independent recovery client (separately built static bundle) mounted for the Studio preview only.
      "/recovery-client": { target: "http://localhost:5174", changeOrigin: true },
    },
  },
});
