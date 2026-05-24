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
  // Ontology-search routing exception (temporary, 2026-05-23).
  // ``/rest/v2/annotations/search`` + ``/rest/v2/annotations/term``
  // hit Gemma's ontology indexes. The local Gemma 2.0 stack
  // doesn't carry the full OBO / EFO / MONDO / UBERON / CL / CHEBI
  // corpora in memory, so the typeahead comes back near-empty
  // against it. Until local ontology coverage matches staging,
  // route these two paths to ``GEMMA_ONTOLOGY_URL`` (default
  // staging-gemma); everything else stays on ``CURATION_URL``.
  // Drop this exception when local-stack ontology coverage lands
  // — see ``lib/gemmaMode.ts`` for the matching UI indicator.
  const ONTOLOGY_URL =
    env.GEMMA_ONTOLOGY_URL || "https://staging-gemma.msl.ubc.ca";
  // Diagnostics routing exception. /sample-correlation,
  // /mean-variance, /svd, /svd/loadings are read-only Gemma
  // endpoints that the local_api mock doesn't implement (it
  // targets the curator's write surface, not Gemma's preprocessing
  // output). Route them to a real Gemma so the Diagnostics tab
  // populates in dev. Default `host.docker.internal:8080` works in
  // the Mac/Win Docker dev stack; native dev should set
  // GEMMA_DIAGNOSTICS_URL=http://localhost:8080 in .env.local.
  // Drop the exception when local_api grows the diagnostics surface.
  const DIAGNOSTICS_URL =
    env.GEMMA_DIAGNOSTICS_URL || "http://host.docker.internal:8080";
  // eslint-disable-next-line no-console
  console.log(`[curation] /rest → ${CURATION_URL}`);
  // eslint-disable-next-line no-console
  console.log(
    `[curation] /rest/v2/annotations/{search,term} → ${ONTOLOGY_URL} (ontology routing exception)`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `[curation] /rest/v2/datasets/*/{sample-correlation,mean-variance,svd,svd/loadings} → ${DIAGNOSTICS_URL} (diagnostics routing exception)`,
  );
  // eslint-disable-next-line no-console
  console.log(`[curation] /propose,/audit,/find-* → ${PROPOSER_URL}`);
  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
        "@gemma/heatmap": path.resolve(__dirname, "../../packages/heatmap/src"),
        "@gemma/ontology": path.resolve(__dirname, "../../packages/ontology/src"),
      },
    },
    server: {
      port: 5173,
      proxy: {
        // Order matters — Vite matches in declaration order, so the
        // ontology + diagnostics overrides must come BEFORE the
        // generic ``/rest`` catch-all below.

        // Diagnostics routing exception — see DIAGNOSTICS_URL above.
        // Uses Vite's regex-prefix match: any `/rest/v2/datasets/{any
        // id}/{sample-correlation|mean-variance|svd|svd/loadings}`
        // hits the real Gemma instead of the local_api mock.
        "^/rest/v2/datasets/[^/]+/(sample-correlation|mean-variance|svd(/loadings)?)(\\?.*)?$":
          {
            target: DIAGNOSTICS_URL,
            changeOrigin: true,
            secure: !DIAGNOSTICS_URL.startsWith("http://"),
            configure: (proxy) => {
              proxy.on("proxyReq", (proxyReq) => {
                proxyReq.removeHeader("origin");
                proxyReq.removeHeader("referer");
              });
            },
          },

        "/rest/v2/annotations/search": {
          target: ONTOLOGY_URL,
          changeOrigin: true,
        },
        "/rest/v2/annotations/term": {
          target: ONTOLOGY_URL,
          changeOrigin: true,
        },
        "/rest": {
          target: CURATION_URL,
          changeOrigin: true,
          // Strip Origin + Referer so Tomcat's CORS filter doesn't
          // 403 the request. Verified by curl: any Origin header
          // (even the server's own host) triggers "Invalid CORS
          // request"; no Origin → 401/200 normally. See
          // ~/Dev/eclipseworkspace/Gemma/handoffs/HANDOFF_CORS_DEV_ORIGIN.md.
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.removeHeader("origin");
              proxyReq.removeHeader("referer");
            });
          },
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
        // Health probes — rewrite to /openapi.json on each upstream
        // so we don't need bro to ship a /health route. FastAPI
        // auto-exposes /openapi.json; the local_api mock-gemma's
        // docker healthcheck already pings it.
        "/__health/gemma": {
          target: CURATION_URL,
          changeOrigin: true,
          rewrite: () => "/openapi.json",
        },
        "/__health/agent": {
          target: PROPOSER_URL,
          changeOrigin: true,
          rewrite: () => "/openapi.json",
        },
      },
    },
  };
});
