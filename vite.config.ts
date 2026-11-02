import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";


// Stamp the build with the git commit the host built from (Vercel sets VERCEL_GIT_COMMIT_SHA), so a deployment
// can be checked against a pushed SHA: <meta name="unspent-build"> in the HTML and BUILD_COMMIT in the bundle.
const BUILD_COMMIT = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RENDER_GIT_COMMIT ?? "dev";
const stampBuild = () => ({
  name: "stamp-build",
  transformIndexHtml: (html: string) => html.replace("</head>", `  <meta name="unspent-build" content="${BUILD_COMMIT}" />\n  </head>`),
});

export default defineConfig({
  define: { __BUILD_COMMIT__: JSON.stringify(BUILD_COMMIT) },
  plugins: [react(), tailwindcss(), stampBuild()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: true,
    // Keep server-only files (runtime data with request metadata, API source, ops scripts) off the dev server's static surface.
    fs: { deny: ["**/.env*", "**/data/**", "**/server/**", "**/scripts/**", "**/*.pem", "**/.git/**"] },
    proxy: {
      // The preview only exposes this port, so the browser reaches the billing API through here.
      "/api": { target: "http://localhost:3001", changeOrigin: true },
      // Same-origin RPC reads, mirroring the vercel.json rewrites so local dev matches the deployment. Without this the
      // app's first-choice transport (/rpc/<network>) 404s locally and every read pays a failed attempt before fallback.
      "/rpc/mainnet": { target: "https://rpc.mainnet.arc.io", changeOrigin: true, rewrite: () => "/" },
      "/rpc/testnet": { target: "https://rpc.testnet.arc.io", changeOrigin: true, rewrite: () => "/" },
      // Independent recovery client (separately built static bundle) mounted for the Studio preview only.
      "/recovery-client": { target: "http://localhost:5174", changeOrigin: true },
    },
  },
});
