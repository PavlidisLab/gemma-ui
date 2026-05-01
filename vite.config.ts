import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    port: 5173,
    proxy: {
      // Proxy curation API calls to the mock server (or real Gemma
      // later). ``GEMMA_CURATION_URL`` is read here (Node-side) at
      // dev-server startup; the browser-side equivalent is
      // ``VITE_GEMMA_CURATION_URL`` and is inlined into the bundle.
      // They can be set together when pointing at a non-default
      // backend.
      "/rest": {
        target: process.env.GEMMA_CURATION_URL || "http://localhost:8080",
        changeOrigin: true,
      },
      // Proxy proposer-service calls. The service is its own
      // FastAPI process (`gca proposer-service serve`, default
      // port 8090). In Phase 2's central deploy, nginx routes
      // both /rest/* and /propose/* to the right backend behind
      // one hostname; in dev we proxy each to its local port.
      // Long-running endpoint — ``timeout: 0`` so a 30-90s
      // pipeline run doesn't trip Vite's default proxy timeout.
      "/propose": {
        target: process.env.GEMMA_PROPOSER_URL || "http://localhost:8090",
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
      // Same proposer service hosts the publication-finder agent
      // (`POST /find-publication/{accession}`). Short-lived call (1-2s),
      // but lives behind the same FastAPI process so we proxy it here
      // alongside /propose.
      "/find-publication": {
        target: process.env.GEMMA_PROPOSER_URL || "http://localhost:8090",
        changeOrigin: true,
      },
      // Same proposer service also hosts the find-term agent
      // (`POST /find-term`) — resolves a free-text label + category
      // to ontology URI candidates. See
      // gemma-curation-agents/FIND-TERM-HANDOFF.md.
      "/find-term": {
        target: process.env.GEMMA_PROPOSER_URL || "http://localhost:8090",
        changeOrigin: true,
      },
      // Same proposer service hosts the audit pipeline (my brother's
      // Steps 4 + 6 — see AUDIT_FEATURE.md): synchronous
      // `POST /audit/{accession}` and the SSE variant
      // `POST /audit/{accession}/stream`. Long-running like /propose
      // (LLM round-trip per judge), so timeouts are disabled to match.
      "/audit": {
        target: process.env.GEMMA_PROPOSER_URL || "http://localhost:8090",
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
});
