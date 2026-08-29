/**
 * Build-time backend-mode switch for the curation UI.
 *
 * Two modes:
 *   - **local** (default): the curation store on localhost:8095. Full
 *     capability set — tickets, audits, dispositions, groups,
 *     candidates — and those writes land in the local SQLite DB.
 *   - **remote**: real Gemma REST API at ``VITE_GEMMA_BASE_URL``. The
 *     curation store is ABSENT there, so the store-shaped surfaces
 *     have no backend at all rather than a reduced one.
 *
 * 🛑 Mode is a CAPABILITY flag, not a routing switch. ``api/client.ts``
 * fetches relative paths, so the vite proxy table decides where a call
 * lands. See ``docs/CONFIGURATION.md``.
 *
 * 🛑 This block used to say remote mode was "read-mostly" with
 * "confirmation modals fire on every write", and named localhost:8080
 * as the local server. All three were wrong. Nothing in this app
 * consults the mode before writing — grep ``isProd`` and you reach the
 * mode chip and nothing else — so there are no confirmation modals to
 * fire, and :8080 is a Gemma, not the store.
 *
 * Read once at boot — Vite inlines ``VITE_*`` env vars into the
 * bundle, so flipping requires a rebuild or restart. The hook
 * returns the resolved mode + base URL + a few derived flags the
 * mode chip and capability gating consume.
 */

import { createContext, useContext } from "react";

export type GemmaMode = "local" | "remote";

/**
 * Host config served by local-api's ``GET /rest/v2/__config__`` —
 * read at runtime so a curator who flips ``GEMMA_ONTOLOGY_URL`` in
 * ``.env`` + ``docker compose down && up`` sees the new host without a
 * SPA rebuild (the build-time ``import.meta.env`` value would otherwise
 * stay baked in). camelCase on the wire; we coalesce snake_case too in
 * ``fetchRuntimeConfig`` in case it round-trips through ``client.ts``.
 */
export interface RuntimeConfig {
  gemmaBaseUrl?: string | null;
  gemmaOntologyUrl?: string | null;
  gemmaCurationUrl?: string | null;
  mode?: GemmaMode | null;
}

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
  /** True when remote mode points at a host we cannot vouch for —
   *  anything not in ``PROD_GEMMA_HOSTS``. Drives the amber-severity
   *  mode chip. Fails CLOSED on purpose: an unrecognized host takes
   *  the warning tier, never the mild one, because a hostname does
   *  not tell a sandbox from production. */
  isUnverified: boolean;
  /** Short human-readable label of the auth method, for the chip
   *  popover. */
  authLabel: string;
  /** Host serving ``/rest/v2/annotations/{search,term}`` lookups.
   *  Equal to ``baseHost`` when no routing split is configured;
   *  different from ``baseHost`` when the Vite proxy / deployment
   *  layer routes ontology endpoints to a separate host because
   *  the main backend lacks ontology coverage (in local mode, an
   *  operator-configured ontology host can serve ontology lookups
   *  while the local Gemma stack serves everything else). Drives
   *  the OntologyTermPicker's "ontology source" footer. */
  ontologyHost: string;
  /** Full base URL serving ``/rest/v2/annotations/{search,term}``.
   *  Surfaced in the ModeChip popover so curators can see exactly
   *  where term search resolves. */
  ontologyUrl: string;
  /** True when the ontology routing split is active —
   *  ``ontologyHost !== baseHost``. Gates the UI indicator. */
  ontologySplit: boolean;
}

const DEFAULT_LOCAL_BASE = "http://localhost:8095";

/** Hosts serving PRODUCTION Gemma data.
 *
 *  Measured 2026-08-28, not assumed: `/rest/v2/datasets/count` returns
 *  25,694 on gemma.msl.ubc.ca and 25,695 on gemma2.msl.ubc.ca when
 *  called as `administrator` (23,744 / 23,547 anonymously — the count
 *  is a function of who is asking). Both are the real corpus, and
 *  their agreeing is what one database under two names looks like,
 *  not evidence of a copy.
 *
 *  🛑 gemma2 was in NEITHER tier before. The set did not list it, and
 *  the staging test was `baseHost.includes("gemma.msl.ubc.ca")`, which
 *  is false for the string "gemma2.msl.ubc.ca" — so the host every
 *  remote-mode recipe in docs/CONFIGURATION.md points at rendered in
 *  the mildest remote tier, with no production warning. */
const PROD_GEMMA_HOSTS = new Set([
  "gemma.msl.ubc.ca",
  "www.gemma.msl.ubc.ca",
  "gemma2.msl.ubc.ca",
  "www.gemma2.msl.ubc.ca",
]);

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Resolve mode + base URL from build-time env vars. Pure — no React;
 *  hookified below for ergonomic use in components. */
export function resolveGemmaMode(runtime?: RuntimeConfig | null): GemmaModeInfo {
  const envMode = import.meta.env.VITE_GEMMA_MODE;
  const envBase = import.meta.env.VITE_GEMMA_BASE_URL;
  // Precedence everywhere below: runtime config (from
  // /rest/v2/__config__) > build-time env > terminal default.
  // Local mode default; remote requires explicit opt-in.
  const mode: GemmaMode =
    (runtime?.mode ?? envMode) === "remote" ? "remote" : "local";
  const baseUrl =
    // In remote mode the base IS the Gemma host, so a runtime value is
    // authoritative. In local mode the UI talks to local-api via the
    // proxy and the runtime ``gemmaBaseUrl`` is the *proposer's* remote
    // target, not the UI's backend — so we keep the local default
    // there rather than mislabel the chip.
    (mode === "remote" ? runtime?.gemmaBaseUrl || undefined : undefined) ||
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
  // Everything remote that we cannot name as production. No substring
  // matching: a suffix test cannot distinguish gemma2 from gemma, and
  // reading a lab hostname as reassurance is the failure this replaces.
  const isUnverified = mode === "remote" && !isProd;
  const authLabel =
    mode === "local"
      ? "dev-token (local server)"
      : "your Gemma login (HTTP Basic)";
  // Ontology routing exception. In local mode the Vite proxy can
  // forward ``/rest/v2/annotations/{search,term}`` to a separate
  // host when the local stack doesn't carry full ontology coverage
  // — set via ``VITE_GEMMA_ONTOLOGY_URL`` / runtime config, no
  // built-in default. In remote mode there's no split — the same
  // Gemma host that serves the rest of /rest also serves ontology
  // queries — so we collapse ``ontologyHost`` to ``baseHost`` and
  // ``ontologySplit`` is false.
  const envOntology = import.meta.env.VITE_GEMMA_ONTOLOGY_URL;
  const ontologyUrl =
    mode === "remote"
      ? baseUrl
      : runtime?.gemmaOntologyUrl || envOntology || "(unset)";
  const ontologyHost =
    ontologyUrl === "(unset)" ? "(unset)" : hostFromUrl(ontologyUrl);
  const ontologySplit = ontologyHost !== baseHost;
  return {
    mode,
    baseUrl,
    baseHost,
    isProd,
    isUnverified,
    authLabel,
    ontologyHost,
    ontologyUrl,
    ontologySplit,
  };
}

/**
 * Fetch the runtime host config from local-api. Returns ``null`` on
 * any failure (legacy local-api without the endpoint, network error,
 * malformed body) so the caller falls back to build-time env — old
 * bundles / old servers keep working exactly as before. Reads both
 * camelCase (raw wire) and snake_case (post-client.ts) keys so the
 * call site doesn't care which path the response took.
 */
export async function fetchRuntimeConfig(): Promise<RuntimeConfig | null> {
  try {
    const resp = await fetch("/curation/v1/__config__", {
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) return null;
    const body: unknown = await resp.json();
    if (!body || typeof body !== "object") return null;
    const o = body as Record<string, unknown>;
    const pick = (camel: string, snake: string): string | null => {
      const v = o[camel] ?? o[snake];
      return typeof v === "string" && v.trim() ? v : null;
    };
    const rawMode = o.mode;
    const mode: GemmaMode | null =
      rawMode === "remote" ? "remote" : rawMode === "local" ? "local" : null;
    return {
      gemmaBaseUrl: pick("gemmaBaseUrl", "gemma_base_url"),
      gemmaOntologyUrl: pick("gemmaOntologyUrl", "gemma_ontology_url"),
      gemmaCurationUrl: pick("gemmaCurationUrl", "gemma_curation_url"),
      mode,
    };
  } catch {
    return null;
  }
}

/** Resolved mode info, supplied by ``GemmaModeProvider`` once the
 *  runtime config has been fetched. ``null`` until a provider mounts —
 *  consumers fall back to the synchronous build-time resolution. */
export const GemmaModeContext = createContext<GemmaModeInfo | null>(null);

/** React hook for the resolved backend mode. Reads the runtime-aware
 *  value from ``GemmaModeProvider`` when present; falls back to the
 *  build-time resolution otherwise (unit tests, isolated renders) so
 *  the hook never throws and never needs the provider to be useful. */
export function useGemmaMode(): GemmaModeInfo {
  return useContext(GemmaModeContext) ?? resolveGemmaMode();
}
