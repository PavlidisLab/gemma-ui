// Endpoint helpers + TanStack Query keys for Gemma REST.
//
// Mirrors the actions registered in legacy-vue/src/store/modules/vapi.js.

import { apiGet, ApiError, type Params } from "./client";
import { compressFilter, compressArg } from "@/lib/utils";
import { negativeCategoryClause, quoteIfNecessary } from "@/lib/filter";
import { excludedCategories, excludedTerms } from "@/lib/gemmaConfig";
import type {
  AnnotationSearchResult,
  AnnotationTerm,
  Category,
  CategoryWithChildren,
  Dataset,
  DatasetAnnotation,
  PaginatedResponse,
  Platform,
  Taxon,
  User,
} from "@/lib/types";
import { apiBase as BASE } from "./base";
import type { HeatmapRowGene } from "@gemma/heatmap";

/* --------------------- requests --------------------- */

export interface DatasetsArgs {
  query?: string;
  filter: string[][];
  offset: number;
  limit: number;
  sort?: string;
  gid?: string;
}

export async function getDatasets(args: DatasetsArgs, signal?: AbortSignal): Promise<PaginatedResponse<Dataset>> {
  const compressed = await compressFilter(args.filter);
  const params: Params = {
    filter: compressed,
    offset: args.offset,
    limit: args.limit,
    sort: args.sort,
    query: args.query,
    gid: args.gid,
  };
  return apiGet<PaginatedResponse<Dataset>>(`${BASE}/datasets`, { params, signal });
}

export interface CategoriesArgs {
  query?: string;
  filter: string[][];
  limit?: number;
  applyExclusions: boolean; // true ⇒ send excludedCategories/Terms
  /** Category URIs to keep in the facet even when `excludedCategories`
   *  would drop them. The exclusion list is about what's worth
   *  *offering* to browse by — free-text and numeric axes whose term
   *  lists are thousands of one-offs. It shouldn't also suppress the
   *  count of a category the visitor has already picked: they arrive
   *  on such a filter from the home page's factor-value chart, and a
   *  selected row with no number reads as a broken filter. */
  keepCategories?: string[];
  gid?: string;
}

const DISALLOWED_CATEGORY_FILTER_PREFIXES = [
  "allCharacteristics.",
  "characteristics.",
  "bioAssays.sampleUsed.characteristics.",
  "experimentalDesign.experimentalFactors.factorValues.characteristics.",
];

/** A sub-clause may be wrapped in a quantifier — ``any(<predicate> and
 *  <predicate>)`` — so the property name isn't necessarily at the
 *  front of the string. Match the prefix against what's inside.
 *
 *  Annotation clauses only became quantified on 2026-08-22 (see
 *  `filter.ts`); before that a positive clause started with the
 *  property and matched directly, and `none(...)` exclusions did not —
 *  they leaked into the facet query unnoticed. */
export const unquantify = (sc: string) => sc.replace(/^(?:any|none|all)\(/i, "");

/* ------------- the four renamed annotation fields -------------
 *
 * 🛑 **Four fields were renamed with no aliases** — a hard rename,
 * because the thing removed was itself a compatibility shim (gembro,
 * `b5c6747f68`):
 *
 *     className -> category      termName -> value
 *     classUri  -> categoryUri   termUri  -> valueUri
 *
 * gemma2 serves the new names and none of the old ones. Confirmed
 * against 2.9.4 (2026-08-31): `classUri` and `termName` do not appear
 * anywhere in `/rest/v2/openapi.json`, and the schemas the three
 * routes below declare carry only the new spelling.
 *
 * 🛑 **THREE routes serve these fields, and every one of them needs
 * the adapter.** The first pass at this (`21420e9`) fixed only the
 * third and reported its blast radius as "four consumers" — the
 * census was `DatasetAnnotation`-typed, and the facet routes deal in
 * `Category` / `AnnotationTerm`, sibling types with the same four
 * field names fed by different endpoints. The two facet routes then
 * silently degraded for a day: `getCategoriesWithChildren` derives
 * `catId` from `classUri || className`, got `""` for every row, and
 * returned an EMPTY panel — indistinguishable from a filter that
 * legitimately matched nothing.
 *
 *   GET /datasets/categories            CategoryWithUsageStatisticsValueObject
 *   GET /datasets/annotations           AnnotationWithUsageStatisticsValueObject
 *   GET /datasets/{id}/annotations      AnnotationValueObject
 *
 * Coalescing (rather than renaming `Category` / `AnnotationTerm`) is
 * what keeps this correct against an older Gemma as well as a current
 * one, which matters while the dev proxy and production can be on
 * different builds. It is a bounded transition: once every Gemma this
 * app talks to serves `b5c6747f68` or later, delete the three `Wire*`
 * interfaces and their normalizers and read the new names directly.
 *
 * Not every annotation route needs this. `/annotations/search`
 * (`AnnotationSearchResultValueObject`) was born with `category` /
 * `value` and never had the old spelling, so `searchAnnotations` and
 * its caller read the wire directly — correctly.
 * ------------------------------------------------------------- */

/** A category facet row as `/datasets/categories` serves it. */
interface WireCategory extends Partial<Category> {
  category?: string | null;
  categoryUri?: string | null;
}

/** Exported for test. */
export function normalizeCategory(c: WireCategory): Category {
  return {
    className: c.category ?? c.className ?? null,
    classUri: c.categoryUri ?? c.classUri ?? null,
    numberOfExpressionExperiments: c.numberOfExpressionExperiments,
  };
}

/** A term facet row as `/datasets/annotations` serves it. */
interface WireAnnotationTerm extends Partial<AnnotationTerm> {
  category?: string | null;
  categoryUri?: string | null;
  value?: string | null;
  valueUri?: string | null;
}

/** Exported for test. */
export function normalizeAnnotationTerm(t: WireAnnotationTerm): AnnotationTerm {
  return {
    className: t.category ?? t.className ?? null,
    classUri: t.categoryUri ?? t.classUri ?? null,
    termName: t.value ?? t.termName ?? null,
    termUri: t.valueUri ?? t.termUri ?? null,
    numberOfExpressionExperiments: t.numberOfExpressionExperiments,
  };
}

export async function getCategories(args: CategoriesArgs, signal?: AbortSignal) {
  // Strip annotation-style sub-clauses from the filter — we don't want
  // selecting a value to hide the category it belongs to.
  const mFilter = args.filter
    .map((c) =>
      c.filter(
        (sc) =>
          !DISALLOWED_CATEGORY_FILTER_PREFIXES.some((p) => unquantify(sc).startsWith(p)),
      ),
    )
    .filter((c) => c.length > 0);
  const compressed = await compressFilter(mFilter);
  const params: Params = {
    filter: compressed,
    limit: args.limit ?? 20,
    query: args.query,
    gid: args.gid,
  };
  if (args.applyExclusions) {
    const keep = new Set(args.keepCategories ?? []);
    params.excludedCategories = await compressArg(
      excludedCategories.filter((c) => !keep.has(c)).join(","),
    );
    params.excludeFreeTextCategories = "true";
    params.excludeUncategorizedTerms = "true";
    params.excludedTerms = await compressArg(excludedTerms.join(","));
  }
  // Renamed fields coalesced HERE, at the one adapter for this route.
  const r = await apiGet<PaginatedResponse<WireCategory>>(
    `${BASE}/datasets/categories`,
    { params, signal },
  );
  return {
    ...r,
    data: (r.data ?? []).map(normalizeCategory),
  } as PaginatedResponse<Category>;
}

export interface AnnotationsByCategoryArgs {
  category: string;
  query?: string;
  filter: string[][];
  limit?: number;
  excludeFreeText?: boolean;
  applyExclusions: boolean;
  gid?: string;
}

export async function getAnnotationsByCategory(args: AnnotationsByCategoryArgs, signal?: AbortSignal) {
  const compressed = await compressFilter(args.filter);
  const params: Params = {
    category: args.category,
    filter: compressed,
    limit: args.limit ?? 200,
    exclude: ["parentTerms"],
    retainMentionedTerms: true,
    query: args.query,
    gid: args.gid,
  };
  if (args.applyExclusions) {
    params.excludedTerms = await compressArg(excludedTerms.join(","));
    if (args.excludeFreeText) params.excludeFreeTextTerms = "true";
  }
  // Renamed fields coalesced HERE, at the one adapter for this route.
  const r = await apiGet<PaginatedResponse<WireAnnotationTerm>>(
    `${BASE}/datasets/annotations`,
    { params, signal },
  );
  return {
    ...r,
    data: (r.data ?? []).map(normalizeAnnotationTerm),
  } as PaginatedResponse<AnnotationTerm>;
}

export interface PlatformsArgs {
  query?: string;
  filter: string[][];
  limit?: number;
  gid?: string;
}

/** Full platform catalog — the Platforms page's primary fetch.
 *  Distinct from ``getPlatforms`` above which returns the platform-
 *  filter facet on the dataset Browser (counts per platform within
 *  the current filter context). This one returns the platform list
 *  itself with all metadata for browsing / filtering by manufacturer
 *  / technology type / taxon / status.
 *
 *  Gemma REST caps ``limit`` at 100 per call (caught 2026-05-17 with
 *  a 400 from limit=500). Catalogue is ~670 records, so we page
 *  internally: first call gets page 0 + ``totalElements``; remaining
 *  pages fire in parallel, then concatenate. Single round-trip
 *  latency, no UI paging. */
export interface AllPlatformsArgs {
  query?: string;
  filter?: string[][];
  sort?: string;
}

const PLATFORM_PAGE_SIZE = 100; // server cap

async function fetchPlatformPage(
  offset: number,
  args: AllPlatformsArgs,
  signal?: AbortSignal,
): Promise<PaginatedResponse<Platform>> {
  const compressed = await compressFilter(args.filter ?? []);
  const params: Params = {
    query: args.query,
    filter: compressed,
    sort: args.sort,
    offset,
    limit: PLATFORM_PAGE_SIZE,
  };
  return apiGet<PaginatedResponse<Platform>>(`${BASE}/platforms`, {
    params,
    signal,
  });
}

/** Element (probe) count for a single platform — one HEAD-style
 *  call that only reads ``totalElements``. Used for lazy-load of the
 *  expanded platform row; not part of the catalogue fetch because
 *  670 × this would be expensive.
 *
 *  Gemma has no equivalent /genes endpoint at the platform level
 *  today — element count is the closest probe-density signal we can
 *  surface without a backend addition. */
export async function getPlatformElementCount(
  platformId: number,
  signal?: AbortSignal,
): Promise<number> {
  const r = await apiGet<PaginatedResponse<unknown>>(
    `${BASE}/platforms/${platformId}/elements`,
    { params: { limit: 1 }, signal },
  );
  return r.totalElements ?? 0;
}

/**
 * The platform(s) a dataset was run on.
 *
 * Used to turn a heatmap row's design-element id into a link to that
 * probe's page, which is addressable only as platform + element (see
 * ``getPlatformElement``). A dataset on exactly one platform makes
 * that unambiguous; on several, a row's design element could belong to
 * any of them and the payload doesn't say which, so callers should
 * decline to link rather than guess.
 */
export async function getDatasetPlatforms(
  datasetId: number | string,
  signal?: AbortSignal,
): Promise<Platform[]> {
  const r = await apiGet<PaginatedResponse<Platform>>(
    `${BASE}/datasets/${datasetId}/platforms`,
    { signal },
  );
  return r.data ?? [];
}

/**
 * The platform(s) a dataset's data was ORIGINALLY submitted on, before
 * Gemma switched it onto something else — for sequencing, typically a
 * generic gene-list platform.
 *
 * A LIST: a dataset's assays need not all have come from one submitted
 * platform. **Empty means nothing was switched**, never "we don't
 * know" — a recorded original that equals the platform in use is a
 * no-op and is excluded server-side, so a non-empty answer always
 * names something that actually changed.
 *
 * Costs one small request. Reading this used to mean pulling the whole
 * assay list, since per-assay serialization was the only route to it.
 */
export async function getDatasetOriginalPlatforms(
  datasetId: number | string,
  signal?: AbortSignal,
): Promise<Platform[]> {
  const r = await apiGet<PaginatedResponse<Platform>>(
    `${BASE}/datasets/${datasetId}/platforms?original=true`,
    { signal },
  );
  return r.data ?? [];
}

/** Single platform's full entity — used by PlatformDetailPage. */
export async function getPlatformById(
  id: number | string,
  signal?: AbortSignal,
): Promise<Platform> {
  return apiGet<Platform>(`${BASE}/platforms/${id}`, { signal });
}

/** Platform-by-shortName resolver — the detail page is keyed on
 *  shortName for stable URLs (GPL96, etc.) but the entity lookup
 *  needs a numeric id. Cheapest path is a one-row filter query
 *  against /platforms; the API supports ``filter=shortName=GPL96``. */
export async function getPlatformByShortName(
  shortName: string,
  signal?: AbortSignal,
): Promise<Platform | null> {
  const r = await apiGet<PaginatedResponse<Platform>>(`${BASE}/platforms`, {
    params: {
      filter: `shortName = ${shortName}`,
      limit: 1,
      // Gene-mapping counts are expensive (~1.7s on the largest
      // platform), so they are opt-in and read from a generated report
      // rather than computed per request. One platform, one page —
      // worth asking for. Null comes back when no report exists yet.
      withGeneCounts: true,
    },
    signal,
  });
  return r.data[0] ?? null;
}

/** Probe / element list for a platform, paginated. The catalogue
 *  page lazy-counts via ``getPlatformElementCount``; the detail
 *  page uses this for the inline element explorer. */
export interface PlatformElement {
  id: number;
  name: string;
  description?: string | null;
  /** Raw probe sequence, present only when the listing was asked for
   *  it (`withSequence`). Null for elements that carry none — a gene
   *  -list pseudoplatform has no oligos to report. */
  sequence?: string | null;
  sequenceLength?: number | null;
  /** Genes this element maps to, present only when the listing asked
   *  (`withGenes`). `[]` means "maps to nothing", which is a different
   *  claim from the field being absent because nobody asked. */
  genes?: ElementGene[] | null;
  /** The platform this element belongs to. Always served, but only
   *  worth reading when the element was fetched on its own — inside a
   *  platform's listing it is the platform you already have. */
  arrayDesign?: { id: number; shortName?: string | null; name?: string | null } | null;
}

export interface ElementGene {
  id: number;
  officialSymbol?: string | null;
  ncbiId?: number | null;
}

/**
 * One BLAT alignment behind a probe, as `mappingSummary` reports it.
 *
 * `identity` and `score` are FRACTIONS (0–1), and they live on
 * `blatResult` rather than a level up. Chromosome names include alt
 * contigs (`6_GL000253v2_alt`), which is why a probe on the primary
 * assembly often reports several alignments that are all the same
 * locus.
 */
export interface GeneMappingSummary {
  blatResult?: {
    targetChromosomeName?: string | null;
    targetStart?: number | null;
    targetEnd?: number | null;
    /** A plain label ("human"), NOT the assembly. The genome build is
     *  `taxon.externalDatabase.name` ("hg38"), which is what a genome
     *  browser needs. */
    targetDatabase?: string | null;
    taxon?: {
      commonName?: string | null;
      scientificName?: string | null;
      externalDatabase?: { name?: string | null } | null;
    } | null;
    strand?: string | null;
    identity?: number | null;
    score?: number | null;
    /** The probe's own biological sequence — what was BLATed. This is
     *  the only place REST publishes the sequence's *metadata* (type,
     *  name, description, accession, taxon); the elements listing
     *  carries the bases and length alone.
     *
     *  Consequence worth knowing: it rides on an alignment, so a probe
     *  with no alignments has none of it. See ``probeSequenceInfo``. */
    querySequence?: BioSequenceInfo | null;
  } | null;
  genes?: ElementGene[] | null;
}

/** Gemma's BioSequence as REST serializes it inside a BLAT result.
 *  Mirrors the fields the legacy probe page shows. */
export interface BioSequenceInfo {
  id?: number;
  name?: string | null;
  description?: string | null;
  /** Free-text enum, e.g. ``AFFY_COLLAPSED`` / ``DNA`` / ``mRNA``. */
  type?: string | null;
  /** Full length of the biological sequence, which can exceed the
   *  length of the ``sequence`` string actually served. */
  length?: number | null;
  sequence?: string | null;
  fractionRepeats?: number | null;
  sequenceDatabaseEntry?: {
    accession?: string | null;
    externalDatabase?: { name?: string | null } | null;
  } | null;
  taxon?: { commonName?: string | null; scientificName?: string | null } | null;
}

/** The sequence metadata for a probe, pulled off whichever alignment
 *  carries it.
 *
 *  Every alignment of one probe shares a query sequence, so the first
 *  one that has it is the answer — but a probe with zero alignments
 *  has zero copies of it, and then only the bases (from the elements
 *  listing) are available. Returns null in that case rather than an
 *  empty shell, so the caller can say "not recorded" honestly. */
export function probeSequenceInfo(
  summaries: GeneMappingSummary[],
): BioSequenceInfo | null {
  for (const s of summaries) {
    const qs = s.blatResult?.querySequence;
    if (qs) return qs;
  }
  return null;
}

export interface PlatformElementsArgs {
  offset?: number;
  limit?: number;
  /** Probe-name search. See `elementNameFilter` for why this is not
   *  simply `name like '%q%'`. */
  query?: string;
  /** Gene search — official symbol, alias, older symbol or NCBI id.
   *  Resolved server-side through the search service and scoped to the
   *  platform's own taxon. Matches no gene ⇒ empty page, never the
   *  unfiltered listing. */
  gene?: string;
}

/**
 * The `filter` clause for a probe-name search.
 *
 * `like` is a PREFIX match, and it escapes any wildcard you supply — so
 * `%1007%` searches for a literal percent sign and returns nothing
 * (measured, still true on `e6d6d6a055`). Wildcards are stripped rather
 * than passed through; there is no substring search to be had.
 *
 * A value containing `_` used to match nothing at all, because the
 * single-character SQL wildcard was escaped without an `escape` clause
 * — which made every Affymetrix probe name unsearchable, since nearly
 * all of them carry one. This function cut names back to their first
 * segment to work around it. Fixed server-side in `e6d6d6a055`
 * (2026-08-22) across every filtered endpoint, so the workaround is
 * gone and a full name is searched as typed: `name like 1007_s_at`
 * returns that probe.
 *
 * The value goes through `quoteIfNecessary`, the same quoter every
 * other clause in the app uses. Emitting it bare 400d the moment the
 * query held a space, a paren or a comma — `name like foo bar` is a
 * parse error, `name like "foo bar"` is not — and the elements section
 * has no error branch, so a two-word search either read as "No probes
 * match" or left the previous page's rows sitting there.
 */
export function elementNameFilter(query: string): string {
  // `%` is the one character still stripped rather than quoted: the
  // server escapes it into a literal percent sign, so passing one
  // through can only produce a confusing zero. Quotes are no longer
  // stripped — the grammar escapes them, and altering what someone
  // typed is worse than searching for it.
  return `name like ${quoteIfNecessary(query.trim().replace(/%/g, ""))}`;
}

/** Datasets-on-this-platform — paginated. Goes through the standard
 *  /rest/v2/datasets filter syntax (same shape the Browser uses for
 *  its platform facet). Server caps ``limit`` at 100. */
export interface DatasetsByPlatformArgs {
  offset?: number;
  limit?: number;
  sort?: string;
}

export async function getDatasetsByPlatform(
  shortName: string,
  args: DatasetsByPlatformArgs = {},
  signal?: AbortSignal,
) {
  const params: Params = {
    filter: `bioAssays.arrayDesignUsed.shortName = ${shortName}`,
    offset: args.offset ?? 0,
    limit: args.limit ?? 50,
    sort: args.sort,
  };
  return apiGet<PaginatedResponse<Dataset>>(`${BASE}/datasets`, { params, signal });
}

export async function getPlatformElements(
  platformId: number | string,
  args: PlatformElementsArgs = {},
  signal?: AbortSignal,
): Promise<PaginatedResponse<PlatformElement>> {
  const params: Params = {
    offset: args.offset ?? 0,
    limit: args.limit ?? 50,
    // Sequences and genes come down with the page rather than per
    // expanded row. The server warns sequences inflate a full 22k
    // -element response by ~1 MB, which is why they are opt-in — but a
    // page is 50 rows, so it costs ~15 KB and saves a request every
    // time a row opens. Genes are one batch query per page against the
    // denormalized GENE2CS table, not 50 round-trips.
    withSequence: true,
    withGenes: true,
  };
  if (args.gene && args.gene.trim()) {
    params.gene = args.gene.trim();
  } else if (args.query && args.query.trim()) {
    params.filter = elementNameFilter(args.query);
  }
  return apiGet<PaginatedResponse<PlatformElement>>(
    `${BASE}/platforms/${platformId}/elements`,
    { params, signal },
  );
}

/**
 * One element (probe) on a platform, with its sequence and gene
 * mappings — the standalone probe page's primary fetch.
 *
 * Addressed by element ID, not name. Probe names routinely contain a
 * slash (``AFFX-HUMISGF3A/M97935_MA_at``) and an encoded slash in a
 * path segment 404s, so a name-addressed call fails for exactly the
 * probes most worth looking at.
 *
 * The ``platform`` segment takes a numeric id OR a short name
 * (``GPL96``) — both resolve server-side, which is what lets the probe
 * route stay keyed on the short name like the platform route is. It is
 * NOT optional and NOT ignored: there is no top-level probe endpoint,
 * and a mismatched pair answers 200 with an empty list rather than
 * 404, since the id is applied as a filter under the platform.
 *
 * The endpoint returns a one-row collection; null means the pair
 * doesn't resolve.
 */
export async function getPlatformElement(
  platform: number | string,
  elementId: number,
  signal?: AbortSignal,
): Promise<PlatformElement | null> {
  const r = await apiGet<PaginatedResponse<PlatformElement>>(
    `${BASE}/platforms/${platform}/elements/${elementId}`,
    { params: { withSequence: true, withGenes: true }, signal },
  );
  return r.data?.[0] ?? null;
}

/** Genes mapped to a single platform element (probe). The relation
 *  is many-to-many; we paginate up to a reasonable limit since most
 *  probes map to 1–3 genes. Returns the rich Gene shape: official
 *  symbol, name, NCBI / Ensembl ids, aliases, taxon. */
export interface MappedGene {
  id: number;
  officialSymbol?: string;
  officialName?: string;
  ncbiId?: number;
  ensemblId?: string;
  aliases?: string[];
  taxon?: { commonName?: string; scientificName?: string };
  ncbiUri?: string;
}

/**
 * BLAT alignments behind one probe — where it lands on the genome and
 * which genes that supports.
 *
 * Addressed by element ID, not name: probe names routinely contain a
 * slash (`AFFX-HUMISGF3A/M97935_MA_at`) and an encoded slash in a path
 * segment 404s, so a name-addressed call fails for exactly the probes
 * that are most interesting.
 *
 * This returned [] on every probe when it was first wired: the endpoint
 * answered 200 but omitted `geneMappingSummaries` entirely, because the
 * field was computed on each request and then dropped by an
 * `@JsonIgnore` predating the endpoint. Fixed server-side on
 * `9f8e063748` (2026-08-22) and populated since — GPL96 `1007_s_at`
 * reports five alignments, one on chromosome 6 and four on alt contigs
 * of the same locus. `[]` now means what it says.
 */
export async function getElementAlignments(
  platformId: number | string,
  elementId: number,
  signal?: AbortSignal,
): Promise<GeneMappingSummary[]> {
  const r = await apiGet<{ data?: { geneMappingSummaries?: GeneMappingSummary[] } }>(
    `${BASE}/platforms/${platformId}/elements/${elementId}/mappingSummary`,
    { signal },
  );
  return r.data?.geneMappingSummaries ?? [];
}

/**
 * Gene records by NCBI id, in one request.
 *
 * `withGenes` on the elements listing carries `{id, officialSymbol,
 * ncbiId}` and deliberately not the name — it is a compact column, and
 * hydrating gene entities per row is what it exists to avoid. But a
 * symbol alone doesn't say what the gene IS, so the listing resolves
 * the names for the page it is showing: one call for the distinct
 * genes on screen, not one per row.
 *
 * 🛑 **NCBI ids, not Gemma's internal ones.** `/genes/{genes}` matches
 * "gene identifiers": `/genes/23635` returns SSBP2, while
 * `/genes/245694` — SSBP2's own `id` on every other payload — returns
 * nothing at all rather than erroring. Passing a symbol works too and
 * is worse: `/genes/SSBP2` returns three rows across species. The
 * returned records carry both, so the caller keys the result by `id`.
 */
export async function getGenesByNcbiIds(
  ncbiIds: number[],
  signal?: AbortSignal,
): Promise<MappedGene[]> {
  if (ncbiIds.length === 0) return [];
  const r = await apiGet<PaginatedResponse<MappedGene>>(
    `${BASE}/genes/${ncbiIds.join(",")}`,
    { signal },
  );
  return r.data ?? [];
}

export async function getElementGenes(
  platformId: number | string,
  elementId: number,
  signal?: AbortSignal,
): Promise<MappedGene[]> {
  const r = await apiGet<PaginatedResponse<MappedGene>>(
    `${BASE}/platforms/${platformId}/elements/${elementId}/genes`,
    { params: { limit: 50 }, signal },
  );
  return r.data;
}

/* ----------------------------------------------------------------
 * Backend gaps — surface here so future hands can find them.
 *
 * Filed 2026-05-17 against the Gemma REST API:
 *
 *  1. **Search elements by gene symbol/alias.**
 *     Today: /platforms/{id}/elements only filters by element name
 *     (probe id). Curators searching "BRCA1" find no probes
 *     because none are *named* BRCA1.
 *     Want: a `gene=BRCA1` (or `geneSymbol like 'BRCA1'`) filter
 *     that returns probes mapped to that gene.
 *
 *  2. **Gene info on the bulk element list.**
 *     Today: bulk list returns {id, name, description}; gene info
 *     requires N additional /elements/{id}/genes calls per page.
 *     For 50 rows that's 50 round-trips just to show a gene column.
 *     Want: include a compact gene array
 *     (`{officialSymbol, ncbiId}[]`) on the bulk list, opt-in via
 *     `include=genes`.
 *
 *  3. **Probe oligonucleotide sequence.**
 *     The legacy Gemma UI shows the probe sequence (~25–60bp). Not
 *     reachable from REST today. Want a `sequence` field on the
 *     element entity, or a `/elements/{id}/sequence` endpoint.
 *
 *  4. **Genome alignment / BLAT info.**
 *     Legacy UI shows where the probe aligns on the genome
 *     (chromosome, coordinates, alignment quality). Not in REST.
 *     Want a `/elements/{id}/alignments` returning
 *     `[{chr, start, end, strand, score, unique}]`.
 *
 *  Until those land the UI mocks (1)–(4) with clear "stub" badges
 *  so the curator knows the data isn't real.
 * ---------------------------------------------------------------- */

export async function getAllPlatforms(
  args: AllPlatformsArgs = {},
  signal?: AbortSignal,
): Promise<PaginatedResponse<Platform>> {
  const first = await fetchPlatformPage(0, args, signal);
  const total = first.totalElements ?? first.data.length;
  if (total <= PLATFORM_PAGE_SIZE) return first;
  const pageCount = Math.ceil(total / PLATFORM_PAGE_SIZE) - 1;
  const more = await Promise.all(
    Array.from({ length: pageCount }, (_, i) =>
      fetchPlatformPage((i + 1) * PLATFORM_PAGE_SIZE, args, signal),
    ),
  );
  return {
    ...first,
    data: [...first.data, ...more.flatMap((p) => p.data)],
    offset: 0,
    limit: total,
  };
}

export async function getPlatforms(args: PlatformsArgs, signal?: AbortSignal) {
  const mFilter = args.filter
    .map((c) => c.filter((sc) => !sc.startsWith("bioAssays.arrayDesignUsed.") && !sc.startsWith("bioAssays.originalPlatform.")))
    .filter((c) => c.length > 0);
  const compressed = await compressFilter(mFilter);
  const params: Params = {
    filter: compressed,
    limit: args.limit ?? 200,
    query: args.query,
    gid: args.gid,
  };
  return apiGet<PaginatedResponse<Platform>>(`${BASE}/datasets/platforms`, { params, signal });
}

export interface TaxaArgs {
  query?: string;
  filter: string[][];
  gid?: string;
}

export async function getTaxa(args: TaxaArgs, signal?: AbortSignal) {
  const mFilter = args.filter
    .map((c) => c.filter((sc) => !sc.startsWith("taxon.")))
    .filter((c) => c.length > 0);
  const compressed = await compressFilter(mFilter);
  const params: Params = {
    filter: compressed,
    query: args.query,
    gid: args.gid,
  };
  return apiGet<PaginatedResponse<Taxon>>(`${BASE}/datasets/taxa`, { params, signal });
}

export async function getMyself(signal?: AbortSignal): Promise<User | null> {
  try {
    const r = await apiGet<{ data?: User; error?: { code?: number } }>(`${BASE}/users/me`, { signal });
    if (r.error?.code === 401) return null;
    return r.data ?? null;
  } catch (e) {
    // 401 ⇒ not logged in, not an error
    if (e && typeof e === "object" && "status" in e && (e as { status: number }).status === 401) {
      return null;
    }
    throw e;
  }
}

/** One annotation row as `/datasets/{id}/annotations` serves it, before
 *  this adapter puts it back into `DatasetAnnotation`'s vocabulary. The
 *  rename, and why all three routes coalesce rather than re-type, is
 *  documented once at "the four renamed annotation fields" above. */
interface WireDatasetAnnotation extends Partial<DatasetAnnotation> {
  category?: string | null;
  categoryUri?: string | null;
  value?: string | null;
  valueUri?: string | null;
}

/**
 * A dataset's annotations — every one of them.
 *
 * 🛑 **`includeFreeText=true` is sent deliberately, and it is the only
 * parameter this route accepts.** On an older Gemma, omitting it drops
 * every UNGROUNDED annotation, and an omitted row is indistinguishable
 * from an absent one: measured on eid 38390, 4 rows by default and 5
 * with the flag, the fifth a `strain` stored since the original load
 * with a null `valueUri`. A curator hunted that tag on two Gemma sites
 * and concluded it had been invented.
 *
 * 2.9.4 no longer needs asking — the same eid returns all 16 rows,
 * ungrounded `strain` included, flag or no flag (measured 2026-08-31).
 * The parameter is still declared on the route, so keep sending it:
 * it is what makes the response correct against the older builds the
 * dev proxy can still be pointed at, and it is a no-op against a
 * current one.
 *
 * Ungrounded terms are real annotations and belong on the page (Paul,
 * 2026-08-31); they simply are not clickable filters, which
 * `isSelectable` already handles by requiring the term to be in the
 * available-annotation tree.
 */
export async function getDatasetAnnotations(datasetId: number, signal?: AbortSignal) {
  const r = await apiGet<PaginatedResponse<WireDatasetAnnotation>>(
    `${BASE}/datasets/${datasetId}/annotations`,
    { params: { includeFreeText: true }, signal },
  );
  return {
    ...r,
    data: (r.data ?? []).map(normalizeDatasetAnnotation),
  } as PaginatedResponse<DatasetAnnotation>;
}

/** Exported for test. */
export function normalizeDatasetAnnotation(
  a: WireDatasetAnnotation,
): DatasetAnnotation {
  return {
    objectClass: a.objectClass ?? "",
    className: a.category ?? a.className ?? "",
    classUri: a.categoryUri ?? a.classUri ?? null,
    termName: a.value ?? a.termName ?? "",
    // 🛑 Null here is the whole point of the flag above: it is what an
    // ungrounded annotation looks like, not a missing field. The chip
    // renders it as "free text" and it stays unclickable.
    termUri: a.valueUri ?? a.termUri ?? null,
  };
}

/** Single dataset by id (numeric id) or short-name (e.g. "GSE12345"). The
 *  REST endpoint accepts both forms and returns a paged response with at
 *  most one element. */
export async function getDatasetById(
  idOrShortName: number | string,
  signal?: AbortSignal,
): Promise<Dataset | null> {
  const r = await apiGet<PaginatedResponse<Dataset>>(
    `${BASE}/datasets/${idOrShortName}`,
    { signal },
  );
  return r.data?.[0] ?? null;
}

/**
 * Does this query use a boolean operator? Uppercase only — `cell or`
 * is a plain text search and comes back 200.
 *
 * Whole words: a query for `ANDROGEN` or `NOTCH` is not using an
 * operator, and must not be told that it is.
 */
const BOOLEAN_OPERATOR = /(?:^|\s)(?:AND|OR|NOT)(?:\s|$)/;

/**
 * What to tell someone when an annotation search fails.
 *
 * The point of this is the FIRST half — the server's own sentence. Both
 * search surfaces used to render a failed search and an empty one
 * identically, so a query that blew up looked exactly like a term that
 * is not in the corpus, and only one of those is true.
 *
 * The second half is a hint, and it is deliberately hedged, because
 * measuring the deployed endpoint (gemma2 `38c877d85b`, 2026-08-26)
 * does NOT support the tidier story that capitals are the bug:
 *
 *   cell OR neuron    200      normal OR brain     400
 *   cell OR normal    200      tumour OR normal    400
 *   tumour OR brain   200      zqx OR neuron       400
 *   cell OR           400      NOT cell            400
 *
 * Capitalised operators are usually FINE; whether a query parses
 * depends on the operands, and the rule is the backend's business, not
 * ours. So this does not claim a cause. It also does not tell anyone to
 * lowercase: `normal or brain` is a 200 with ZERO hits, which trades a
 * visible error for a silently empty result — worse, not better.
 *
 * "One term at a time" is advice that demonstrably works: `tumour` and
 * `normal` each return hits on their own.
 *
 * The hint is withheld when the query used no operator at all, so an
 * unrelated 400 does not get an operator explanation bolted onto it.
 * Every 400 observed above does contain one — malformed syntax without
 * an operator (`cell(`, `"cell`, `cell^`) is sanitised server-side and
 * answers 200 — so today this suppresses nothing; it is there so a new
 * class of 400 is not misdiagnosed.
 *
 * Sibling of the curation app's `annotationSearchMessage`. Kept
 * per-app rather than promoted: same failure, different vocabulary for
 * different readers, and one string helper is not worth a shared
 * package.
 */
export function annotationSearchMessage(err: unknown, query?: string): string {
  if (err instanceof ApiError) {
    if (err.status === 400) {
      const detail = err.detail || "Invalid search query.";
      // Undefined query = caller has no context to offer; keep the hint
      // rather than silently dropping it.
      const usedOperator = query === undefined || BOOLEAN_OPERATOR.test(query);
      return usedOperator
        ? `${detail} — AND, OR and NOT are search operators here, and not every combination parses. Try one term at a time.`
        : detail;
    }
    return err.detail || err.message;
  }
  return err instanceof Error ? err.message : "Search failed.";
}

/**
 * Free-text search over the full ontology — used as a fallback when
 * the local AnnotationSelector tree is capped at 200 terms per
 * category and the user types something not in that window. Results
 * surface as "more matches"; the click-to-add path attaches the term
 * to filters, after which counts update via the normal dataset query.
 *
 * ``rank=composite`` reorders by token coverage with corpus usage as a
 * secondary signal, rather than by the Lucene tf-idf default. Without
 * it a term is buried under its own prefix matches: measured on gemma2
 * 2026-08-22, ``aspirin`` returns ``aspirin-triggered resolvin …`` rows
 * (usageCount 0) ahead of ``acetylsalicylic acid`` (usageCount 9),
 * which lands 16th of 20. Under ``composite`` it is 2nd. Ranking
 * matters more here than anywhere else: this list exists to add a term
 * to a FILTER, and a term with no datasets behind it filters the
 * result set to nothing.
 *
 * ``composite`` rather than ``rank=usage``, which this started as and
 * which the curation picker dropped on 2026-08-13 — see the measured
 * comment in ``apps/curation/src/api/annotations.ts``. Usage alone is
 * closer to a partition (used terms first) than a ranking, and it does
 * not even win the duplicate-label case it exists for: of the three
 * terms labelled ``dorsal root ganglion``, both lucene and usage lead
 * with the one used once, and only composite leads with the one used
 * 236 times.
 *
 * Every strategy reorders the same candidate set, and ``limit``
 * truncates AFTER reordering — so this changes which terms are visible
 * at all, not just their order. Older servers ignore the parameter and
 * fall back to Lucene ordering.
 *
 * The doc comment here once claimed the endpoint "does not carry
 * per-experiment counts in our corpus (usageCount tends to be 0)",
 * which was the stated reason no ranking parameter was ever sent. It
 * does not hold — the counts are populated, and they are what pulls
 * the useful term up.
 */
export async function searchAnnotations(
  query: string,
  limit = 30,
  signal?: AbortSignal,
): Promise<AnnotationSearchResult[]> {
  const r = await apiGet<{ data?: AnnotationSearchResult[] }>(
    `${BASE}/annotations/search`,
    { params: { query, limit, rank: "composite" }, signal },
  );
  return r.data ?? [];
}

export async function getOpenApiSpec(signal?: AbortSignal) {
  return apiGet<{
    components?: {
      schemas?: {
        FilterArgExpressionExperiment?: {
          "x-gemma-filterable-properties"?: Array<{
            name: string;
            allowedValues?: Array<{ value: string; label: string }>;
          }>;
        };
      };
    };
  }>(`${BASE}/openapi.json`, { signal });
}

// ─── Dataset detail endpoints ─────────────────────────────────────────────────

import type {
  ExperimentalDesign,
  BioAssay,
  Publication,
  PipelineStatus,
  DiffExAnalysis,
  DiffExResultSet,
  DiffExpressionResponse,
  PvalueDistribution,
  SvdResult,
  SampleCorrelationMatrix,
  MeanVarianceData,
  QuantitationType,
} from "@/lib/types";

export async function getDatasetDesign(
  id: number | string,
  signal?: AbortSignal,
): Promise<ExperimentalDesign | null> {
  const r = await apiGet<{ data?: ExperimentalDesign }>(`${BASE}/datasets/${id}/design`, {
    signal,
    // Request JSON explicitly — endpoint also serves TSV.
    headers: { Accept: "application/json" },
  });
  return r.data ?? null;
}

export async function getDatasetSamples(
  id: number | string,
  signal?: AbortSignal,
): Promise<BioAssay[]> {
  const r = await apiGet<{ data?: BioAssay[] }>(`${BASE}/datasets/${id}/samples`, { signal });
  return r.data ?? [];
}

export async function getDatasetQuantitationTypes(
  id: number | string,
  signal?: AbortSignal,
): Promise<QuantitationType[]> {
  const r = await apiGet<{ data?: QuantitationType[] }>(
    `${BASE}/datasets/${id}/quantitationTypes`,
    { signal },
  );
  return r.data ?? [];
}

export async function getDatasetPublications(
  id: number | string,
  signal?: AbortSignal,
): Promise<Publication[]> {
  const r = await apiGet<{ data?: Publication[] }>(`${BASE}/datasets/${id}/publications`, { signal });
  return r.data ?? [];
}

export async function getDatasetPipelineStatus(
  id: number | string,
  signal?: AbortSignal,
): Promise<PipelineStatus | null> {
  const r = await apiGet<{ data?: PipelineStatus }>(`${BASE}/datasets/${id}/pipelineStatus`, { signal });
  return r.data ?? null;
}

export async function getDatasetDiffExAnalyses(
  id: number | string,
  signal?: AbortSignal,
): Promise<DiffExAnalysis[]> {
  const r = await apiGet<{ data?: DiffExAnalysis[] }>(
    `${BASE}/datasets/${id}/analyses/differential`,
    { signal },
  );
  return r.data ?? [];
}

/**
 * List the differential-expression result sets for a dataset. Each
 * row carries an `id` we can hit at `/resultSets/{id}` (with
 * `Accept: text/tab-separated-values`) to download the per-gene
 * stats TSV.
 *
 * We hit `/resultSets?datasets={id}` directly rather than the
 * canonical `/datasets/{id}/analyses/differential/resultSets` —
 * the latter 302-redirects to the same query-string form, but the
 * server emits the Location header as an absolute Gemma-host URL.
 * `fetch` follows the redirect cross-origin, escapes the Vite proxy,
 * and trips CORS (the remote Gemma host doesn't allow `localhost:5183`).
 * Using the
 * destination URL directly keeps the request on the proxy and
 * dodges the redirect entirely.
 */
export async function getDatasetResultSets(
  id: number | string,
  signal?: AbortSignal,
): Promise<DiffExResultSet[]> {
  const r = await apiGet<{ data?: DiffExResultSet[] }>(
    `${BASE}/resultSets`,
    { params: { datasets: String(id) }, signal },
  );
  return r.data ?? [];
}

/** Absolute(ish) URL for a dataset's expression matrix TSV download.
 *  The server emits `Content-Disposition: attachment; filename=...`,
 *  so a plain `<a href>` triggers a real download — no JS needed. */
export function datasetDataDownloadUrl(
  id: number | string,
  kind: "processed" | "raw" = "processed",
  opts?: { filter?: boolean },
): string {
  const path =
    kind === "raw"
      ? `${BASE}/datasets/${id}/data/raw`
      : `${BASE}/datasets/${id}/data`;
  const filter = opts?.filter ?? true;
  return kind === "raw" ? path : `${path}?filter=${filter ? "true" : "false"}`;
}

/**
 * Fetch a result-set as TSV and trigger a browser download.
 *
 * Why JS-driven instead of a plain `<a href>`: the
 * `/resultSets/{id}` endpoint content-negotiates between JSON and
 * TSV, and the default `Accept` a browser sends on an `<a>` click
 * ranks `application/json` above `text/tab-separated-values` (the
 * server lists TSV at `q=0.9` while JSON is `q=1.0`). Without an
 * explicit `Accept` header the curator would download JSON. Fetching
 * with `Accept: text/tab-separated-values` forces the TSV branch;
 * we then synthesise an `<a download>` against an object URL to
 * surface the file under the curator's chosen filename.
 */
export async function downloadResultSetTsv(
  resultSetId: number,
  filename: string,
): Promise<void> {
  const r = await fetch(`${BASE}/resultSets/${resultSetId}`, {
    headers: { Accept: "text/tab-separated-values" },
  });
  if (!r.ok) {
    throw Object.assign(
      new Error(`Failed to download result set ${resultSetId}: HTTP ${r.status}`),
      { status: r.status },
    );
  }
  const blob = await r.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Defer the revoke so the click had a chance to start the
    // download; otherwise some browsers cancel the navigation
    // before the file lands.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  }
}

/**
 * Fetch the top-N differentially-expressed genes (by corrected
 * p-value) for one result set, with per-sample expression vectors.
 * Used by the inline heatmap on the Expression tab — the response
 * already contains everything the heatmap needs (gene labels +
 * per-sample values) and is constrained to the analysis's subset
 * (so a single-cell per-cell-type analysis returns only that
 * subset's samples).
 *
 * The `threshold` is applied on the corrected p-value before
 * sorting; pass a high threshold (e.g. 1) when you want the top
 * N by p-value regardless of significance.
 */
export async function getTopDiffExpressedGenes(
  datasetId: number | string,
  diffExSetId: number,
  opts: { threshold?: number; limit?: number } = {},
  signal?: AbortSignal,
): Promise<DiffExpressionResponse | null> {
  const params: Record<string, string> = {
    diffExSet: String(diffExSetId),
  };
  if (opts.threshold != null) params.threshold = String(opts.threshold);
  if (opts.limit != null) params.limit = String(opts.limit);
  const r = await apiGet<{ data?: DiffExpressionResponse[] }>(
    `${BASE}/datasets/${datasetId}/expressions/differential`,
    { params, signal },
  );
  // The endpoint returns a list keyed by dataset id; we always pass a
  // single dataset so the list is length 0 or 1. Flatten.
  const first = r.data?.[0];
  return first ?? null;
}

/**
 * Binned p-value histogram for a DE result set.
 * `GET /rest/v2/resultSets/{id}/pvalueDistribution?bins=20&column=raw`
 *
 * Returns ``null`` on 204 (result set has no p-values in the chosen
 * column) so callers can render an "—" empty state without an error.
 * 404 / 400 still throw via apiGet.
 */
export async function getPvalueDistribution(
  resultSetId: number,
  opts: { bins?: number; column?: "raw" | "corrected" } = {},
  signal?: AbortSignal,
): Promise<PvalueDistribution | null> {
  const params: Record<string, string> = {};
  if (opts.bins != null) params.bins = String(opts.bins);
  if (opts.column != null) params.column = opts.column;
  // ``apiGet`` throws on non-2xx; 204 has no body so we hit the
  // `r.json()` step which would fail. Use fetch directly so the
  // null-on-204 branch stays clean.
  const q = Object.keys(params).length
    ? "?" + new URLSearchParams(params).toString()
    : "";
  const r = await fetch(`${BASE}/resultSets/${resultSetId}/pvalueDistribution${q}`, {
    method: "GET",
    credentials: "include",
    signal,
    headers: {
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  if (r.status === 204) return null;
  if (!r.ok) {
    throw Object.assign(new Error(`GET pvalueDistribution → ${r.status}`), {
      status: r.status,
    });
  }
  const body = (await r.json()) as { data?: PvalueDistribution };
  return body.data ?? null;
}

export async function getDatasetSvd(
  id: number | string,
  signal?: AbortSignal,
): Promise<SvdResult | null> {
  try {
    const r = await apiGet<{ data?: SvdResult }>(`${BASE}/datasets/${id}/svd`, { signal });
    return r.data ?? null;
  } catch (e: unknown) {
    // 404 = no SVD computed yet; not an error worth surfacing
    if (e && typeof e === "object" && "status" in e && (e as { status: number }).status === 404) {
      return null;
    }
    throw e;
  }
}

/** Sample-correlation matrix for the Diagnostics row. 404 / 204 →
 *  null ("not yet computed" or endpoint not deployed on the current
 *  Gemma build; the card surfaces an empty-state instead of throwing). */
export async function getDatasetSampleCorrelation(
  id: number | string,
  signal?: AbortSignal,
): Promise<SampleCorrelationMatrix | null> {
  try {
    const r = await apiGet<{ data?: SampleCorrelationMatrix }>(
      `${BASE}/datasets/${id}/sample-correlation`,
      { signal },
    );
    return r.data ?? null;
  } catch (e: unknown) {
    if (e && typeof e === "object" && "status" in e) {
      const s = (e as { status: number }).status;
      if (s === 404 || s === 204) return null;
    }
    throw e;
  }
}

/** Per-probe mean / variance scatter. 404 / 204 → null, same
 *  rationale as ``getDatasetSampleCorrelation``. */
export async function getDatasetMeanVariance(
  id: number | string,
  signal?: AbortSignal,
): Promise<MeanVarianceData | null> {
  try {
    const r = await apiGet<{ data?: MeanVarianceData }>(
      `${BASE}/datasets/${id}/mean-variance`,
      { signal },
    );
    return r.data ?? null;
  } catch (e: unknown) {
    if (e && typeof e === "object" && "status" in e) {
      const s = (e as { status: number }).status;
      if (s === 404 || s === 204) return null;
    }
    throw e;
  }
}

// ─── Platform detail endpoints ────────────────────────────────────────────────

export async function getPlatformAnnotations(
  platformId: number | string,
  signal?: AbortSignal,
): Promise<AnnotationTerm[]> {
  const r = await apiGet<PaginatedResponse<AnnotationTerm>>(
    `${BASE}/platforms/${platformId}/annotations`,
    { params: { limit: 500 }, signal },
  );
  return r.data ?? [];
}

// ─── Gene endpoints ───────────────────────────────────────────────────────────

export interface Gene {
  id: number;
  officialSymbol?: string | null;
  officialName?: string | null;
  ncbiId?: number | null;
  ensemblId?: string | null;
  aliases?: string[] | null;
  taxon?: Taxon | null;
  ncbiUri?: string | null;
  description?: string | null;
}

export interface GeneLocation {
  chromosome?: string | null;
  strand?: string | null;
  nucleotideStart?: number | null;
  nucleotideEnd?: number | null;
  taxon?: Taxon | null;
}

export interface GoTerm {
  termUri?: string | null;
  term?: string | null;
  goId?: string | null;
  aspect?: string | null;
  definition?: string | null;
  evidence?: string | null;
}

export async function getGene(
  idOrSymbol: number | string,
  signal?: AbortSignal,
): Promise<Gene | null> {
  const r = await apiGet<PaginatedResponse<Gene>>(`${BASE}/genes/${idOrSymbol}`, { signal });
  return r.data?.[0] ?? null;
}

/** Resolve free-text gene input (symbol, official name, or a bare NCBI
 *  id) to a single NCBI gene id — the canonical key for the `/gene/ncbi`
 *  route. Gene symbols collide across taxa (human ENO2 / mouse Eno2 /
 *  rat Eno2), so a symbol never uniquely identifies a gene; the URL uses
 *  NCBI ids instead and resolution happens here, once, at search time.
 *
 *  - A purely numeric input is treated as an NCBI id and returned as-is
 *    (the backend resolves numeric `/genes/{id}` as an NCBI id).
 *  - Otherwise the input is run through the score-ranked gene search and
 *    the TOP-ranked hit's NCBI id wins (no taxon preference).
 *
 *  Returns `null` when nothing matches or the top hit carries no NCBI id. */
export async function resolveGeneNcbiId(
  query: string,
  options: { taxon?: string; signal?: AbortSignal } = {},
): Promise<number | null> {
  const { taxon, signal } = options;
  const q = query.trim();
  if (!q) return null;
  if (/^\d+$/.test(q)) return Number(q);

  // With a taxon, this is an exact symbol lookup and there's a
  // deterministic endpoint for it — no ranking, no limit, no way for
  // the answer to depend on how many rows were asked for.
  //
  // The ranked search is the wrong tool here and was actively unsafe:
  // /genes/search?query=Myc ranks rat first, so a mouse link resolved
  // to the rat gene, and adding taxon= didn't fix it because the limit
  // was applied upstream of the taxon filter (limit=1 → empty,
  // limit=3 → mouse). Both were fixed server-side; this avoids the
  // class rather than the instance.
  if (taxon) {
    const r = await apiGet<PaginatedResponse<Gene>>(
      `${BASE}/taxa/${encodeURIComponent(taxon)}/genes/${encodeURIComponent(q)}`,
      { signal },
    );
    return r.data?.[0]?.ncbiId ?? null;
  }

  // No taxon: free text from the gene search box, where ranking is
  // what the caller wants.
  const hits = await searchGenes(q, { limit: 1, signal });
  return hits[0]?.ncbiId ?? null;
}

/** Bulk symbol → gene lookup. ``/genes/{genes}`` takes a
 *  comma-separated list and resolves each entry as an NCBI id, an
 *  Ensembl id, or an official symbol — so one call covers a whole
 *  chart's worth of symbols.
 *
 *  A symbol is not unique across taxa (``Myc`` returns the human,
 *  mouse and rat genes), so callers that mean a particular species
 *  have to pick from the result by taxon.
 */
export async function getGenesBySymbols(
  symbols: string[],
  signal?: AbortSignal,
): Promise<Gene[]> {
  const list = symbols.map((x) => x.trim()).filter(Boolean);
  if (list.length === 0) return [];
  const r = await apiGet<PaginatedResponse<Gene>>(
    `${BASE}/genes/${encodeURIComponent(list.join(","))}`,
    { signal },
  );
  return r.data ?? [];
}

export async function getGeneLocations(
  geneId: number | string,
  signal?: AbortSignal,
): Promise<GeneLocation[]> {
  const r = await apiGet<PaginatedResponse<GeneLocation>>(
    `${BASE}/genes/${geneId}/locations`,
    { signal },
  );
  return r.data ?? [];
}

export async function getGeneGoTerms(
  geneId: number | string,
  signal?: AbortSignal,
): Promise<GoTerm[]> {
  const r = await apiGet<PaginatedResponse<GoTerm>>(
    `${BASE}/genes/${geneId}/goTerms`,
    { signal },
  );
  return r.data ?? [];
}

/** GO-term typeahead. Wraps Gemma's
 *  ``GET /annotations/search?query=&prefixes=GO_&limit=`` — the
 *  same Lucene search the broader ontology picker uses, narrowed
 *  to the GO namespace by URI-prefix filter. */
export async function searchGoTerms(
  query: string,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<AnnotationSearchResult[]> {
  const { limit = 20, signal } = options;
  const q = query.trim();
  if (!q) return [];
  const r = await apiGet<{ data?: AnnotationSearchResult[] }>(
    `${BASE}/annotations/search`,
    { params: { query: q, prefixes: "GO_", limit }, signal },
  );
  return r.data ?? [];
}

/** Normalise a GO term identifier into the CURIE form Gemma's
 *  ``/goTerms/{termUri}/genes`` endpoint accepts. Inputs we see in
 *  the wild:
 *    - ``http://purl.obolibrary.org/obo/GO_0001889`` (from
 *      ``/annotations/search``) → ``GO:0001889``
 *    - ``GO_0001889`` → ``GO:0001889``
 *    - ``GO:0001889`` (already CURIE) → unchanged
 *  Tomcat rejects the full PURL form when URL-encoded into the
 *  path (the double-encoded ``%2F`` slashes 400), so this MUST run
 *  before ``encodeURIComponent``. */
function toGoCurie(uri: string): string {
  const m = uri.match(/GO[_:](\d+)\s*$/);
  return m ? `GO:${m[1]}` : uri;
}

/** Genes annotated under a GO term. Paginated; ``totalElements``
 *  drives the "247 genes — refine or pick individually" hint. The
 *  caller's responsibility to pick individually rather than
 *  bulk-add — a top-level GO node can carry thousands of genes
 *  and the home page can't sensibly display all of them. */
export interface GoTermGenesPage {
  data: Gene[];
  totalElements: number;
  offset: number;
  limit: number;
}

export async function getGoTermGenes(
  termUri: string,
  options: {
    taxon?: string;
    offset?: number;
    limit?: number;
    propagate?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<GoTermGenesPage | null> {
  const { taxon, offset = 0, limit = 100, propagate = false, signal } = options;
  const params: Params = { offset, limit };
  if (taxon) params.taxon = taxon;
  if (propagate) params.propagate = "true";
  // Gemma's ``/goTerms/{termUri}/genes`` expects the CURIE form
  // (``GO:0001889``), not the full OBO PURL. The ``/annotations/search``
  // response gives us ``http://purl.obolibrary.org/obo/GO_0001889`` —
  // if we encode that whole URL into the path Tomcat rejects with a
  // 400 (refuses the deeply-encoded slashes). Convert PURL → CURIE
  // before encoding; pass through any URI that's already in CURIE
  // form.
  const curie = toGoCurie(termUri);
  try {
    const r = await apiGet<PaginatedResponse<Gene>>(
      `${BASE}/goTerms/${encodeURIComponent(curie)}/genes`,
      { params, signal },
    );
    return {
      data: r.data ?? [],
      totalElements: r.totalElements ?? 0,
      offset: r.offset ?? 0,
      limit: r.limit ?? limit,
    };
  } catch {
    return null;
  }
}

/** Free-text gene search (typeahead). Wraps Gemma's
 *  ``GET /rest/v2/genes/search?query=&taxon=&limit=`` — the agents side shipped
 *  this as a search-service-backed shim. Returns gene value objects
 *  ranked by search score. ``taxon`` is the common name
 *  (``"human"`` / ``"mouse"`` / ``"rat"``); pass to scope a dataset's
 *  visualisation picker to its own organism. */
export async function searchGenes(
  query: string,
  options: { taxon?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<Gene[]> {
  const { taxon, limit = 20, signal } = options;
  const q = query.trim();
  if (!q) return [];
  const params: Params = { query: q, limit };
  if (taxon) params.taxon = taxon;
  const r = await apiGet<PaginatedResponse<Gene>>(`${BASE}/genes/search`, {
    params,
    signal,
  });
  return r.data ?? [];
}

// ─── PCA / SVD loadings — used by the scree click-to-zoom popup ─────────────

export type PcLoadingsDirection = "both" | "positive" | "negative";

export interface PcLoadingsRow {
  /** Probe / design-element id. Gemma may emit null when the probe
   *  no longer resolves to a CompositeSequence. */
  designElementId?: number | null;
  /** Probe / design-element name. */
  designElementName?: string | null;
  /** Every gene this design element maps to — same object shape the
   *  heatmap-data rows carry, so both surfaces label rows through the
   *  one ``buildGeneRowLabel``. Empty / absent when the probe maps to
   *  no gene, which is common enough on older platforms to be worth
   *  a fallback rather than a blank row.
   *
   *  Replaced the flat ``geneSymbol`` / ``geneOfficialName`` /
   *  ``geneId`` / ``geneNcbiId`` fields when Gemma aligned this
   *  endpoint with heatmap-data (verified against frink 2026-08-25).
   *  Note there is no ``ncbiId`` on these — the gene-page link goes
   *  through the Gemma id. */
  genes?: HeatmapRowGene[];
  /** Loading on this PC. Sign is meaningful when direction != both. */
  loading: number;
}

export interface PcLoadings {
  /** 1-indexed PC. Mirrors the request. */
  pc: number;
  /** Top-N probe loadings (server caps at 500). */
  rows: PcLoadingsRow[];
  /** bioAssayId (stringified) → score on this PC. */
  bioAssayScores: Record<string, number>;
}

/** Top-loaded probes for a single PC, plus per-sample scores —
 *  enough to render a rank-1 projection heatmap (cell = loading[r] *
 *  score[c]). 404 means the SVDResult hasn't been computed for the
 *  dataset (returns null so the consumer renders an empty state
 *  instead of toasting). */
export async function getPcLoadings(
  datasetId: number | string,
  pc: number,
  options: {
    top?: number;
    direction?: PcLoadingsDirection;
    signal?: AbortSignal;
  } = {},
): Promise<PcLoadings | null> {
  const { top = 50, direction = "both", signal } = options;
  try {
    const r = await apiGet<{ data?: PcLoadings }>(
      `${BASE}/datasets/${datasetId}/svd/loadings`,
      { params: { pc, top, direction }, signal },
    );
    return r.data ?? null;
  } catch {
    return null;
  }
}

// ─── Heatmap-data (dataset visualisation) ─────────────────────────────────────

/** Wire shape returned by ``GET /datasets/{id}/heatmap-data``. Mirrors
 *  ``HeatmapDataValueObject`` on the Java side. Adapter ``adaptHeatmapWire``
 *  below normalises this into the shape ``@gemma/heatmap``'s
 *  ``HeatmapWidget`` consumes. */
export interface HeatmapWireResponse {
  datasetId: number;
  datasetShortName?: string;
  matrix: {
    // Gemma seems to be returning missing values as string "NaN"s when serializing
    // so we have to accept strings too
    values: Array<Array<number | string | null>>;
    encoding?: string;
    rowsCount: number;
    colsCount: number;
    quantitationType: {
      id?: number;
      name: string;
      isPreferred: boolean;
      isRatio: boolean;
      scale: string;
    };
  };
  rows: Array<{
    designElementId: number;
    designElementName: string;
    genes?: Array<{
      id: number;
      officialSymbol?: string | null;
      name?: string | null;
    }>;
    annotations?: Record<string, unknown>;
  }>;
  columns: Array<{
    bioAssayId: number;
    bioMaterialId: number;
    name: string;
    outlier: boolean;
    factorValueIds?: Record<string, number>;
  }>;
  factors?: Array<{
    factor: {
      id: number;
      name: string;
      type?: string;
      category?: string;
      categoryUri?: string | null;
      values?: Array<{
        id: number;
        isBaseline?: boolean;
        summary?: string;
      }>;
    };
  }>;
}

export interface HeatmapDataArgs {
  /** Selected gene NCBI ids / Gemma gene ids. The endpoint accepts
   *  any GeneArg-resolvable identifier; numeric ids are unambiguous. */
  genes?: Array<number | string>;
  /** Cap on samples — useful for very large single-cell experiments
   *  where the full matrix doesn't fit. */
  sampleSize?: number;
  /** Sub-set the matrix to a specific subSet id (filter the columns). */
  subSet?: number;
  /** Quantitation-type selector — a QT id or name. When omitted the
   *  server serves the dataset's processed QT (the default view). A
   *  non-processed QT is served from its raw vectors and still supports
   *  the genes / sampleSize selection modes. Admin-only in the UI: it
   *  lets curators eyeball alternate QTs against the same gene set. */
  quantitationType?: number | string;
  /** Outlier-masking toggle. Server default is ``true`` — assay columns
   *  flagged as outliers have their values masked to NaN. Pass ``false``
   *  to receive the stored expression values instead. Always effective
   *  for a non-processed QT (raw vectors); for the processed QT it's a
   *  no-op today (values are masked at creation). Admin-only knob. */
  maskOutliers?: boolean;
}

/** Fetch the heatmap matrix for a user-curated gene list on this
 *  dataset. Use cases:
 *    - "show me expression for BRCA1, TP53, MYC across all samples"
 *    - same as above but for a sub-set (e.g. one cell type) of the
 *      bio-assays
 *
 *  Endpoint is anonymous-safe (subject to dataset ACL); large
 *  payloads compressed via standard Tomcat gzip. */
export async function getHeatmapData(
  datasetId: number | string,
  args: HeatmapDataArgs = {},
  signal?: AbortSignal,
): Promise<HeatmapWireResponse | null> {
  const params: Params = {};
  if (args.genes && args.genes.length > 0) {
    params.genes = args.genes.join(",");
  }
  if (args.sampleSize) params.sampleSize = args.sampleSize;
  if (args.subSet) params.subSet = args.subSet;
  if (args.quantitationType != null && args.quantitationType !== "") {
    params.quantitationType = args.quantitationType;
  }
  // Only send when overriding the server default (true) — keeps the
  // common request URL clean.
  if (args.maskOutliers === false) {
    params.maskOutliers = false;
  }
  try {
    const r = await apiGet<{ data?: HeatmapWireResponse }>(
      `${BASE}/datasets/${datasetId}/heatmap-data`,
      { params, signal },
    );
    return r.data ?? null;
  } catch {
    return null;
  }
}

/** A random sample of genes assayed by a dataset.
 *
 *  Reuses the heatmap-data endpoint's ``sampleSize`` param: called
 *  *without* a ``genes`` filter, the backend returns ``sampleSize``
 *  randomly-chosen design-element rows for the dataset, each carrying
 *  its mapped gene(s). This is the cheap way to get "valid genes for
 *  this dataset" — one call, and the sample is inherently restricted
 *  to the dataset's platform + taxon (no walking the platform's tens
 *  of thousands of elements). Rows can map to 0..n genes, so we
 *  flatten + dedupe and cap to ``n``.
 *
 *  Used to pre-populate the Visualize tab's heatmap on first open. */
export async function getRandomDatasetGenes(
  datasetId: number | string,
  n: number,
  signal?: AbortSignal,
): Promise<Gene[]> {
  const wire = await getHeatmapData(datasetId, { sampleSize: n }, signal);
  if (!wire?.rows?.length) return [];
  const seen = new Set<number>();
  const out: Gene[] = [];
  for (const row of wire.rows) {
    for (const g of row.genes ?? []) {
      if (g.id == null || seen.has(g.id)) continue;
      seen.add(g.id);
      out.push({
        id: g.id,
        officialSymbol: g.officialSymbol ?? null,
        // Wire calls it ``name``; the Gene shape (and chip tooltip)
        // expects ``officialName``.
        officialName: g.name ?? null,
      });
    }
  }
  return out.slice(0, n);
}

/** Categories endpoint also returns annotations under each category as a separate call. */
export async function getCategoriesWithChildren(
  args: CategoriesArgs,
  signal?: AbortSignal,
): Promise<CategoryWithChildren[]> {
  const cats = await getCategories(args, signal);
  const list = cats.data ?? [];
  if (!list.length) return [];

  const children = await Promise.all(
    list.map(async (cat) => {
      const catId = cat.classUri || cat.className?.toLowerCase() || "";
      if (!catId) return { ...cat, children: [] };
      // Drop this category's own exclusion before listing its terms.
      // `none(categoryUri = X)` means no dataset in the result set
      // carries a term in X, so the children come back empty, the row
      // is dropped below for having none, and the category the visitor
      // just excluded vanishes from the panel — along with any way to
      // un-exclude it, or to keep one term of it. Every other clause
      // still applies, so the counts stay honest about the rest of the
      // filter.
      const selfExclusion = negativeCategoryClause(cat);
      const childFilter = selfExclusion
        ? args.filter
            .map((c) => c.filter((sc) => sc !== selfExclusion))
            .filter((c) => c.length > 0)
        : args.filter;
      try {
        const r = await getAnnotationsByCategory(
          {
            category: catId,
            query: args.query,
            filter: childFilter,
            applyExclusions: args.applyExclusions,
            excludeFreeText: args.applyExclusions,
            gid: args.gid,
          },
          signal,
        );
        return { ...cat, children: r.data ?? [] };
      } catch {
        return { ...cat, children: [] };
      }
    }),
  );

  return children.filter((c) => c.children.length > 0);
}
