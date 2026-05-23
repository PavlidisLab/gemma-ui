import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Resolution order for the upstream Gemma server:
//   1. ``GEMMA_BASE_URL`` env (set in `apps/browser/.env.local` or
//      exported in the shell)
//   2. fallback: staging Gemma 1.x — always up but slow + cached
//
// Local Gemma 2.0 listens on ``:8080`` (per Paul 2026-05-23; this
// supersedes the earlier note that local 2.0 was on ``:9080`` — the
// curation mock was retired from :8080 in the gemma-curation-agents
// `local_api` rename pass). Set ``GEMMA_BASE_URL=http://localhost:8080``
// in ``.env.local`` to point this app at it.
export default defineConfig(({ mode }) => {
  // loadEnv: read .env / .env.local / .env.<mode> + .env.<mode>.local.
  // Third arg "" disables the default VITE_ prefix filter so we can
  // surface plain ``GEMMA_BASE_URL`` (the historical name).
  const env = loadEnv(mode, process.cwd(), "");
  const GEMMA_TARGET =
    env.GEMMA_BASE_URL || "https://staging-gemma.msl.ubc.ca";
  return {
    plugins: [react()],
    resolve: {
      alias: { "@": path.resolve(__dirname, "src") },
    },
    // Expose the resolved upstream URL to the client so a footer
    // chip can surface "which Gemma am I talking to". The /rest
    // proxy hides this from the runtime client otherwise.
    define: {
      __GEMMA_TARGET__: JSON.stringify(GEMMA_TARGET),
    },
    server: {
      // 5183 to leave 5173 to the curation app (default Vite port) so
      // both can run in parallel without the auto-bump dance.
      port: 5183,
      proxy: {
        "/rest": {
          target: GEMMA_TARGET,
          changeOrigin: true,
          // secure: false when targeting a local http:// server
          secure: !GEMMA_TARGET.startsWith("http://"),
          configure: (proxy) => {
            // One-shot log so a curator can confirm which upstream the
            // dev server is fronting without grepping vite.config.
            // eslint-disable-next-line no-console
            console.log(`[browser] /rest → ${GEMMA_TARGET}`);
            proxy.on("error", (err) => {
              // eslint-disable-next-line no-console
              console.error(`[browser] proxy error: ${err.message}`);
            });
          },
        },
      },
    },
  };
});
