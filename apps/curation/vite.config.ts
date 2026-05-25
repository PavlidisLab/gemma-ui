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
// Local-mode UI rule (2026-05-25): in local mode the SVD
// diagnostics + real Gemma audit-event history surfaces are
// hidden client-side (useGemmaMode() gate) so the gemma-rest
// fallback never gets exercised — proxy entries below stay
// intact for remote / mixed modes.
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
  // Explicit local_api upstream — same target as CURATION_URL by
  // default (local_api IS the curation default), but exposed at a
  // distinct path prefix `/local-api` so hooks can hit it when a
  // gemma-rest routing exception would otherwise win. Used today
  // by the audit-trail fallback: gemma-rest first, local_api on
  // 404 (for ids that exist in the curation DB but aren't loaded
  // into Gemma yet).
  const LOCAL_API_URL =
    env.GEMMA_LOCAL_API_URL || CURATION_URL;
  // Static bearer that local_api accepts. The browser sends the
  // user's gemma-rest token from localStorage (set on /rest/v2/login,
  // which we route to gemma-rest like the browser app does). That
  // gemma token doesn't authenticate against local_api, so we inject
  // local_api's dev bearer in the proxy for any route that targets
  // local_api. Override via GEMMA_CURATION_API_KEY at compose time.
  const LOCAL_API_BEARER =
    env.GEMMA_CURATION_API_KEY || "dev-token-123";
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
   
  console.log(`[curation] /rest → ${CURATION_URL} (local_api default)`);
   
  console.log(
    `[curation] /rest/v2/datasets/*/{svd,sample-correlation,mean-variance} → ${GEMMA_REST_URL} (diagnostics fallback)`,
  );
   
  console.log(
    `[curation] /rest/v2/annotations/{search,term} → ${ONTOLOGY_URL} (ontology routing exception)`,
  );
   
  console.log(`[curation] /local-api → ${LOCAL_API_URL} (explicit local_api passthrough)`);
   
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
        // Auth endpoints → gemma-rest. Match the browser app's
        // convention so a single sign-in works across both apps and
        // private datasets (e.g. permissioned audit trails)
        // authenticate against the real Gemma session. The bearer
        // token returned by /login is stored in localStorage by the
        // curation client and rides on every subsequent request.
        "^/rest/v2/(login|logout|me)$": {
          target: GEMMA_REST_URL,
          changeOrigin: true,
          cookieDomainRewrite: "",
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.removeHeader("origin");
              proxyReq.removeHeader("referer");
            });
          },
        },
        // Diagnostics fallback to gemma-rest — local_api doesn't
        // compute SVD / sample-correlation / mean-variance.
        // Regex matches /rest/v2/datasets/{id}/{svd,sample-
        // correlation,mean-variance}[/loadings|?...].
        "^/rest/v2/datasets/\\d+/(svd|sample-correlation|mean-variance).*": {
          target: GEMMA_REST_URL,
          changeOrigin: true,
          // Strip the Domain attribute on any Set-Cookie reply so
          // gemma-rest's session cookies survive the proxy — they're
          // otherwise scoped to host.docker.internal and the browser
          // refuses to store them under localhost:5175.
          cookieDomainRewrite: "",
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
        // gemma-rest. Route the GET here; the hook falls back to
        // /local-api/... on 404 for ids that haven't been loaded
        // into Gemma yet (see useAuditEvents).
        "^/rest/v2/datasets/\\d+/auditEvents.*": {
          target: GEMMA_REST_URL,
          changeOrigin: true,
          cookieDomainRewrite: "",
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.removeHeader("origin");
              proxyReq.removeHeader("referer");
            });
          },
        },
        // Explicit local_api passthrough — strips the `/local-api`
        // prefix so the upstream sees the bare `/rest/v2/...` path.
        // Used by hooks that need to bypass a gemma-rest routing
        // exception (e.g. audit-trail fallback for ids only in the
        // curation DB). Same Authorization override as the catch-all
        // /rest route since this also targets local_api.
        "/local-api": {
          target: LOCAL_API_URL,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/local-api/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.setHeader(
                "Authorization",
                `Bearer ${LOCAL_API_BEARER}`,
              );
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
          //
          // Override the Authorization header with local_api's dev
          // bearer — the browser sends the user's gemma-rest token
          // from localStorage, which local_api doesn't recognize.
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.removeHeader("origin");
              proxyReq.removeHeader("referer");
              proxyReq.setHeader(
                "Authorization",
                `Bearer ${LOCAL_API_BEARER}`,
              );
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
        // Health probes — cheap liveness checks, one per upstream
        // the UI talks to. Gemma's openapi is at
        // `/rest/v2/openapi.json` (the spec is versioned, not
        // root-level). local_api + proposer are FastAPI which
        // auto-exposes `/openapi.json` at root.
        //
        //   /__health/local-api → local_api  (curation DB, default upstream)
        //   /__health/gemma     → gemma-rest (live data fallback)
        //   /__health/agent     → proposer   (FastAPI agent)
        "/__health/local-api": {
          target: CURATION_URL,
          changeOrigin: true,
          rewrite: () => "/openapi.json",
        },
        "/__health/gemma": {
          target: GEMMA_REST_URL,
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
