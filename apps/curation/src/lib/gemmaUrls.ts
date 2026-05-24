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

export function experimentPageUrl(experimentId: number | string): string {
  return `${GEMMA_WEB_URL}/expressionExperiment/showExpressionExperiment.html?id=${experimentId}`;
}

export function experimentAuditTrailUrl(experimentId: number | string): string {
  return `${GEMMA_WEB_URL}/expressionExperiment/showExpressionExperimentAuditTrail.html?id=${experimentId}`;
}

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
