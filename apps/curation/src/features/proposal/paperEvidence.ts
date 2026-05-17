/**
 * Parse curated metadata out of an agent-fetched ``paper_excerpt``.
 *
 * The proposer's evidence carries a kitchen-sink text dump — GEO
 * metadata header (Title / Type / Organism / Platform / Linked
 * PMID(s) / Summary / Overall design) followed by an
 * ``=== ABSTRACT ===`` block from the linked publication. We don't
 * have a structured ``Publication`` field on the proposal; if the
 * curator wants the paper attached on accept, the metadata has to
 * come from regexes against this text.
 *
 * Returns whichever fields were recoverable. ``null`` for any field
 * we couldn't find — caller decides whether the partial result is
 * worth submitting (e.g. title alone is fine; nothing-but-DOI is
 * suspicious).
 */
export interface PaperMeta {
  title: string | null;
  pubmed_id: string | null;
  doi: string | null;
}

const TITLE_RE = /(?:^|\n)Title:\s*([^\n]+)/i;
// Linked PMID(s): 12345 — comma-separated when multiple. Take the
// first ID; downstream consumers (addPublication) only support one
// PMID per Publication anyway.
const PMID_RE = /(?:Linked\s+PMID\(s\)|PubMed\s+ID|PMID)\s*:?\s*(\d+)/i;
// Match either a doi.org URL or a bare ``10.xxxx/yyyy`` reference.
const DOI_URL_RE = /https?:\/\/(?:dx\.)?doi\.org\/([^\s,)\]]+)/i;
const DOI_BARE_RE = /\b(10\.\d{4,9}\/[^\s,)\]]+)/;

export function extractPaperMeta(excerpt: string): PaperMeta {
  const meta: PaperMeta = { title: null, pubmed_id: null, doi: null };
  if (!excerpt) return meta;

  const titleMatch = excerpt.match(TITLE_RE);
  if (titleMatch) {
    // Trim trailing GEO suffixes like ``[control set]`` only when
    // they occur as the last bracketed token — they're useful
    // disambiguation in GEO but read as noise on the publication
    // chip. Keep them when in the middle of the title (rare).
    let t = titleMatch[1].trim();
    t = t.replace(/\s*\[[^\]]+\]\s*$/, "").trim();
    if (t) meta.title = t;
  }

  const pmidMatch = excerpt.match(PMID_RE);
  if (pmidMatch) meta.pubmed_id = pmidMatch[1];

  const doiUrlMatch = excerpt.match(DOI_URL_RE);
  if (doiUrlMatch) meta.doi = doiUrlMatch[1];
  else {
    const doiBareMatch = excerpt.match(DOI_BARE_RE);
    if (doiBareMatch) meta.doi = doiBareMatch[1];
  }

  return meta;
}

/** When ``paper_source`` is itself a PMID (some agent paths set it
 *  directly to a numeric id rather than a provenance label), return
 *  the PMID. ``null`` otherwise. Used as a fallback when the
 *  excerpt doesn't carry a "Linked PMID" line. */
export function pmidFromPaperSource(paperSource: string | null | undefined): string | null {
  const s = (paperSource || "").trim();
  return /^\d{4,}$/.test(s) ? s : null;
}
