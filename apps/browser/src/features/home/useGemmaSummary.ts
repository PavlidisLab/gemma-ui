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
import type { Dataset, PaginatedResponse, Taxon } from "@/lib/types";

const BASE = "/rest/v2";

/** ``/stats/home`` v2 payload — bro's full landed wishlist. Mirrors
 *  ``HomeStats.java`` in the Gemma REST module. */
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
  /** Mutually-exclusive biomaterial counts split by technology.
   *  Keys: ``single_cell`` / ``rna_seq`` / ``microarray``. */
  samplesByTech?: Record<string, number>;
  singleCellCount: number;
  /** Sum of BioAssay.numberOfCells across single-cell studies —
   *  render in millions on the home page. */
  totalCells?: number;
  deaResultSetCount: number;
  drugCount: number;
  geneManipulatedCount: number;
  /** Experiments touched by any gene-URI annotation — pairs with
   *  ``geneManipulatedCount`` ("N genes perturbed across M
   *  experiments"). */
  geneManipulatedExperimentCount?: number;
  /** Distinct factor-value count per ``ExperimentalFactor.category``.
   *  This is the source for the "factor values per category" bar
   *  chart — distinct FVs only, not all characteristics. */
  factorValuesByCategory: Array<{
    category: string | null;
    categoryUri: string | null;
    numberOfDistinctFactorValues: number;
  }>;
  /** Distinct DEA contrasts across the corpus — the per-comparison
   *  count (e.g. a 3-level factor "drug" with values control / drug-A
   *  / drug-B yields 2 contrasts). Strictly greater than
   *  ``deaResultSetCount`` since each result set carries one or more
   *  contrasts. Bro: not yet shipped — filed in
   *  HOME_PAGE_DEA_CONTRASTS_2026_05_25.md. */
  deaContrastCount?: number;
  ontologyTermCount: number;
  /** Stable lowercase-snake-case keys: ``disease``, ``organism_part``,
   *  ``cell_type``, ``treatment``, ``strain``, ``cell_line``. */
  byAnnotationCategory: Record<string, number>;
  categoryDistribution: Array<{
    key: string | null;
    category: string;
    categoryUri: string | null;
    numberOfExpressionExperiments: number;
  }>;
  /** Datasets grouped by external-database source. ``source`` is
   *  the ExternalDatabase.name or ``"none"``. Sorted desc.
   *  Empty array on pre-deploy snapshots. */
  datasetsByAccessionSource?: Array<{ source: string; count: number }>;
  /** Distinct external accessions across the corpus, regardless of
   *  source. ≤ ``datasetCount`` — a single GEO submission split into
   *  two Gemma EEs counts once here. Undefined on snapshots that
   *  predate the field landing. */
  distinctAccessionCount?: number;
  /** Sub-bucket breakdown of the ``treatment`` annotation category.
   *  Keys: ``drug`` (CHEBI), ``pathogen`` (NCBITaxon), ``biologic``
   *  (PR), ``other`` (everything else). Sums to
   *  ``byAnnotationCategory.treatment``. */
  treatmentSubcategories?: Array<{
    key: string;
    label: string;
    /** Bro's parent group: ``control`` / ``pharmacology`` /
     *  ``biological`` / ``unclassified``. Lets the UI strip
     *  control-like buckets (Control / reference, Vehicles /
     *  solvents) before rendering — they dominate the count but
     *  carry no biological signal. */
    group?: string | null;
    count: number;
    termCount?: number;
  }>;
  /** Top perturbed genes by number of experiments. Not yet shipped
   *  — see HOME_PAGE_PERTURBED_GENES_2026_05_25.md. */
  topPerturbedGenes?: Array<{
    geneSymbol: string;
    taxon: string | null;
    numberOfExpressionExperiments: number;
  }>;
  recentExperiments: Array<{
    id: number;
    shortName: string;
    name: string;
    taxon: string;
    lastUpdated: string;
  }>;
}

export interface FactorValueCategoryRow {
  /** Canonical category label as Gemma stores it on the
   *  ExperimentalFactor (e.g. ``disease state``, ``treatment``,
   *  ``genotype``). */
  category: string;
  uri: string | null;
  count: number;
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
  /** Distinct DEA contrasts (per-comparison count). When available,
   *  this becomes the headline DEA number on the home page and
   *  ``diffExResultSets`` demotes to a footnote. ``null`` until
   *  bro ships the field. */
  diffExContrasts: number | null;
  /** Distinct CHEBI-anchored drug / chemical annotations. Narrower
   *  than ``byCategory.drugs`` (which covers all
   *  treatment-tagged annotations, drug or not). */
  drugs: number | null;
  /** Distinct genes annotated as perturbation targets across the
   *  corpus (knockouts, knockdowns, overexpression). */
  geneManipulated: number | null;
  /** Experiments touched by any gene-URI annotation; pairs with
   *  ``geneManipulated``. */
  geneManipulatedExperiments: number | null;
  /** Sum of cells profiled across single-cell studies. Render in
   *  millions for the home tile. */
  totalCells: number | null;
  /** Biomaterial counts split by technology. Keys: ``single_cell``,
   *  ``rna_seq``, ``microarray``. */
  samplesByTech: {
    singleCell: number | null;
    rnaSeq: number | null;
    microarray: number | null;
  };
  byCategory: {
    drugs: number | null;
    diseases: number | null;
    tissues: number | null;
    cellTypes: number | null;
    strains: number | null;
    cellLines: number | null;
  };
  /** Distinct factor values per ExperimentalFactor category — the
   *  source for the factor-values-per-category bar chart. Sorted
   *  descending server-side. */
  factorValuesByCategory: FactorValueCategoryRow[];
  /** Top annotation categories by EE coverage. Pairs with
   *  ``factorValuesByCategory`` on the bar chart: bar = FV depth,
   *  suffix = EE breadth. */
  categoryDistribution: Array<{
    key: string | null;
    category: string;
    categoryUri: string | null;
    numberOfExpressionExperiments: number;
  }>;
  /** Datasets grouped by external-database source (GEO, ArrayExpress,
   *  CELLxGENE, …); ``source === "none"`` carries direct lab
   *  submissions / Gemma-native EEs. Sorted desc, sums to
   *  ``datasets``. Empty until bro's accession field lands in the
   *  daily snapshot. Currently unused on the home page (Paul
   *  dropped the per-source footnote — see distinctAccessionCount). */
  datasetsByAccessionSource: Array<{ source: string; count: number }>;
  /** Distinct external accessions across the corpus, regardless of
   *  source. ≤ ``datasets`` because a single GEO submission split
   *  into two Gemma EEs counts once here. Drives the Datasets-tile
   *  "from N distinct accessions" footnote. ``null`` until bro's
   *  field ships (filed in HOME_PAGE_STATS_DISTINCT_ACCESSIONS_…). */
  distinctAccessionCount: number | null;
  /** Per-sub-bucket breakdown of the Treatment annotation category.
   *  Used to enrich the Treatments tile tooltip from a one-line
   *  prose explanation to a ranked drug / pathogen / biologic /
   *  other list. Empty array on snapshots predating bro's
   *  treatmentSubcategories field. */
  treatmentSubcategories: Array<{
    key: string;
    label: string;
    group: string | null;
    count: number;
    termCount: number | null;
  }>;
  /** Top perturbed genes by number of experiments referencing them
   *  as perturbation targets. Drives the middle-third bar chart on
   *  the home page. Empty until bro ships the field — filed in
   *  HOME_PAGE_PERTURBED_GENES_…. */
  topPerturbedGenes: Array<{
    geneSymbol: string;
    taxon: string | null;
    numberOfExpressionExperiments: number;
  }>;
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

/** Build the "By technology" chart rows from samplesByTech
 *  (mutually-exclusive biomaterial counts). The old byPlatformType
 *  source double-counted EEs that had multiple platforms attached
 *  (e.g. a SEQUENCING + GENELIST representation of the same study
 *  inflated RNA-seq by 2×). samplesByTech is single-counted at the
 *  biomaterial level — no overlap, no client-side gymnastics. */
function rollUpFromSamplesByTech(samplesByTech: {
  singleCell: number | null;
  rnaSeq: number | null;
  microarray: number | null;
}): TechnologyRow[] {
  return [
    { label: "RNA-seq", count: samplesByTech.rnaSeq ?? 0 },
    { label: "Microarray", count: samplesByTech.microarray ?? 0 },
    { label: "Single-cell", count: samplesByTech.singleCell ?? 0 },
  ]
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
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

  // Annotation counts — single global as a fallback when
  // /stats/home isn't deployed. v2 snapshot carries
  // ontologyTermCount + byAnnotationCategory + drugCount +
  // factorValuesByCategory + deaResultSetCount directly so we
  // don't need the per-category fan-out anymore.
  const ontologyTermsFallback = useNumericCount(
    `${BASE}/datasets/annotations/count?excludeFreeText=true`,
    "annotations-all",
  );
  const diffExResultSetsFallback = useTotalElements(
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
  // Source: samplesByTech (biomaterial-level, mutually exclusive).
  // The earlier byPlatformType-based rollup double-counted EEs that
  // appeared under multiple TechnologyType buckets (esp. SEQUENCING +
  // GENELIST for the same sequencing study), pushing RNA-seq past
  // the corpus dataset total. samplesByTech is single-counted by
  // bro server-side, so the numbers are honest.
  const samplesByTechResolved = {
    singleCell: wire?.samplesByTech?.single_cell ?? null,
    rnaSeq: wire?.samplesByTech?.rna_seq ?? null,
    microarray: wire?.samplesByTech?.microarray ?? null,
  };
  const byTechnology: TechnologyRow[] =
    samplesByTechResolved.singleCell !== null ||
    samplesByTechResolved.rnaSeq !== null ||
    samplesByTechResolved.microarray !== null
      ? rollUpFromSamplesByTech(samplesByTechResolved)
      : [];

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
    taxa.isLoading;

  // ── factorValuesByCategory ────────────────────────────────────
  // Read straight off /stats/home v2; categories with null label
  // are dropped (factor with no category set isn't user-facing).
  const factorValuesByCategory: FactorValueCategoryRow[] = wire
    ? wire.factorValuesByCategory
        .filter((r) => !!r.category)
        .map((r) => ({
          category: r.category as string,
          uri: r.categoryUri,
          count: r.numberOfDistinctFactorValues,
        }))
    : [];

  const byCat = wire?.byAnnotationCategory ?? {};

  return {
    datasets,
    platforms,
    samples,
    genes,
    byTaxon,
    byTechnology,
    singleCellExperiments,
    ontologyTerms:
      wire?.ontologyTermCount ?? ontologyTermsFallback.data ?? null,
    diffExResultSets:
      wire?.deaResultSetCount ?? diffExResultSetsFallback.data ?? null,
    diffExContrasts: wire?.deaContrastCount ?? null,
    drugs: wire?.drugCount ?? null,
    geneManipulated: wire?.geneManipulatedCount ?? null,
    geneManipulatedExperiments: wire?.geneManipulatedExperimentCount ?? null,
    totalCells: wire?.totalCells ?? null,
    samplesByTech: {
      singleCell: wire?.samplesByTech?.single_cell ?? null,
      rnaSeq: wire?.samplesByTech?.rna_seq ?? null,
      microarray: wire?.samplesByTech?.microarray ?? null,
    },
    byCategory: {
      drugs: byCat.treatment ?? null,
      diseases: byCat.disease ?? null,
      tissues: byCat.organism_part ?? null,
      cellTypes: byCat.cell_type ?? null,
      strains: byCat.strain ?? null,
      cellLines: byCat.cell_line ?? null,
    },
    factorValuesByCategory,
    categoryDistribution: wire?.categoryDistribution ?? [],
    datasetsByAccessionSource: wire?.datasetsByAccessionSource ?? [],
    distinctAccessionCount: wire?.distinctAccessionCount ?? null,
    treatmentSubcategories: (wire?.treatmentSubcategories ?? []).map((t) => ({
      key: t.key,
      label: t.label,
      group: t.group ?? null,
      count: t.count,
      termCount: t.termCount ?? null,
    })),
    topPerturbedGenes: wire?.topPerturbedGenes ?? [],
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
