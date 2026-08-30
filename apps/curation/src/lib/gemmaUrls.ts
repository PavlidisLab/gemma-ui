/**
 * Single source of truth for the Gemma web base URLs + the deep-link
 * patterns the UI needs.
 *
 * **There are two Gemma web front-ends now**, and a curator wants both
 * from an experiment page:
 *
 *   - **Gemma 1.0** — the JSP webapp at ``https://gemma.msl.ubc.ca``.
 *     Still the only place some detail pages exist, so it stays linked
 *     "for now" (Paul, 2026-08-25).
 *   - **Gemma 2.0** — the browser app, live at the ROOT of
 *     ``https://gemma2.msl.ubc.ca`` as of 2026-08-25.
 *
 * The Vite-time env vars are read once at module load — changes
 * require a dev-server restart, same as the proxy targets.
 *
 * Kept distinct from the curation REST base (``GEMMA_CURATION_URL``,
 * proxied at ``/rest/*``): that's the API surface the UI talks to;
 * these are the **public web pages** the UI links *out* to.
 */
export const GEMMA_WEB_URL: string =
  import.meta.env.VITE_GEMMA_WEB_URL ?? "https://gemma.msl.ubc.ca";

/** Base for the Gemma 2.0 browser app. Mounted at the site root —
 *  verified 2026-08-25, ``/`` serves it and every sub-path 404s. */
export const GEMMA_BROWSER_URL: string =
  import.meta.env.VITE_GEMMA_BROWSER_URL ?? "https://gemma2.msl.ubc.ca";

/**
 * Deep link to an experiment in the Gemma 2.0 browser.
 *
 * 🛑 The ``#`` is not decoration. The browser app uses
 * ``createHashHistory`` (`apps/browser/src/main.tsx:45`) precisely so
 * deep links survive a static mount with no server rewrite — the
 * fragment never reaches the server. A path-style
 * ``/dataset/9`` would 404.
 *
 * Takes the same numeric id as ``experimentPageUrl``: the curation
 * store preserves Gemma's experiment ids on import, so one id
 * addresses the same dataset in all three places (verified 2026-08-25
 * — GSE3253 is 9 in the store and 9 on gemma2).
 */
export function browserExperimentPageUrl(
  experimentId: number | string,
): string {
  return `${GEMMA_BROWSER_URL}/#/dataset/${experimentId}`;
}

export function experimentPageUrl(experimentId: number | string): string {
  return `${GEMMA_WEB_URL}/expressionExperiment/showExpressionExperiment.html?id=${experimentId}`;
}

/* 🛑 REMOVED 2026-08-29: `experimentAuditTrailUrl`, which built
 * `${GEMMA_WEB_URL}/expressionExperiment/showExpressionExperimentAuditTrail.html?id=`
 * for the History panel's "full trail on Gemma" link.
 *
 * There is no such page and there never was: `git log --all -S` over the
 * Gemma repo finds the path on no branch, and it answers 404 on
 * gemma.msl.ubc.ca AND gemma2.msl.ubc.ca. The Gemma 1.0 experiment page
 * (which does serve, 200) carries no audit-trail section either.
 *
 * The caveat it carried — "REST exposes only the most-recent events of
 * each type" — is also false. `/datasets/1658/auditEvents` returns 71
 * events over 13 types, up to 35 of a single type, and the store returns
 * byte-identical counts through the proxy. The panel already has the
 * complete trail, so the link offered a curator a 404 in exchange for a
 * limitation that does not exist.
 *
 * Don't restore it against a different path without fetching that path
 * first. */

/**
 * Build the external-database URL for an individual sample
 * accession (per-biomaterial / per-bio_assay short_name), so a row
 * in the sample table can link out to the source-database page.
 *
 * GEO is the dominant case — biomaterial / bio_assay short_name on
 * GEO-imported datasets is the GSM accession. Other databases either
 * don't expose a per-sample page (CELLxGENE, SRA at this granularity)
 * or use accession schemes our short_name doesn't follow; for those
 * we return ``null`` rather than guess a URL that 404s.
 *
 * Pattern-guarded: even when ``database === "GEO"``, a short_name
 * that doesn't match the ``GSM\d+`` shape is treated as not-a-GSM
 * (some datasets store internal aliases there). Skip the link
 * rather than send curators to a broken page.
 */
export function sampleExternalUrl(
  database: string | undefined | null,
  accession: string | undefined | null,
): string | null {
  const acc = (accession || "").trim();
  if (!acc) return null;
  const db = (database || "").toUpperCase();
  if (db === "GEO" && /^GSM\d+$/i.test(acc)) {
    return `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${encodeURIComponent(acc)}`;
  }
  return null;
}

export function platformPageUrl(
  shortName: string | null | undefined,
  id: number | null | undefined,
): string | null {
  // Prefer the numeric ID — short_names aren't a stable Gemma
  // identifier (they can rename when an array_design is merged
  // into a successor), and ``Generic_*`` short_names in particular
  // are reused across taxa. ID is the primary key. Fall back to
  // short_name only when no ID is recorded.
  if (id != null) {
    return `${GEMMA_WEB_URL}/arrays/showArrayDesign.html?id=${id}`;
  }
  if (shortName) {
    return `${GEMMA_WEB_URL}/arrays/showArrayDesign.html?shortName=${encodeURIComponent(shortName)}`;
  }
  return null;
}
