import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Curation app dev-server proxy.
//
// Resolution order for each upstream target:
//   1. ``apps/curation/.env.local`` (gitignored) — preferred
//   2. shell-exported env var of the same name
//   3. hardcoded default
//
// 2026-05-23: curation interface migrating to talk to local Gemma
// 2.0 (`:8080`) directly. local_api stays available for offline /
// portable-review-package workflows; default port for it shifted
// to `:8082` to dodge the Gemma 2.0 collision, set
// ``GEMMA_CURATION_URL=http://localhost:8082`` in
// ``apps/curation/.env.local`` when flipping back.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const CURATION_URL =
    env.GEMMA_CURATION_URL || "http://localhost:8080";
  const PROPOSER_URL =
    env.GEMMA_PROPOSER_URL || "http://localhost:8090";
  // eslint-disable-next-line no-console
  console.log(`[curation] /rest → ${CURATION_URL}`);
  // eslint-disable-next-line no-console
  console.log(`[curation] /propose,/audit,/find-* → ${PROPOSER_URL}`);
  return {
    plugins: [react()],
    resolve: {
      alias: { "@": path.resolve(__dirname, "src") },
    },
    server: {
      port: 5173,
      proxy: {
        "/rest": {
          target: CURATION_URL,
          changeOrigin: true,
        },
        // Proposer service (FastAPI) — long-running, so timeouts
        // are disabled.
        "/propose": {
          target: PROPOSER_URL,
          changeOrigin: true,
          timeout: 0,
          proxyTimeout: 0,
        },
        "/find-publication": {
          target: PROPOSER_URL,
          changeOrigin: true,
        },
        "/find-term": {
          target: PROPOSER_URL,
          changeOrigin: true,
        },
        "/audit": {
          target: PROPOSER_URL,
          changeOrigin: true,
          timeout: 0,
          proxyTimeout: 0,
        },
      },
    },
  };
});
