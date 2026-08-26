/**
 * Where a dataset's data actually came from.
 *
 * 🛑 **Not every dataset is from GEO.** Gemma imports from
 * ArrayExpress, CELLxGENE and SRA, and some datasets are direct
 * uploads with no external source at all. Anything that builds an NCBI
 * URL from an accession without checking the database is wrong for
 * those — it either links to a GEO page that does not exist or, worse,
 * to a GEO record that happens to share the identifier.
 *
 * Prefer the server's own `externalUri`. Gemma supplies it for every
 * one of 500 datasets sampled across the corpus 2026-08-26, so the
 * per-database construction below is a fallback for the cases it does
 * not — not the main path.
 *
 * Twin of `externalSourceLink` in the curation app's
 * `features/experiment/ExperimentBanner.tsx`. Kept per-app rather than
 * shared: the two render very differently and one small mapping is not
 * worth a package, but they must not disagree about where a database
 * lives — if you add one here, add it there.
 */

/** The fields Gemma returns on a dataset for its origin. */
export interface ExternalSourceFields {
  /** The identifier in the source database, e.g. `GSE217927`. */
  accession?: string | null;
  /** Server-resolved deep link. Preferred over anything constructed. */
  externalUri?: string | null;
  /** `GEO`, `ARRAYEXPRESS`, `CELLXGENE`, `SRA`, … */
  externalDatabase?: string | null;
  /** How the source names it — usually the accession again. */
  externalLabel?: string | null;
}

export interface DatasetSource {
  /** Null when we know the database but not a URL for it. The label
   *  still renders, as text — an accession a reader can paste is worth
   *  more than nothing. */
  href: string | null;
  /** What to show: the accession, or the source's own label. */
  label: string;
  /** Display name of the database, for the tooltip. */
  database: string;
}

/** Per-database deep links, for when the server gives no `externalUri`.
 *  Mirrors the curation app's mapping. */
function constructHref(database: string, accession: string): string | null {
  switch (database.toUpperCase()) {
    case "GEO":
      return `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${encodeURIComponent(accession)}`;
    case "ARRAYEXPRESS":
      return `https://www.ebi.ac.uk/biostudies/arrayexpress/studies/${encodeURIComponent(accession)}`;
    case "CELLXGENE":
      // CELLxGENE accessions are dataset UUIDs.
      return `https://cellxgene.cziscience.com/datasets/${encodeURIComponent(accession)}`;
    case "SRA":
      return `https://www.ncbi.nlm.nih.gov/sra/?term=${encodeURIComponent(accession)}`;
    default:
      // An unknown database is not a reason to guess a URL. Better a
      // readable accession than a link to somewhere it is not.
      return null;
  }
}

/**
 * Resolve a dataset's source, or `null` when it has none — a direct
 * upload, which is a real and ordinary case rather than missing data.
 *
 * Callers should render nothing rather than "unknown" for `null`: a
 * dataset with no external source is not a dataset whose source we
 * failed to find.
 */
export function datasetSource(
  d: ExternalSourceFields | null | undefined,
): DatasetSource | null {
  if (!d) return null;
  const accession = (d.accession ?? "").trim();
  const database = (d.externalDatabase ?? "").trim();
  const uri = (d.externalUri ?? "").trim();
  const label = (d.externalLabel ?? "").trim() || accession;

  // Nothing to point at and nothing to name: a direct upload.
  if (!label && !uri) return null;

  const href = uri || (database && accession ? constructHref(database, accession) : null);
  return {
    href,
    label: label || accession || database,
    database: database || "external source",
  };
}
