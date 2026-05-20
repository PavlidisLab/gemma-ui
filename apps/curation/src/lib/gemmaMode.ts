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
}

const DEFAULT_LOCAL_BASE = "http://localhost:8080";

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
  return { mode, baseUrl, baseHost, isProd, isStaging, authLabel };
}

/** React hook over `resolveGemmaMode`. Result is stable per page
 *  load — mode is build-time, not user-toggleable mid-session. */
export function useGemmaMode(): GemmaModeInfo {
  // No React state needed; the env never changes after boot. Keeps
  // the hook callable from anywhere without subscribing to a
  // context.
  return resolveGemmaMode();
}
