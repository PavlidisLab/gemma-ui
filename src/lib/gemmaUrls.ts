/**
 * Single source of truth for the Gemma web base URL + the deep-link
 * patterns the UI needs (experiment page, audit-trail page, array-
 * design page). Production points at ``https://gemma.msl.ubc.ca``;
 * dev / staging deployments override via ``VITE_GEMMA_WEB_URL``.
 *
 * The Vite-time env var is read once at module load — changes
 * require a dev-server restart, same as the proxy targets.
 *
 * Kept distinct from the curation REST base (``GEMMA_CURATION_URL``,
 * proxied at ``/rest/*``): that's the API surface the UI POSTs to;
 * this is the **public web pages** the UI links *out* to.
 */
export const GEMMA_WEB_URL: string =
  import.meta.env.VITE_GEMMA_WEB_URL ?? "https://gemma.msl.ubc.ca";

export function experimentPageUrl(experimentId: number): string {
  return `${GEMMA_WEB_URL}/expressionExperiment/showExpressionExperiment.html?id=${experimentId}`;
}

export function experimentAuditTrailUrl(experimentId: number): string {
  return `${GEMMA_WEB_URL}/expressionExperiment/showExpressionExperimentAuditTrail.html?id=${experimentId}`;
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
