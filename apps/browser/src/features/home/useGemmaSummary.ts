/**
 * Aggregate counts for the home-page summary panel.
 *
 * Strategy: every stat fires as its own TanStack Query so they
 * resolve in parallel — the home renders progressively as each
 * lands rather than waiting for the slowest. Each query is keyed
 * + cached for five minutes (corpus stats barely move within a
 * session) and a sign-in or filter change can invalidate.
 *
 * Wire shapes:
 *   - ``/datasets?limit=1``         → ``totalElements`` = dataset count
 *   - ``/platforms?limit=1``        → ``totalElements`` = platform count
 *   - ``/datasets/taxa``            → ``data[].{commonName, numberOfExpressionExperiments}``
 *   - ``/datasets/platforms``       → ``data[].{technologyType, numberOfExpressionExperimentsForTechnologyType}``
 *                                     client-side group-by on ``technologyType``
 *   - ``/datasets/categories``      → ``totalElements`` = ontology category count
 *   - ``/datasets/annotations?limit=1`` → ``totalElements`` = distinct ontology TERM count
 *   - ``/resultSets?limit=1``       → ``totalElements`` = DEA result-set count
 *   - ``/datasets?sort=-lastUpdated&limit=50`` → recent dataset list (marquee + new-this-week)
 *
 * What's still missing — filed as ask in
 * ``~/Dev/eclipseworkspace/Gemma/handoffs/HOME_PAGE_STATS_ASKS_2026_05_25.md``:
 *   - Corpus-wide bioassay / sample count (no aggregate endpoint).
 *   - Confirmed per-category distinct-term counts (drugs / diseases /
 *     tissues / cell types). The ``/datasets/annotations?category=…``
 *     filter likely works but needs verification before wiring.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiGet } from "@/api/client";
import type { Dataset, PaginatedResponse, Platform, Taxon } from "@/lib/types";

const BASE = "/rest/v2";

function useCountOnly(path: string, key: string): UseQueryResult<number> {
  return useQuery({
    queryKey: ["summary", key],
    queryFn: async ({ signal }) => {
      try {
        const r = await apiGet<{ totalElements?: number }>(`${path}?limit=1`, { signal });
        return r.totalElements ?? 0;
      } catch (e) {
        console.error(`[gemma summary] ${path} failed:`, e);
        throw e;
      }
    },
    staleTime: 5 * 60_000,
  });
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
  /** Canonical technology-type enum value as Gemma returns it
   *  (``ONECOLOR``, ``TWOCOLOR``, ``SEQUENCING``, ``GENELIST``,
   *  ``OTHER``, …) — UI maps to a friendlier label. */
  type: string;
  /** Human-facing label — single-cell / RNA-seq / microarray / other. */
  label: string;
  /** Number of expression experiments backed by platforms of this
   *  type. Summed across all platforms with that
   *  ``technologyType``. */
  count: number;
}

/** Compact recent-dataset record used by the home marquee. Strict
 *  subset of ``Dataset`` so the consumer can switch to a dedicated
 *  endpoint later without rippling. */
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
  /** Corpus-wide bioassay / sample count. ``null`` until a backend
   *  aggregate endpoint ships — see HOME_PAGE_STATS_ASKS_2026_05_25. */
  samples: number | null;
  /** Per-taxon dataset counts, top 6 by experiment count. Preserves
   *  the legacy [Human, Mouse, Rat] shape so existing variants keep
   *  rendering. */
  byTaxon: TaxonRow[];
  /** Per-technology-type dataset counts (single-cell / RNA-seq /
   *  microarray / other). Empty array while loading. */
  byTechnology: TechnologyRow[];
  /** Total distinct ontology terms in use across the corpus (sum of
   *  per-category usage). Drives the "Concepts" / "Terms" stat. */
  ontologyTerms: number | null;
  /** Distinct ontology categories ("disease", "treatment", "cell
   *  type", "organism part", …). Drives the "Categories" stat. */
  ontologyCategories: number | null;
  /** Differential-expression result sets corpus-wide — proxy for "DEA
   *  conditions". */
  diffExResultSets: number | null;
  /** Most recently updated datasets — feeds the scrolling marquee on
   *  variants that surface it. Capped at 50 by the underlying query. */
  recentDatasets: RecentDataset[];
  /** Count of datasets whose ``lastUpdated`` falls inside the last 7
   *  days, derived from ``recentDatasets``. Approximate — only counts
   *  hits inside the 50-element window. */
  updatedThisWeek: number | null;
  /** Same window, restricted to first-seen-in-last-7-days. We don't
   *  have ``dateCreated`` separately today, so this mirrors
   *  ``updatedThisWeek`` until the backend ask lands. */
  newThisWeek: number | null;
  isLoading: boolean;
  isError: boolean;
}

/** Map ``ArrayDesign.TechnologyType`` enum values to home-page labels.
 *  Anything not in this map collapses into ``"Other"`` so a new
 *  upstream enum value doesn't crash the chart. */
function technologyLabel(type: string): string {
  switch (type) {
    case "ONECOLOR":
    case "TWOCOLOR":
    case "DUALMODE":
      return "Microarray";
    case "SEQUENCING":
      return "RNA-seq";
    case "SINGLE_CELL_SEQUENCING":
    case "SINGLE_CELL":
      return "Single-cell";
    case "GENELIST":
      return "Gene list";
    default:
      return "Other";
  }
}

export function useGemmaSummary(): GemmaSummary {
  const datasets = useCountOnly(`${BASE}/datasets`, "datasets");
  const platforms = useCountOnly(`${BASE}/platforms`, "platforms");
  const ontologyCategories = useCountOnly(`${BASE}/datasets/categories`, "categories");
  const ontologyTerms = useCountOnly(`${BASE}/datasets/annotations`, "annotations");
  const diffExResultSets = useCountOnly(`${BASE}/resultSets`, "result-sets");

  const taxa = useQuery({
    queryKey: ["summary", "taxa"],
    queryFn: async ({ signal }) => {
      const r = await apiGet<PaginatedResponse<Taxon>>(
        `${BASE}/datasets/taxa`,
        { signal },
      );
      return r.data ?? [];
    },
    staleTime: 5 * 60_000,
  });

  // Pull a generous slice of platforms (server caps at 100/page so
  // anything bigger needs a fan-out — the catalogue is ~670). For the
  // home tile we just need totals per technology type, which 100
  // platforms already covers the bulk of by EE-count weight. Bumping
  // limit minimises the underestimate without a multi-page fetch.
  const platformsForTech = useQuery({
    queryKey: ["summary", "platforms-by-tech"],
    queryFn: async ({ signal }) => {
      const r = await apiGet<PaginatedResponse<Platform>>(
        `${BASE}/datasets/platforms?limit=100`,
        { signal },
      );
      return r.data ?? [];
    },
    staleTime: 5 * 60_000,
  });

  const recent = useQuery({
    queryKey: ["summary", "recent-datasets"],
    queryFn: async ({ signal }) => {
      const r = await apiGet<PaginatedResponse<Dataset>>(
        `${BASE}/datasets?sort=-lastUpdated&limit=50`,
        { signal },
      );
      return r.data ?? [];
    },
    staleTime: 5 * 60_000,
  });

  // ── Derive byTaxon (top 6 by EE count) ────────────────────────────
  const taxaRows: TaxonRow[] = (taxa.data ?? [])
    .map((t) => ({
      name: t.commonName || t.scientificName || "(unknown)",
      total: t.numberOfExpressionExperiments ?? null,
    }))
    .sort((a, b) => (b.total ?? 0) - (a.total ?? 0))
    .slice(0, 6);

  // Render placeholder rows while loading so the variants that
  // expect Human/Mouse/Rat don't reflow when the data lands.
  const byTaxon: TaxonRow[] =
    taxaRows.length > 0
      ? taxaRows
      : [
          { name: "Human", total: null },
          { name: "Mouse", total: null },
          { name: "Rat", total: null },
        ];

  // ── Derive byTechnology (aggregate from platforms) ────────────────
  // Each Platform row carries the EE-count for THAT platform's
  // technologyType; multiple platforms share a type, so sum by label.
  const techAggregate = new Map<string, { type: string; count: number }>();
  for (const p of platformsForTech.data ?? []) {
    if (!p.technologyType) continue;
    const label = technologyLabel(p.technologyType);
    // Prefer the per-platform EE-count (its own); the field
    // ``numberOfExpressionExperimentsForTechnologyType`` is the same
    // number every row in a tech-type shares (it's the technologyType
    // total), so reading it once per type is enough. Take the max so
    // missing values from some rows don't lose the real count.
    const cur = techAggregate.get(label);
    const candidate =
      p.numberOfExpressionExperimentsForTechnologyType ??
      p.numberOfExpressionExperiments ??
      0;
    if (!cur || candidate > cur.count) {
      techAggregate.set(label, { type: p.technologyType, count: candidate });
    }
  }
  const byTechnology: TechnologyRow[] = Array.from(techAggregate.entries())
    .map(([label, v]) => ({ label, type: v.type, count: v.count }))
    .sort((a, b) => b.count - a.count);

  // ── Derive recent + this-week counters ────────────────────────────
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentRows: RecentDataset[] = (recent.data ?? []).map((d) => ({
    id: d.id,
    shortName: d.shortName,
    name: d.name,
    taxonName: d.taxon?.commonName ?? null,
    bioAssays: d.numberOfBioAssays ?? 0,
    lastUpdated: d.lastUpdated ?? null,
  }));
  const updatedThisWeek = recent.data
    ? recentRows.filter(
        (d) => d.lastUpdated && Date.parse(d.lastUpdated) >= sevenDaysAgo,
      ).length
    : null;

  return {
    datasets: datasets.data ?? null,
    platforms: platforms.data ?? null,
    samples: null,
    byTaxon,
    byTechnology,
    ontologyTerms: ontologyTerms.data ?? null,
    ontologyCategories: ontologyCategories.data ?? null,
    diffExResultSets: diffExResultSets.data ?? null,
    recentDatasets: recentRows,
    updatedThisWeek,
    newThisWeek: updatedThisWeek,
    isLoading:
      datasets.isLoading ||
      platforms.isLoading ||
      taxa.isLoading ||
      platformsForTech.isLoading,
    isError:
      datasets.isError ||
      platforms.isError ||
      taxa.isError ||
      platformsForTech.isError,
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
