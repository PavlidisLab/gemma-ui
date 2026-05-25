/**
 * Build-time backend-mode switch for the curation UI.
 *
 * Two modes:
 *   - **local** (default): the standalone curation server on
 *     localhost:8080. Full capability set — audits, dispositions,
 *     design edits, inter-curator-audit packages.
 *   - **remote**: real Gemma REST API at ``VITE_GEMMA_BASE_URL``.
 *     Narrow capability set; read-mostly. Confirmation modals fire
 *     on every write.
 *
 * Read once at boot — Vite inlines ``VITE_*`` env vars into the
 * bundle, so flipping requires a rebuild or restart. The hook
 * returns the resolved mode + base URL + a few derived flags the
 * mode chip and capability gating consume. See
 * ``gemma-curation-agents-eval/docs/HANDOFF_2026-05-19_LOCAL_VS_REMOTE_MODE.md``.
 */

export type GemmaMode = "local" | "remote";

export interface GemmaModeInfo {
  /** Resolved mode after defaulting. */
  mode: GemmaMode;
  /** Absolute URL of the backend. In local mode this is the proxy
   *  target (the UI itself talks through Vite's proxy on
   *  ``/rest/v2/*``); in remote mode it's where requests go
   *  directly. */
  baseUrl: string;
  /** Host segment (no protocol, no path) — what the mode chip
   *  shows. */
  baseHost: string;
  /** True when the resolved base URL points at the prod Gemma host.
   *  Drives the red-severity mode-chip rendering. */
  isProd: boolean;
  /** True when the resolved base URL points at the staging Gemma
   *  host. Drives the amber-severity mode-chip + "shares prod DB"
   *  warning. */
  isStaging: boolean;
  /** Short human-readable label of the auth method, for the chip
   *  popover. */
  authLabel: string;
  /** Host serving ``/rest/v2/annotations/{search,term}`` lookups.
   *  Equal to ``baseHost`` when no routing split is configured;
   *  different from ``baseHost`` when the Vite proxy / deployment
   *  layer routes ontology endpoints to a separate host because
   *  the main backend lacks ontology coverage (current state in
   *  local mode: staging-gemma serves ontologies while the local
   *  Gemma 2.0 stack serves everything else). Drives the
   *  OntologyTermPicker's "ontology source" footer. */
  ontologyHost: string;
  /** True when the ontology routing split is active —
   *  ``ontologyHost !== baseHost``. Gates the UI indicator. */
  ontologySplit: boolean;
}

const DEFAULT_LOCAL_BASE = "http://localhost:8095";
/** Default ontology host for the routing-split exception. Mirrors
 *  the Vite proxy's ``GEMMA_ONTOLOGY_URL`` default. Temporary —
 *  drops when local Gemma 2.0 ontology coverage matches staging. */
const DEFAULT_ONTOLOGY_BASE = "https://staging-gemma.msl.ubc.ca";

/** Hosts considered "prod Gemma". Anything else with `gemma.msl.ubc.ca`
 *  in the host (e.g. ``staging-gemma.msl.ubc.ca``) is staging. */
const PROD_GEMMA_HOSTS = new Set(["gemma.msl.ubc.ca", "www.gemma.msl.ubc.ca"]);

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Resolve mode + base URL from build-time env vars. Pure — no React;
 *  hookified below for ergonomic use in components. */
export function resolveGemmaMode(): GemmaModeInfo {
  const envMode = import.meta.env.VITE_GEMMA_MODE;
  const envBase = import.meta.env.VITE_GEMMA_BASE_URL;
  // Local mode default; remote requires explicit opt-in.
  const mode: GemmaMode = envMode === "remote" ? "remote" : "local";
  const baseUrl =
    envBase ||
    (mode === "remote"
      ? // Refuse to silently default a remote-mode base — surface
        // the misconfiguration loudly via the chip rather than
        // silently pointing at a default URL the curator didn't
        // ask for.
        "(unset)"
      : DEFAULT_LOCAL_BASE);
  const baseHost = baseUrl === "(unset)" ? "(unset)" : hostFromUrl(baseUrl);
  const isProd = mode === "remote" && PROD_GEMMA_HOSTS.has(baseHost);
  const isStaging =
    mode === "remote" &&
    !isProd &&
    baseHost.includes("gemma.msl.ubc.ca");
  const authLabel =
    mode === "local"
      ? "dev-token (local server)"
      : "your Gemma login (HTTP Basic)";
  // Ontology routing exception. In local mode the Vite proxy
  // forwards ``/rest/v2/annotations/{search,term}`` to a separate
  // host (default staging-gemma) because the local stack doesn't
  // carry full ontology coverage. In remote mode there's no split
  // — the same Gemma host that serves the rest of /rest also
  // serves ontology queries — so we collapse ``ontologyHost`` to
  // ``baseHost`` and ``ontologySplit`` is false.
  const envOntology = import.meta.env.VITE_GEMMA_ONTOLOGY_URL;
  const ontologyUrl =
    mode === "remote"
      ? baseUrl
      : envOntology || DEFAULT_ONTOLOGY_BASE;
  const ontologyHost =
    ontologyUrl === "(unset)" ? "(unset)" : hostFromUrl(ontologyUrl);
  const ontologySplit = ontologyHost !== baseHost;
  return {
    mode,
    baseUrl,
    baseHost,
    isProd,
    isStaging,
    authLabel,
    ontologyHost,
    ontologySplit,
  };
}

/** React hook over `resolveGemmaMode`. Result is stable per page
 *  load — mode is build-time, not user-toggleable mid-session. */
export function useGemmaMode(): GemmaModeInfo {
  // No React state needed; the env never changes after boot. Keeps
  // the hook callable from anywhere without subscribing to a
  // context.
  return resolveGemmaMode();
}
