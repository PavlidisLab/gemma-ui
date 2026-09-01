import type { ExternalSource } from "@/features/experiment/types";

/** Formatters the banner and the Overview's Source & links card share.
 *  Split out of `ExperimentBanner.tsx` 2026-09-01 — behaviour unchanged. */

/**
 * Compact "Apr 16 07:32" rendering of an ISO timestamp. Falls back
 * to the raw string when parsing fails — better noise than "Invalid
 * Date" in the banner. Full timestamp with microseconds rides in
 * the parent's ``title`` tooltip.
 */
/** The load date, with a YEAR on anything that is not this year.
 *
 *  🛑 Without it a 2009 load reads as recent, and can read as
 *  YESTERDAY: `2009-08-29T20:13:35Z` rendered as "loaded Aug 29,
 *  01:13 PM" on 2026-08-30 (Paul). The full timestamp was already one
 *  hover away, which is exactly the wrong place for the fact that
 *  changes what the line means.
 *
 *  Kept off the current year so the common case stays short — a
 *  dataset loaded this year is the one a curator reads as recent
 *  without being told. Everything older says so on its face. */
export function formatLoadedAt(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString([], {
      year:
        d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * Resolve the link to the external source for an ExternalSource.
 * Prefers the stored `uri` (server-supplied, canonical). Falls back
 * to a per-database default for the major sources so the banner
 * can still link out when older payloads don't carry `uri`.
 *
 * Returns ``null`` for unknown databases without a stored URI — we
 * show the accession as text rather than guess a URL.
 */
export function externalSourceLink(src: ExternalSource | null): string | null {
  if (!src) return null;
  if (src.uri) return src.uri;
  const acc = src.accession.trim();
  if (!acc) return null;
  switch (src.database.toUpperCase()) {
    case "GEO":
      return `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${encodeURIComponent(acc)}`;
    case "ARRAYEXPRESS":
      return `https://www.ebi.ac.uk/biostudies/arrayexpress/studies/${encodeURIComponent(acc)}`;
    case "CELLXGENE":
      // CELLxGENE accessions are dataset UUIDs.
      return `https://cellxgene.cziscience.com/datasets/${encodeURIComponent(acc)}`;
    case "SRA":
      return `https://www.ncbi.nlm.nih.gov/sra/?term=${encodeURIComponent(acc)}`;
    default:
      return null;
  }
}
