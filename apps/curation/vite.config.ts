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
// 2026-05-24: routing rule (per Paul) — DEFAULT to local_api;
// fall through to gemma-rest 2.0 only for endpoints local_api
// doesn't carry. Dataset metadata, preboarding, curation state,
// workflow management (groups / candidates / pipeline-status) all
// live in local_api. gemma-rest is the fallback for the SVD-based
// diagnostics (svd, sample-correlation, mean-variance,
// svd/loadings) — and for the ontology typeahead via the
// staging-gemma routing exception (separate upstream).
//
// Standalone-dev defaults: local_api listens on :8082, gemma-rest
// on :8080. In Docker the host-mapped names come from compose env
// (GEMMA_CURATION_URL → local-api:8000, GEMMA_REST_URL →
// host.docker.internal:8080).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const CURATION_URL =
    env.GEMMA_CURATION_URL || "http://localhost:8082";
  const GEMMA_REST_URL =
    env.GEMMA_REST_URL || "http://localhost:8080";
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
  // eslint-disable-next-line no-console
  console.log(`[curation] /rest → ${CURATION_URL} (local_api default)`);
  // eslint-disable-next-line no-console
  console.log(
    `[curation] /rest/v2/datasets/*/{svd,sample-correlation,mean-variance} → ${GEMMA_REST_URL} (diagnostics fallback)`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `[curation] /rest/v2/annotations/{search,term} → ${ONTOLOGY_URL} (ontology routing exception)`,
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
        // ontology + diagnostics routing exceptions must come BEFORE
        // the generic ``/rest`` catch-all below.
        "/rest/v2/annotations/search": {
          target: ONTOLOGY_URL,
          changeOrigin: true,
        },
        "/rest/v2/annotations/term": {
          target: ONTOLOGY_URL,
          changeOrigin: true,
        },
        // Diagnostics fallback to gemma-rest — local_api doesn't
        // compute SVD / sample-correlation / mean-variance.
        // Regex matches /rest/v2/datasets/{id}/{svd,sample-
        // correlation,mean-variance}[/loadings|?...].
        "^/rest/v2/datasets/\\d+/(svd|sample-correlation|mean-variance).*": {
          target: GEMMA_REST_URL,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.removeHeader("origin");
              proxyReq.removeHeader("referer");
            });
          },
        },
        // Audit trail (live Gemma history) — local_api has its own
        // mock trail for the curation-side events the UI itself
        // generates, but the long-term experiment history lives in
        // gemma-rest. Route the GET here; the eventual merge of
        // both sources lives in the hook (see useAuditEvents).
        "^/rest/v2/datasets/\\d+/auditEvents.*": {
          target: GEMMA_REST_URL,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.removeHeader("origin");
              proxyReq.removeHeader("referer");
            });
          },
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
        // Health probes — cheap liveness checks.
        // Gemma's openapi is at `/rest/v2/openapi.json` (the spec
        // is versioned, not root-level), so the curation upstream
        // probe rewrites to that path. Proposer (FastAPI) auto-
        // exposes `/openapi.json` at root.
        "/__health/gemma": {
          target: CURATION_URL,
          changeOrigin: true,
          rewrite: () => "/rest/v2/openapi.json",
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
