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
// Routing rule — DEFAULT to local_api; fall through to gemma-rest 2.0
// only for endpoints local_api doesn't carry. Dataset metadata,
// preboarding, curation state, workflow management (groups /
// candidates / pipeline-status) all live in local_api. gemma-rest is
// the fallback for the SVD-based diagnostics (svd, sample-correlation,
// mean-variance, svd/loadings) — and for the ontology typeahead via
// the ontology routing exception (separate upstream, see
// GEMMA_ONTOLOGY_URL below).
//
// Local-mode UI rule: in local mode the SVD diagnostics + real Gemma
// audit-event history surfaces are hidden client-side (useGemmaMode()
// gate) so the gemma-rest fallback never gets exercised — proxy
// entries below stay intact for remote / mixed modes.
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
  // 🛑 In REMOTE mode the curation UI is a pure Gemma client — it does
  // not use the local store at all (Paul, 2026-08-27: "does the
  // curation UI still use the store? NO"). So `/rest` targets Gemma and
  // the request carries the CURATOR's own credentials.
  //
  // This reads the same flag the app reads (`lib/gemmaMode.ts`) rather
  // than a second proxy-only switch, so the proxy and the client can
  // never disagree about which backend they are talking to.
  //
  // ⚠️ `GEMMA_CURATION_UI_BACKEND` stays a LOCAL-mode knob. In remote
  // mode `/rest` is Gemma unconditionally; there is no store to point
  // at, so an override there would only produce a half-configured
  // client that authenticates one way and reads another.
  const REMOTE_MODE = env.VITE_GEMMA_MODE === "remote";
  const REST_TARGET = REMOTE_MODE ? GEMMA_REST_URL : CURATION_URL;
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
  // Read-only Gemma REST source for the study-preview spike. Points at
  // a host sidecar (curation-agents-eval scripts/gemma_ro_proxy.py) that
  // injects basic auth from the macOS keychain in memory — no creds in
  // this config or the container. Sidecar proxies GET /datasets/* only.
  const GEMMA_RO_PROXY =
    env.GEMMA_RO_PROXY_URL || "http://host.docker.internal:8199";
  // Ontology-search routing exception. ``/rest/v2/annotations/search``
  // + ``/rest/v2/annotations/term`` + ``/rest/v2/annotations/children``
  // + ``/rest/v2/annotations/relations``
  // + ``/rest/v2/genes``
  // hit Gemma's ontology indexes; a local_api stack may not carry the
  // full OBO / EFO / MONDO / UBERON / CL / CHEBI corpora in memory, so
  // the typeahead can come back near-empty against it. Route these
  // paths to ``GEMMA_ONTOLOGY_URL`` — an ontology-capable Gemma host
  // you provide — instead of ``CURATION_URL``. No built-in default:
  // point it at your own Gemma instance. Drop this exception once
  // local-stack ontology coverage is complete — see ``lib/gemmaMode.ts``.
  const ONTOLOGY_URL = env.GEMMA_ONTOLOGY_URL || "";
  if (!ONTOLOGY_URL) {
    console.warn(
      "[curation] GEMMA_ONTOLOGY_URL not set — ontology term search (annotations/search, /term, /children, /relations) and gene lookup (/genes) will not work until you set it to your own Gemma ontology host in .env.local",
    );
  }

  console.log(
    REMOTE_MODE
      ? `[curation] /rest → ${REST_TARGET} (REMOTE mode — Gemma is the backend, curator's own Authorization passed through)`
      : `[curation] /rest → ${REST_TARGET} (local_api default, Authorization overridden with the dev bearer)`,
  );

  console.log(
    `[curation] /rest/v2/datasets/*/{svd,sample-correlation,mean-variance} → ${GEMMA_REST_URL} (diagnostics fallback)`,
  );

  if (ONTOLOGY_URL) {
    console.log(
      `[curation] /rest/v2/annotations/{search,term,children,relations} + /rest/v2/genes → ${ONTOLOGY_URL} (ontology routing exception)`,
    );
  }

  console.log(`[curation] /local-api → ${LOCAL_API_URL} (explicit local_api passthrough)`);
   
  console.log(
    `[curation] /propose,/audit,/find-*,/validate-terms → ${PROPOSER_URL}`,
  );
  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
        "@gemma/assets": path.resolve(__dirname, "../../packages/assets/src"),
        "@gemma/diagnostics": path.resolve(__dirname, "../../packages/diagnostics/src"),
        "@gemma/heatmap": path.resolve(__dirname, "../../packages/heatmap/src"),
        "@gemma/ontology": path.resolve(__dirname, "../../packages/ontology/src"),
        "@gemma/ui": path.resolve(__dirname, "../../packages/ui/src"),
      },
    },
    server: {
      port: 5173,
      // Polling fallback for the watcher. Docker-on-macOS bind-mounts
      // don't deliver inotify events from host edits, so HMR misses
      // workspace-package source changes (the @gemma/* aliases point
      // outside the app root). Flip on with ``VITE_USE_POLLING=1`` in
      // the docker-compose env; left off by default so direct-on-host
      // dev doesn't pay the CPU cost.
      watch:
        env.VITE_USE_POLLING === "1"
          ? { usePolling: true, interval: 500 }
          : undefined,
      proxy: {
        // Order matters — Vite matches in declaration order, so the
        // ontology + diagnostics routing exceptions must come BEFORE
        // the generic ``/rest`` catch-all below.
        // The ontology routing exceptions go to whatever ontology-
        // capable Gemma host you set ``GEMMA_ONTOLOGY_URL`` to; only
        // registered when that var is set (see the warning above).
        // That host's Tomcat CORS filter may 403 any request that
        // carries a non-allowlisted Origin header — including
        // ``http://localhost:5175`` from the curator-package browser
        // — so strip Origin + Referer like every other gemma-rest
        // proxy entry does.
        ...(ONTOLOGY_URL
          ? {
              "/rest/v2/annotations/search": {
                target: ONTOLOGY_URL,
                changeOrigin: true,
                configure: (proxy) => {
                  proxy.on("proxyReq", (proxyReq) => {
                    proxyReq.removeHeader("origin");
                    proxyReq.removeHeader("referer");
                  });
                },
              },
              "/rest/v2/annotations/term": {
                target: ONTOLOGY_URL,
                changeOrigin: true,
                configure: (proxy) => {
                  proxy.on("proxyReq", (proxyReq) => {
                    proxyReq.removeHeader("origin");
                    proxyReq.removeHeader("referer");
                  });
                },
              },
              // ``/genes`` rides the same exception, for the same
              // reason: it is Gemma's gene catalogue, and a local_api
              // stack doesn't carry one. A gene chip resolves its
              // species through ``/rest/v2/genes/{ncbiId}`` — the id is
              // in the term's URI, so the species is knowable for every
              // gene binding, including the ones whose stored label
              // never said.
              "/rest/v2/genes": {
                target: ONTOLOGY_URL,
                changeOrigin: true,
                configure: (proxy) => {
                  proxy.on("proxyReq", (proxyReq) => {
                    proxyReq.removeHeader("origin");
                    proxyReq.removeHeader("referer");
                  });
                },
              },
              // ``/annotations/relations`` (+ ``/relations/implies``)
              // rides the same exception, and must: it is Gemma's
              // ANNOTATION_RELATION table — derived facts about terms,
              // with the basis they are known on — and the store has no
              // such table, so the default ``/rest`` route would 404
              // every call. Same host as ``/term`` on purpose: a
              // relation and the term it is about have to come from one
              // ontology release, or the popover shows a relation to a
              // term it cannot then resolve.
              "/rest/v2/annotations/relations": {
                target: ONTOLOGY_URL,
                changeOrigin: true,
                configure: (proxy) => {
                  proxy.on("proxyReq", (proxyReq) => {
                    proxyReq.removeHeader("origin");
                    proxyReq.removeHeader("referer");
                  });
                },
              },
              // ``/annotations/children`` rides the same ontology
              // exception — the CuriePopover pulls a term's immediate
              // children (``&direct=true``) from the SAME Gemma host
              // that serves its parents, so the hierarchy stays
              // consistent on one ontology release rather than
              // skewing against an external service. local_api
              // doesn't serve this endpoint.
              "/rest/v2/annotations/children": {
                target: ONTOLOGY_URL,
                changeOrigin: true,
                configure: (proxy) => {
                  proxy.on("proxyReq", (proxyReq) => {
                    proxyReq.removeHeader("origin");
                    proxyReq.removeHeader("referer");
                  });
                },
              },
            }
          : {}),
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
        // The GEO record Gemma harvested — Gemma-only, like the
        // diagnostics endpoints above: the store serves no such route,
        // so in local mode the catch-all would 404 every call. Routed
        // here in BOTH modes because the local working set is where the
        // data is (176 of the store's 189 experiment ids return a
        // document from gemma2, 10 are not in Gemma, 3 unharvested).
        "^/rest/v2/datasets/\\d+/sourceMetadata$": {
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
        // Subsets Gemma has already cut. Gemma-only, like the GEO
        // record above: the store serves no such route. Matches the
        // collection only — `/subSets/{id}` and `/subSetGroups` are not
        // read (the latter 500s on exactly the single-cell datasets the
        // single-cell panel exists for; see api/subsets.ts).
        // Gemma's own experiment sets. Gemma-only; the store serves
        // no such route. Read whole and filtered client-side because
        // Gemma has no "which sets contain dataset X" route.
        "^/rest/v2/experiment-sets(\\?.*)?$": {
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
        // Who assigned the cell types — Gemma-only, same reason as
        // `subSets` below. 404 is an ordinary answer here (no
        // assignment recorded, or not a single-cell dataset) and the
        // hook reads the server's sentence off it.
        "^/rest/v2/datasets/\\d+/cellTypeAssignment$": {
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
        "^/rest/v2/datasets/\\d+/subSets$": {
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
        // 🛑 **The curation store's own namespace — ALWAYS the store,
        // in both modes.** This is the point of the prefix: `/rest/v2`
        // is Gemma's in remote mode, and several nouns exist on both
        // sides with different meanings (`/groups` is curation sets
        // here and USER GROUPS on Gemma), so a curation call routed by
        // mode reaches whichever backend the mode picked. Under
        // `/curation/v1` there is nothing to pick — the store is the
        // only thing that serves it.
        //
        // Paul, 2026-08-29: Gemma's routes do not move; the store takes
        // the prefix. The store mounted all 106 routes here while
        // `/rest/v2` keeps answering, so this switch and the old
        // mount's removal are independent deploys.
        //
        // Same Authorization override as `/local-api`: these reach
        // local_api, which does not know the curator's gemma-rest
        // token.
        "/curation/v1": {
          target: LOCAL_API_URL,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.setHeader(
                "Authorization",
                `Bearer ${LOCAL_API_BEARER}`,
              );
            });
          },
        },
        // Read-only Gemma REST (study preview) → host sidecar; strips
        // the /gemma-ro prefix so the sidecar sees /datasets/{acc}.
        "/gemma-ro": {
          target: GEMMA_RO_PROXY,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/gemma-ro/, ""),
        },
        "/rest": {
          target: REST_TARGET,
          changeOrigin: true,
          // Strip Origin + Referer so Tomcat's CORS filter doesn't
          // 403 the request. Verified by curl: any Origin header
          // (even the server's own host) triggers "Invalid CORS
          // request"; no Origin → 401/200 normally.
          //
          // Override the Authorization header with local_api's dev
          // bearer — the browser sends the user's gemma-rest token
          // from localStorage, which local_api doesn't recognize.
          //
          // 🛑 The override is LOCAL-mode only. It replaces whatever the
          // browser sent, so applying it against Gemma hands Gemma the
          // store's dev token instead of the curator's session — which
          // is why real login could not work through this proxy no
          // matter how the backends were pointed. In remote mode the
          // header passes through untouched.
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.removeHeader("origin");
              proxyReq.removeHeader("referer");
              if (!REMOTE_MODE) {
                proxyReq.setHeader(
                  "Authorization",
                  `Bearer ${LOCAL_API_BEARER}`,
                );
              }
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
        // Curation draft + lock relays. The agent is Gemma's
        // curation-write client (Paul, 2026-08-25: the curation UI is a
        // read-only client of Gemma and the agent does the writes), so
        // these forward to it, not to Gemma and not to the store.
        //
        // 🛑 Their own top-level prefix, NOT under `/rest`. `/rest` is a
        // catch-all to the store, whose `/draft` route is the agent's
        // crash BACKUP — so a `/rest/v2/datasets/{id}/curation-draft`
        // would land on the store no matter what the route was named,
        // write the backup, forward nothing to Gemma, and leave every
        // state the save indicator can render a lie. Naming cannot
        // defend against that; a distinct prefix can.
        //
        // Also why this is not a fifth `/rest/v2/...` exception: that
        // split already exists for ontology and is recorded as a thing
        // to unwind, not to copy. A prefix meaning three servers by
        // path is how a call reaches somewhere nobody intended.
        "/curation-draft": {
          target: PROPOSER_URL,
          changeOrigin: true,
        },
        "/curation-lock": {
          target: PROPOSER_URL,
          changeOrigin: true,
        },
        // The commit chain, same relay and the same reasoning as the
        // draft/lock pair above: the agent is Gemma's curation-write
        // client, so preflight/commit/sign forward to it. They are
        // three separate entries rather than one `/curation-` prefix
        // because that prefix would also swallow any future
        // `/curation-*` route the moment someone adds one, and a
        // path that silently acquires a target is exactly what the
        // note above is about.
        "/curation-preflight": {
          target: PROPOSER_URL,
          changeOrigin: true,
        },
        "/curation-commit": {
          target: PROPOSER_URL,
          changeOrigin: true,
        },
        "/curation-sign": {
          target: PROPOSER_URL,
          changeOrigin: true,
        },
        "/find-term": {
          target: PROPOSER_URL,
          changeOrigin: true,
        },
        // Read-only canonicaliser — validates (label, uri) pairs in one
        // batch per experiment. Lives on the proposer beside
        // /find-term, but does NOT match the /find-* shape, so it needs
        // its own entry or every request 404s in dev.
        "/validate-terms": {
          target: PROPOSER_URL,
          changeOrigin: true,
          // A whole experiment's terms in one call — including every
          // sample characteristic — so it can outrun the default.
          timeout: 0,
          proxyTimeout: 0,
        },
        // Agent config announce — GET /config reports the resolved
        // models + default options the AgentRunDialog surfaces for
        // confirmation. AGENT-PENDING (handoff AGENT_CONFIG_ANNOUNCE);
        // 404s harmlessly until the agent ships it.
        "/config": {
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
