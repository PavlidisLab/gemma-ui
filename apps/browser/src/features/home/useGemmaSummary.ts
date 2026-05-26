/**
 * Aggregate counts for the home-page summary panel.
 *
 * The fast path is bro 2's ``GET /rest/v2/stats/home`` daily-refresh
 * snapshot — one ~50 ms call that carries dataset / platform /
 * sample / gene totals + per-taxon + per-platform-type +
 * recently-updated. When it's reachable, every tile fills off it
 * in one round-trip.
 *
 * When it's not (staging Gemma not yet deployed onto
 * ``feat/public-home-stats``, snapshot generation hasn't run,
 * etc.), every field also has a per-endpoint fallback via the
 * older standalone endpoints. Each tile renders independently; a
 * failing snapshot doesn't black-out the page.
 *
 * The annotation-count endpoints
 * (``/datasets/annotations/count?category=…&excludeFreeText=true``)
 * have no fallback — they need bro's recently-shipped flag. If the
 * server doesn't expose them, those tiles stay "—".
 */

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/api/client";
import type {
  Dataset,
  PaginatedResponse,
  Platform,
  Taxon,
} from "@/lib/types";

const BASE = "/rest/v2";

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
  updated?: number | null;
  new?: number | null;
}

export interface TechnologyRow {
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
  genes: number | null;
  byTaxon: TaxonRow[];
  byTechnology: TechnologyRow[];
  singleCellExperiments: number | null;
  ontologyTerms: number | null;
  diffExResultSets: number | null;
  byCategory: {
    drugs: number | null;
    diseases: number | null;
    tissues: number | null;
    cellTypes: number | null;
  };
  recentDatasets: RecentDataset[];
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
 *  the display buckets used on the home page (Microarray = ONECOLOR
 *  + TWOCOLOR + DUALMODE; RNA-seq = SEQUENCING + GENELIST). */
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
  return [
    { label: "Microarray", count: microarray },
    { label: "RNA-seq", count: sequencing },
    { label: "Single-cell", count: singleCellCount },
    { label: "Other", count: other },
  ]
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
}

/** ``ArrayDesign.TechnologyType`` → display bucket. Same mapping as
 *  ``rollUpPlatformTypes`` but row-by-row for the fallback path that
 *  aggregates from ``/datasets/platforms``. */
function technologyLabel(type: string): string {
  switch (type) {
    case "ONECOLOR":
    case "TWOCOLOR":
    case "DUALMODE":
      return "Microarray";
    case "SEQUENCING":
    case "GENELIST":
      return "RNA-seq";
    case "SINGLE_CELL_SEQUENCING":
    case "SINGLE_CELL":
      return "Single-cell";
    default:
      return "Other";
  }
}

function useNumericCount(path: string, key: string) {
  return useQuery({
    queryKey: ["summary", key],
    queryFn: async ({ signal }) => {
      const r = await apiGet<{ data?: number }>(path, { signal });
      return r.data ?? null;
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

function useTotalElements(path: string, key: string) {
  return useQuery({
    queryKey: ["summary", key],
    queryFn: async ({ signal }) => {
      const r = await apiGet<{ totalElements?: number }>(
        `${path}?limit=1`,
        { signal },
      );
      return r.totalElements ?? null;
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useGemmaSummary(): GemmaSummary {
  // /stats/home — fast path. Best-effort: if it errors, the per-
  // endpoint fallbacks below cover every field except geneCount
  // and singleCellCount (which only ship in the snapshot).
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
    retry: false,
  });

  // Per-endpoint fallbacks. Each fires independently of /stats/home
  // so the page fills in even when the snapshot 404s / 503s.
  const datasetsCount = useTotalElements(`${BASE}/datasets`, "datasets-count");
  const platformsCount = useTotalElements(
    `${BASE}/platforms`,
    "platforms-count",
  );
  const samplesCount = useNumericCount(
    `${BASE}/datasets/samples/count`,
    "samples-count",
  );

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
    retry: false,
  });

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
    retry: false,
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
    retry: false,
  });

  // Annotation counts — single global + 4 per-category. All pass
  // excludeFreeText=true so the values reflect distinct URI-bound
  // ontology terms.
  const ontologyTerms = useNumericCount(
    `${BASE}/datasets/annotations/count?excludeFreeText=true`,
    "annotations-all",
  );
  const drugs = useNumericCount(
    `${BASE}/datasets/annotations/count?category=treatment&excludeFreeText=true`,
    "annotations-treatment",
  );
  const diseases = useNumericCount(
    `${BASE}/datasets/annotations/count?category=disease&excludeFreeText=true`,
    "annotations-disease",
  );
  const tissues = useNumericCount(
    `${BASE}/datasets/annotations/count?category=organism%20part&excludeFreeText=true`,
    "annotations-organism-part",
  );
  const cellTypes = useNumericCount(
    `${BASE}/datasets/annotations/count?category=cell%20type&excludeFreeText=true`,
    "annotations-cell-type",
  );
  const diffExResultSets = useTotalElements(
    `${BASE}/resultSets`,
    "result-sets",
  );

  const wire = home.data;

  // Resolve each field with: snapshot wins, fallback fills the gap.
  const datasets = wire?.datasetCount ?? datasetsCount.data ?? null;
  const platforms = wire?.platformCount ?? platformsCount.data ?? null;
  const samples = wire?.sampleCount ?? samplesCount.data ?? null;
  const genes = wire?.geneCount ?? null;
  const singleCellExperiments = wire?.singleCellCount ?? null;

  // ── byTaxon ───────────────────────────────────────────────────
  // Snapshot shape: { id, commonName, scientificName, count }.
  // Fallback shape: full Taxon VO with numberOfExpressionExperiments.
  let byTaxon: TaxonRow[];
  if (wire) {
    byTaxon = wire.byTaxon
      .map((t) => ({ name: t.commonName, total: t.count }))
      .slice(0, 6);
  } else if (taxa.data && taxa.data.length > 0) {
    byTaxon = taxa.data
      .map((t) => ({
        name: t.commonName || t.scientificName || "(unknown)",
        total: t.numberOfExpressionExperiments ?? null,
      }))
      .sort((a, b) => (b.total ?? 0) - (a.total ?? 0))
      .slice(0, 6);
  } else {
    byTaxon = TAXA_PLACEHOLDER;
  }

  // ── byTechnology ──────────────────────────────────────────────
  // Snapshot: byPlatformType is a raw enum-keyed histogram; roll up.
  // Fallback: aggregate from /datasets/platforms — each row carries
  // numberOfExpressionExperimentsForTechnologyType for ITS bucket,
  // so taking the max per bucket gives the correct total.
  let byTechnology: TechnologyRow[];
  if (wire) {
    byTechnology = rollUpPlatformTypes(wire.byPlatformType, wire.singleCellCount);
  } else if (platformsForTech.data && platformsForTech.data.length > 0) {
    const agg = new Map<string, number>();
    for (const p of platformsForTech.data) {
      if (!p.technologyType) continue;
      const label = technologyLabel(p.technologyType);
      const candidate =
        p.numberOfExpressionExperimentsForTechnologyType ??
        p.numberOfExpressionExperiments ??
        0;
      const cur = agg.get(label) ?? 0;
      if (candidate > cur) agg.set(label, candidate);
    }
    byTechnology = Array.from(agg.entries())
      .map(([label, count]) => ({ label, count }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count);
  } else {
    byTechnology = [];
  }

  // ── recentDatasets ────────────────────────────────────────────
  let recentDatasets: RecentDataset[];
  if (wire) {
    recentDatasets = wire.recentExperiments.map((d) => ({
      id: d.id,
      shortName: d.shortName,
      name: d.name,
      taxonName: d.taxon ?? null,
      bioAssays: 0,
      lastUpdated: d.lastUpdated ?? null,
    }));
  } else if (recent.data) {
    recentDatasets = recent.data.map((d) => ({
      id: d.id,
      shortName: d.shortName,
      name: d.name,
      taxonName: d.taxon?.commonName ?? null,
      bioAssays: d.numberOfBioAssays ?? 0,
      lastUpdated: d.lastUpdated ?? null,
    }));
  } else {
    recentDatasets = [];
  }

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const updatedThisWeek =
    recentDatasets.length > 0
      ? recentDatasets.filter(
          (d) => d.lastUpdated && Date.parse(d.lastUpdated) >= sevenDaysAgo,
        ).length
      : null;

  // isLoading collapses to true while every relevant query is
  // still pending. Each tile's local "loading" gate keys off
  // its own value being null, so a partial-fill page renders.
  const isLoading =
    home.isLoading &&
    datasetsCount.isLoading &&
    platformsCount.isLoading &&
    taxa.isLoading &&
    platformsForTech.isLoading;

  return {
    datasets,
    platforms,
    samples,
    genes,
    byTaxon,
    byTechnology,
    singleCellExperiments,
    ontologyTerms: ontologyTerms.data ?? null,
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
    isLoading,
    isError: false,
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
