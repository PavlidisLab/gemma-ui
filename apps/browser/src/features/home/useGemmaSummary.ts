/**
 * Aggregate counts for the home-page summary panel.
 *
 * Primary source: ``GET /rest/v2/stats/home`` — a precomputed
 * daily-refresh snapshot bro 2 shipped 2026-05-25 that bundles
 * dataset / platform / sample / gene totals, the per-taxon
 * breakdown, the per-platform-type histogram, and the top 50
 * recently-updated experiments in one ~50 ms call. Numbers are
 * 0–24 h stale; fine for a marketing-style home tile. See
 * ``~/Dev/eclipseworkspace/Gemma/handoffs/HOME_PAGE_STATS_REPLY_2026_05_25.md``
 * and ``HOME_STATS_WISHLIST.md`` for the contract.
 *
 * Secondary queries (each its own ``useQuery`` so they parallelise):
 *
 *  - ``/datasets/categories?limit=1`` → distinct annotation category
 *    count. Cheap; not yet in ``/stats/home``.
 *  - ``/resultSets?limit=1``         → DEA result-set total.
 *  - ``/datasets/annotations/count?category=…`` × 4 → distinct-term
 *    counts for treatments (drugs), diseases, organism parts
 *    (tissues), cell types. Dedicated endpoint bro shipped because
 *    ``/datasets/annotations`` doesn't carry ``totalElements``.
 *  - ``/datasets/annotations/count`` (no category) → total ontology
 *    terms across the corpus.
 *
 * Fields on the legacy hook shape (``byTaxon``, ``updatedThisWeek``,
 * ``newThisWeek``) are preserved so the other 13 home variants that
 * read them keep rendering unchanged.
 *
 * Open items — filed in the asks handoff, not blocking GA:
 *  - ``singleCellCount`` lives in ``/stats/home`` but returns 0 in
 *    v1 (no aggregate yet — see HOME_STATS_WISHLIST.md v2 wishlist).
 *  - DEA conditions (distinct factor-values participating in a DEA)
 *    aren't in v1 either; falling back to result-set total as the
 *    proxy.
 */

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/api/client";

const BASE = "/rest/v2";

/** Wire shape returned by ``GET /rest/v2/stats/home``. Mirrors
 *  ``HomeStats`` in the Java REST module; keep in sync with
 *  ``HOME_STATS_WISHLIST.md`` payload v1. */
interface HomeStatsWire {
  generatedAt: string;
  datasetCount: number;
  platformCount: number;
  sampleCount: number;
  geneCount: number;
  byTaxon: Array<{
    id: number;
    commonName: string;
    scientificName: string;
    count: number;
  }>;
  byPlatformType: Record<string, number>;
  singleCellCount: number;
  recentExperiments: Array<{
    id: number;
    shortName: string;
    name: string;
    taxon: string;
    lastUpdated: string;
  }>;
}

export interface TaxonRow {
  name: string;
  total: number | null;
  /** Reserved — populated when a server-side ``createdSince`` /
   *  ``updatedSince`` filter lands. Today the new-this-week heuristic
   *  is computed only at the corpus level (see ``newThisWeek``), not
   *  per-taxon. */
  updated?: number | null;
  new?: number | null;
}

export interface TechnologyRow {
  /** Human-facing bucket label: Microarray / RNA-seq / Single-cell /
   *  Gene list / Other. The mapping rolls Gemma's raw
   *  ``ArrayDesign.TechnologyType`` enum values up to display
   *  buckets per bro's recommendation in HOME_STATS_WISHLIST.md. */
  label: string;
  count: number;
}

export interface RecentDataset {
  id: number;
  shortName: string;
  name: string;
  taxonName: string | null;
  bioAssays: number;
  lastUpdated: string | null;
}

export interface GemmaSummary {
  datasets: number | null;
  platforms: number | null;
  samples: number | null;
  /** Total distinct genes with any expression data. From
   *  ``/stats/home``; ``null`` while loading. */
  genes: number | null;
  byTaxon: TaxonRow[];
  byTechnology: TechnologyRow[];
  /** Single-cell experiment count — orthogonal to TechnologyType.
   *  Returns 0 in stats/home v1; will populate in v2. */
  singleCellExperiments: number | null;
  /** Total distinct ontology terms in use across the corpus. */
  ontologyTerms: number | null;
  /** Distinct ontology categories ("disease", "treatment", …). */
  ontologyCategories: number | null;
  /** Differential-expression result sets corpus-wide — proxy for
   *  "DEA conditions" until the v2 aggregate lands. */
  diffExResultSets: number | null;
  /** Per-category distinct-term counts. ``null`` while loading. */
  byCategory: {
    drugs: number | null;
    diseases: number | null;
    tissues: number | null;
    cellTypes: number | null;
  };
  recentDatasets: RecentDataset[];
  /** ``generatedAt`` from the /stats/home snapshot — surfacing this
   *  lets the UI render a small "as of <date>" footnote so visitors
   *  understand the daily-refresh staleness. */
  snapshotAt: string | null;
  updatedThisWeek: number | null;
  newThisWeek: number | null;
  isLoading: boolean;
  isError: boolean;
}

const TAXA_PLACEHOLDER: TaxonRow[] = [
  { name: "Human", total: null },
  { name: "Mouse", total: null },
  { name: "Rat", total: null },
];

/** Roll Gemma's raw ``ArrayDesign.TechnologyType`` enum counts up to
 *  the display buckets used on the home page. Bro's recommendation
 *  in HOME_STATS_WISHLIST.md groups:
 *    - Microarray = ONECOLOR + TWOCOLOR + DUALMODE
 *    - RNA-seq    = SEQUENCING + GENELIST
 *    - Single-cell rides on the separate ``singleCellCount`` field
 *  Anything else collapses into "Other" so an unfamiliar upstream
 *  enum value doesn't crash the chart. */
function rollUpPlatformTypes(
  raw: Record<string, number>,
  singleCellCount: number,
): TechnologyRow[] {
  const microarray =
    (raw.ONECOLOR ?? 0) + (raw.TWOCOLOR ?? 0) + (raw.DUALMODE ?? 0);
  const sequencing = (raw.SEQUENCING ?? 0) + (raw.GENELIST ?? 0);
  const known = new Set([
    "ONECOLOR",
    "TWOCOLOR",
    "DUALMODE",
    "SEQUENCING",
    "GENELIST",
  ]);
  const other = Object.entries(raw)
    .filter(([k]) => !known.has(k))
    .reduce((s, [, v]) => s + (v ?? 0), 0);
  const rows: TechnologyRow[] = [
    { label: "Microarray", count: microarray },
    { label: "RNA-seq", count: sequencing },
    { label: "Single-cell", count: singleCellCount },
    { label: "Other", count: other },
  ];
  // Drop zero buckets so the breakdown doesn't carry empty rows
  // (Single-cell renders 0 until v2 lands; suppress).
  return rows.filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
}

/** Read a single-number count from one of Gemma's ``…/count``
 *  endpoints. The response envelope is ``{ data: <number> }``. */
function useNumericCount(path: string, key: string) {
  return useQuery({
    queryKey: ["summary", key],
    queryFn: async ({ signal }) => {
      try {
        const r = await apiGet<{ data?: number }>(path, { signal });
        return r.data ?? 0;
      } catch (e) {
        console.error(`[gemma summary] ${path} failed:`, e);
        throw e;
      }
    },
    staleTime: 5 * 60_000,
  });
}

/** Read ``totalElements`` from a paginated endpoint via the
 *  ``limit=1`` trick. Used for ``/datasets/categories`` and
 *  ``/resultSets`` which both carry ``totalElements``. */
function useTotalElements(path: string, key: string) {
  return useQuery({
    queryKey: ["summary", key],
    queryFn: async ({ signal }) => {
      try {
        const r = await apiGet<{ totalElements?: number }>(
          `${path}?limit=1`,
          { signal },
        );
        return r.totalElements ?? 0;
      } catch (e) {
        console.error(`[gemma summary] ${path} failed:`, e);
        throw e;
      }
    },
    staleTime: 5 * 60_000,
  });
}

export function useGemmaSummary(): GemmaSummary {
  // Primary one-shot — bundles datasets / platforms / samples /
  // genes / byTaxon / byPlatformType / recentExperiments. Cached
  // hard server-side (daily refresh), so a long client-side
  // staleTime is fine — we won't beat the server snapshot anyway.
  const home = useQuery({
    queryKey: ["summary", "stats-home"],
    queryFn: async ({ signal }) => {
      const r = await apiGet<{ data?: HomeStatsWire }>(
        `${BASE}/stats/home`,
        { signal },
      );
      return r.data ?? null;
    },
    staleTime: 30 * 60_000,
    retry: (failureCount, err) => {
      // 503 = snapshot not yet generated (first deploy / dev server).
      // Retry a couple of times in case the server is mid-generation,
      // then give up and let the UI render placeholders.
      const status =
        err && typeof err === "object" && "status" in err
          ? (err as { status: number }).status
          : 0;
      if (status === 404) return false;
      return failureCount < 2;
    },
  });

  // Secondary stats not yet in /stats/home v1.
  const ontologyCategories = useTotalElements(
    `${BASE}/datasets/categories`,
    "categories",
  );
  const diffExResultSets = useTotalElements(`${BASE}/resultSets`, "result-sets");
  const ontologyTerms = useNumericCount(
    `${BASE}/datasets/annotations/count`,
    "annotations-all",
  );
  const drugs = useNumericCount(
    `${BASE}/datasets/annotations/count?category=treatment`,
    "annotations-treatment",
  );
  const diseases = useNumericCount(
    `${BASE}/datasets/annotations/count?category=disease`,
    "annotations-disease",
  );
  const tissues = useNumericCount(
    `${BASE}/datasets/annotations/count?category=organism%20part`,
    "annotations-organism-part",
  );
  const cellTypes = useNumericCount(
    `${BASE}/datasets/annotations/count?category=cell%20type`,
    "annotations-cell-type",
  );

  const wire = home.data;

  const byTaxon: TaxonRow[] = wire
    ? wire.byTaxon
        .map((t) => ({ name: t.commonName, total: t.count }))
        .slice(0, 6)
    : TAXA_PLACEHOLDER;

  const byTechnology: TechnologyRow[] = wire
    ? rollUpPlatformTypes(wire.byPlatformType, wire.singleCellCount)
    : [];

  const recentDatasets: RecentDataset[] = wire
    ? wire.recentExperiments.map((d) => ({
        id: d.id,
        shortName: d.shortName,
        name: d.name,
        taxonName: d.taxon ?? null,
        bioAssays: 0, // not in stats/home v1; suppressed downstream
        lastUpdated: d.lastUpdated ?? null,
      }))
    : [];

  // Derive a "updated this week" count from the recent slice. The
  // /stats/home snapshot's recent list is top-50 by lastUpdated, so
  // anything in the last 7 days is in this window unless we shipped
  // >50 updates in a week — flag would be visible against the
  // dataset-tile count delta.
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const updatedThisWeek = wire
    ? recentDatasets.filter(
        (d) => d.lastUpdated && Date.parse(d.lastUpdated) >= sevenDaysAgo,
      ).length
    : null;

  return {
    datasets: wire?.datasetCount ?? null,
    platforms: wire?.platformCount ?? null,
    samples: wire?.sampleCount ?? null,
    genes: wire?.geneCount ?? null,
    byTaxon,
    byTechnology,
    singleCellExperiments: wire?.singleCellCount ?? null,
    ontologyTerms: ontologyTerms.data ?? null,
    ontologyCategories: ontologyCategories.data ?? null,
    diffExResultSets: diffExResultSets.data ?? null,
    byCategory: {
      drugs: drugs.data ?? null,
      diseases: diseases.data ?? null,
      tissues: tissues.data ?? null,
      cellTypes: cellTypes.data ?? null,
    },
    recentDatasets,
    snapshotAt: wire?.generatedAt ?? null,
    updatedThisWeek,
    newThisWeek: updatedThisWeek,
    isLoading: home.isLoading,
    isError: home.isError,
  };
}

/** Clean a raw Gemma experiment title for compact display.
 *
 *  Two noise patterns live in the corpus:
 *
 *  - **"Split (…) of GSE…: "** style prefixes — Gemma adds these when
 *    a parent submission is split into a per-platform / per-taxon /
 *    per-condition derivative. The prefix is curator-bookkeeping;
 *    a public visitor cares about the body.
 *  - **Trailing bracket blocks** — e.g. ``[collection of material:
 *    cortex]``, ``[treatment: cisplatin]``. Curator-side annotations
 *    glued onto the end; not part of the published title.
 *
 *  Conservative regexes: only strip when the leading pattern matches
 *  the recognised shape (``Split\b`` followed by ≤120 chars up to a
 *  ``: ``) or when the entire trailing block is bracketed. Real
 *  titles that happen to start with "Split" but don't follow the
 *  curator-prefix shape (e.g. "Split-brain studies in macaques")
 *  pass through unchanged.
 */
export function cleanExperimentTitle(raw: string): string {
  if (!raw) return raw;
  let s = raw;
  s = s.replace(/^Split\s[^:]{0,120}:\s+/, "");
  s = s.replace(/(?:\s*\[[^\]]*\])+\s*$/, "");
  return s.trim();
}

/** Format a count for compact display ("23,549" or "23K" / "23.5K").
 *  Use ``compact`` for hero stats; default (full) for the table.
 *  ``null`` renders as "—" (unsupported / not-yet-wired). Pass
 *  ``loading: true`` to render "…" while the underlying query is
 *  pending so the curator sees activity vs. a true zero/missing. */
export function fmtCount(
  n: number | null,
  mode: "full" | "compact" = "full",
  loading = false,
): string {
  if (n === null) return loading ? "…" : "—";
  if (mode === "compact") {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
    return n.toLocaleString();
  }
  return n.toLocaleString();
}
