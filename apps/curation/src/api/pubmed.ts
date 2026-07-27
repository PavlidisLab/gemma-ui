/** Fetch publication metadata from NCBI PubMed.
 *
 *  The local API's Design.publications field carries PMIDs but
 *  doesn't fetch human-readable metadata (title, citation, doi).
 *  When the UI renders a publication row, we surface "(metadata
 *  not fetched yet)" — and the reviewer reasonably asks "why isn't it
 *  fetched?". This hook does it on-demand: one esummary call per
 *  PMID per session, cached by TanStack.
 *
 *  The NCBI esummary endpoint is CORS-enabled + rate-limited at
 *  3 req/sec for unauthenticated callers. We don't batch or
 *  thumb-print; for a curator session that hits at most a few
 *  publications per experiment the rate limit is irrelevant.
 */
import { useQuery } from "@tanstack/react-query";

const ESUMMARY_URL =
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";

export interface PubmedMetadata {
  pmid: string;
  title: string;
  /** Short "Author et al., year" string suitable for inline display. */
  citation: string;
  journal: string;
  year: string;
  doi: string;
  /** Authors as a list of last-name-first strings (`"Quarta C"`). */
  authors: string[];
}

interface RawArticleId {
  idtype?: string;
  idtypen?: number;
  value?: string;
}

interface RawAuthor {
  name?: string;
  authtype?: string;
}

interface RawRecord {
  uid?: string;
  title?: string;
  source?: string;
  pubdate?: string;
  fulljournalname?: string;
  authors?: RawAuthor[];
  articleids?: RawArticleId[];
}

interface RawEsummaryResponse {
  result?: Record<string, RawRecord | string[] | string | undefined>;
}

/** Format an esummary record into the shape the UI wants. */
function formatRecord(pmid: string, rec: RawRecord): PubmedMetadata {
  const title = (rec.title ?? "").trim();
  const journal = (rec.source ?? rec.fulljournalname ?? "").trim();
  const pubdate = (rec.pubdate ?? "").trim();
  // pubdate looks like "2017 Nov 7" or "2017" — first token is the year.
  const year = pubdate.split(/\s+/)[0] ?? "";
  // Author list — keep names as-given.
  const authors = (rec.authors ?? [])
    .map((a) => (a.name ?? "").trim())
    .filter((s) => s.length > 0);
  const firstAuthor = authors[0] ?? "";
  const lastNameOnly = firstAuthor.split(/\s+/)[0] ?? firstAuthor;
  const etAl = authors.length > 1 ? " et al." : "";
  const citation =
    firstAuthor
      ? `${lastNameOnly}${etAl}${year ? `, ${year}` : ""}${journal ? `. ${journal}` : ""}`
      : `${year}${journal ? `. ${journal}` : ""}`.trim();
  const doi =
    (rec.articleids ?? [])
      .filter((a) => a.idtype === "doi")
      .map((a) => (a.value ?? "").trim())
      .find((s) => s.length > 0) ?? "";
  return { pmid, title, citation, journal, year, doi, authors };
}

/** Fetch PubMed metadata for a single PMID. Throws on network /
 *  parse error so React Query surfaces the failure to the caller. */
export async function fetchPubmedMetadata(
  pmid: string,
): Promise<PubmedMetadata> {
  const trimmed = (pmid ?? "").trim();
  if (!trimmed) {
    throw new Error("fetchPubmedMetadata: empty PMID");
  }
  const url =
    `${ESUMMARY_URL}?db=pubmed&id=${encodeURIComponent(trimmed)}&retmode=json`;
  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(`PubMed esummary ${r.status}`);
  }
  const raw = (await r.json()) as RawEsummaryResponse;
  const rec = raw.result?.[trimmed];
  if (!rec || typeof rec === "string" || Array.isArray(rec)) {
    throw new Error(`PubMed esummary: no record for ${trimmed}`);
  }
  return formatRecord(trimmed, rec);
}

/** TanStack-Query hook that fetches PubMed metadata for one PMID.
 *  Disabled (no fetch fired) when `pmid` is empty / falsy — the
 *  caller can pass `publication.pubmed_id` unconditionally and the
 *  hook is a no-op for legitimately-no-PMID rows.
 *
 *  Stale time: 24h. Once a citation is fetched it's not going to
 *  change for a curator session.
 */
export function usePubmedMetadata(pmid: string | undefined | null) {
  const trimmed = (pmid ?? "").trim();
  return useQuery({
    queryKey: ["pubmed-metadata", trimmed],
    enabled: trimmed.length > 0,
    queryFn: () => fetchPubmedMetadata(trimmed),
    staleTime: 24 * 60 * 60 * 1000,
    // Don't retry on 404 / 400 — invalid PMIDs aren't going to
    // resolve. React Query's default retry is 3; we cap at 1.
    retry: 1,
  });
}
