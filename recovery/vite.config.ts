import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";


// Stamp the build with the git commit the host built from (Vercel sets VERCEL_GIT_COMMIT_SHA), so a deployment
// can be checked against a pushed SHA: <meta name="unspent-build"> in the HTML and BUILD_COMMIT in the bundle.
const BUILD_COMMIT = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RENDER_GIT_COMMIT ?? "dev";
const stampBuild = () => ({
  name: "stamp-build",
  transformIndexHtml: (html: string) => html.replace("</head>", `  <meta name="unspent-build" content="${BUILD_COMMIT}" />\n  </head>`),
});

// base "./" keeps the bundle relocatable: host it at a domain root, a sub-path, IPFS, or open dist/index.html behind any static server.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "./" : "/recovery-client/",
  define: { __BUILD_COMMIT__: JSON.stringify(BUILD_COMMIT) },
  plugins: [react(), tailwindcss(), stampBuild()],
  server: { host: "0.0.0.0", port: 5174, allowedHosts: true, fs: { allow: [".."] } },
  build: { sourcemap: false },
}));
