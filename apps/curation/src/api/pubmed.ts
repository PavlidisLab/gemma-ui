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

// ---------------------------------------------------------------------------
// Abstract + MeSH — efetch, not esummary
// ---------------------------------------------------------------------------

/** 🛑 esummary above carries NEITHER the abstract NOR MeSH headings, at
 *  any `retmode`. They only come from `efetch`, and only as XML — there
 *  is no JSON serialization of PubMed's article record. That is why this
 *  half of the module parses a DOM instead of reading a field. */
const EFETCH_URL =
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";

export interface MeshHeading {
  /** The descriptor as PubMed prints it — `Mice, Inbred C57BL`. */
  descriptor: string;
  /** Descriptor UI (`D008810`), which is what the MeSH browser takes. */
  ui: string;
  /** PubMed stars these: the paper is ABOUT this, rather than merely
   *  mentioning it. Worth the visual weight — a curator scanning for
   *  what an experiment studies wants the majors first. */
  major: boolean;
  /** Subheadings under the descriptor (`genetics`, `drug effects`). */
  qualifiers: string[];
}

export interface PubmedAbstract {
  pmid: string;
  title: string;
  journal: string;
  year: string;
  /** One entry per `<AbstractText>`. `label` is null on an
   *  unstructured abstract and set (`BACKGROUND`, `METHODS`, …) on a
   *  structured one — PubMed renders those as run-in headings and so
   *  do we. Empty when the record carries no abstract at all, which is
   *  common and not an error. */
  sections: { label: string | null; text: string }[];
  mesh: MeshHeading[];
}

function textOf(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Parse one `efetch` XML document.
 *
 *  🛑 **Scope every read to the article element.** A PubMed record
 *  embeds other papers' identifiers — `<ReferenceList>` and
 *  `<CommentsCorrectionsList>` both contain `<PMID>` — so a document-
 *  wide `querySelectorAll("PMID")` returns the references, and the
 *  first one is not this paper. Measured on 32015507: the document
 *  holds 4+ PMIDs and only the `MedlineCitation > PMID` child is the
 *  requested one. */
export function parsePubmedAbstract(
  xml: string,
  requestedPmid: string,
): PubmedAbstract {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const article = doc.querySelector("PubmedArticle");
  if (!article) {
    // efetch answers 200 with an <ERROR> body for an id it cannot
    // resolve, so a bad PMID never surfaces as a failed request.
    const err = textOf(doc.querySelector("ERROR"));
    throw new Error(
      err || `PubMed efetch: no article record for ${requestedPmid}`,
    );
  }
  const pmid = textOf(article.querySelector("MedlineCitation > PMID"));
  const title = textOf(article.querySelector("Article > ArticleTitle"));
  const journal =
    textOf(article.querySelector("Article > Journal > ISOAbbreviation")) ||
    textOf(article.querySelector("Article > Journal > Title"));
  const year =
    textOf(article.querySelector("Article > Journal > JournalIssue > PubDate > Year")) ||
    // A MedlineDate is a free-text span ("1998 Dec-1999 Jan") used when
    // the issue has no clean year; its first four digits are the year.
    (textOf(
      article.querySelector(
        "Article > Journal > JournalIssue > PubDate > MedlineDate",
      ),
    ).match(/\d{4}/)?.[0] ?? "");

  const sections = [...article.querySelectorAll("Article > Abstract > AbstractText")]
    .map((el) => ({
      // `NlmCategory` is the normalized bucket; `Label` is what the
      // journal actually wrote. Prefer the journal's own wording — it
      // is what the reader sees on PubMed.
      label: el.getAttribute("Label") ?? el.getAttribute("NlmCategory"),
      text: textOf(el),
    }))
    .filter((s) => s.text.length > 0);

  const mesh: MeshHeading[] = [
    ...article.querySelectorAll("MeshHeadingList > MeshHeading"),
  ].map((h) => {
    const d = h.querySelector("DescriptorName");
    const quals = [...h.querySelectorAll("QualifierName")];
    return {
      descriptor: textOf(d),
      ui: d?.getAttribute("UI") ?? "",
      // Major on the descriptor OR on any qualifier — PubMed stars the
      // heading in both cases, and a heading starred only through its
      // qualifier ("classification*") is still what the paper is about.
      major:
        d?.getAttribute("MajorTopicYN") === "Y" ||
        quals.some((q) => q.getAttribute("MajorTopicYN") === "Y"),
      qualifiers: quals.map((q) => textOf(q)).filter(Boolean),
    };
  }).filter((m) => m.descriptor.length > 0);

  return { pmid: pmid || requestedPmid, title, journal, year, sections, mesh };
}

/** Fetch abstract + MeSH for one PMID. Throws so React Query surfaces
 *  the failure rather than rendering an empty card. */
export async function fetchPubmedAbstract(
  pmid: string,
): Promise<PubmedAbstract> {
  const trimmed = (pmid ?? "").trim();
  if (!trimmed) throw new Error("fetchPubmedAbstract: empty PMID");
  const url = `${EFETCH_URL}?db=pubmed&id=${encodeURIComponent(trimmed)}&retmode=xml`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`PubMed efetch ${r.status}`);
  return parsePubmedAbstract(await r.text(), trimmed);
}

/** Abstract + MeSH for one PMID, on demand.
 *
 *  `enabled` is the caller's gate: the popover passes `false` until it
 *  is actually open, so a page of publication rows costs no requests
 *  until a curator asks for one. Same 24h staleness as the metadata
 *  hook above — a published abstract does not change. */
export function usePubmedAbstract(
  pmid: string | undefined | null,
  enabled = true,
) {
  const trimmed = (pmid ?? "").trim();
  return useQuery({
    queryKey: ["pubmed-abstract", trimmed],
    enabled: enabled && trimmed.length > 0,
    queryFn: () => fetchPubmedAbstract(trimmed),
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });
}
