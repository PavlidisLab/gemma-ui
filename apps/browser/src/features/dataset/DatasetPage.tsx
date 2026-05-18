// Public, read-only Expression Experiment page.
//
// Mirrors the curator-UI banner-with-tabs pattern (see
// apps/curation/src/features/experiment/ExperimentBanner.tsx) so the
// two surfaces feel like the same product. Tabs:
//   - Overview     description + annotations + meta
//   - Design       factors × FVs × per-FV sample counts (placeholder)
//   - Samples      per-sample biomaterial table (placeholder)
//   - Expression   DE analyses + heatmap viz (synthetic for now)
//   - Downloads    bulk data + metadata links
//
// Tab state lives in the URL search-param `?tab=` so a curator can
// link directly to a specific section. Sections that need backend
// endpoints we haven't wired render skeleton bodies with a small
// "backend wire pending" badge — keeps the layout honest about what
// will land where (see Backend gaps note at bottom of this file).

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useNavigate, useSearch } from "@tanstack/react-router";
import { marked } from "marked";
import { ExternalLink } from "lucide-react";
import {
  getDatasetById,
  getDatasetAnnotations,
} from "@/api/endpoints";
import { gemmaUrl } from "@/lib/gemmaConfig";
import {
  HeatmapWidget,
  type CategoricalAnnotation,
  type HeatmapData,
} from "@/lib/heatmap";
import type { Dataset, DatasetAnnotation } from "@/lib/types";

type TabId = "overview" | "design" | "samples" | "expression" | "downloads";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "design", label: "Design" },
  { id: "samples", label: "Samples" },
  { id: "expression", label: "Expression" },
  { id: "downloads", label: "Downloads" },
];

function isTabId(s: unknown): s is TabId {
  return typeof s === "string" && TABS.some((t) => t.id === s);
}

export function DatasetPage() {
  const { id } = useParams({ from: "/dataset/$id" });
  const navigate = useNavigate();
  // useSearch on a route without validateSearch is loosely typed; we
  // just want the `tab` param. Fall back to "overview".
  const search = useSearch({ strict: false }) as { tab?: string };
  const activeTab: TabId = isTabId(search.tab) ? search.tab : "overview";

  const ds = useQuery({
    queryKey: ["dataset", id],
    queryFn: ({ signal }) => getDatasetById(id, signal),
  });
  const ann = useQuery({
    queryKey: ["datasetAnnotations", id],
    queryFn: ({ signal }) => getDatasetAnnotations(Number(id), signal),
    enabled: !!ds.data?.id,
  });

  if (ds.isLoading) {
    return (
      <PageShell>
        <SkeletonBanner />
      </PageShell>
    );
  }
  if (ds.isError || !ds.data) return <NotFoundCard id={id} />;

  const dataset = ds.data;
  const annotations = ann.data?.data ?? [];

  const setTab = (id: TabId) =>
    navigate({
      to: "/dataset/$id",
      params: { id: dataset.shortName ?? String(dataset.id) },
      search: id === "overview" ? {} : { tab: id },
      replace: true,
    });

  return (
    <PageShell>
      <Banner
        dataset={dataset}
        annotationCount={annotations.length}
        activeTab={activeTab}
        onTabChange={setTab}
      />
      <div className="mx-auto w-full max-w-[1200px] px-6 py-6 space-y-6">
        {activeTab === "overview" && (
          <OverviewTab dataset={dataset} annotations={annotations} annLoading={ann.isLoading} />
        )}
        {activeTab === "design" && <DesignTab />}
        {activeTab === "samples" && <SamplesTab nSamples={dataset.numberOfBioAssays} />}
        {activeTab === "expression" && <ExpressionTab />}
        {activeTab === "downloads" && <DownloadsTab dataset={dataset} />}
      </div>
    </PageShell>
  );
}

// ─── Layout shell ────────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full overflow-auto bg-slate-50 dark:bg-slate-900">
      {children}
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-slate-200 rounded shadow-sm dark:bg-slate-800 dark:border-slate-700">
      <header className="flex items-baseline justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-700 gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-wide">{title}</h2>
          {subtitle && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
        {right}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

// ─── Banner ──────────────────────────────────────────────────────────

function Banner({
  dataset,
  annotationCount,
  activeTab,
  onTabChange,
}: {
  dataset: Dataset;
  annotationCount: number;
  activeTab: TabId;
  onTabChange: (id: TabId) => void;
}) {
  const geo = dataset.accession?.accession;
  const geeq = dataset.geeq?.publicQualityScore;
  const legacyUrl = gemmaUrl(
    `/expressionExperiment/showExpressionExperiment.html?id=${dataset.id}`,
  );

  return (
    <section className="sticky top-0 z-10 bg-white border-b border-slate-200 dark:bg-slate-800 dark:border-slate-700">
      <div className="h-1 bg-gradient-to-r from-amber-500 via-slate-900 to-sky-500" />
      <div className="mx-auto w-full max-w-[1200px] px-6 py-3 flex gap-4 flex-wrap items-start">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-3 flex-wrap">
            <a
              href={legacyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-lg font-semibold text-slate-900 hover:underline dark:text-slate-100"
              title="open on Gemma"
            >
              {dataset.shortName}
            </a>
            <h1 className="text-sm text-slate-600 dark:text-slate-300 leading-snug min-w-0">
              {dataset.name}
            </h1>
          </div>
          <div className="mt-1 text-xs text-slate-600 dark:text-slate-400 flex flex-wrap gap-x-4 gap-y-1">
            <span>{dataset.taxon?.commonName ?? "—"}</span>
            <span>{dataset.numberOfBioAssays} samples</span>
            {geo && (
              <a
                href={`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${geo}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-700 hover:underline inline-flex items-center gap-1 dark:text-sky-300"
              >
                {geo}
                <ExternalLink size={11} />
              </a>
            )}
            <a
              href={legacyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-700 hover:underline inline-flex items-center gap-1 dark:text-sky-300"
            >
              view on Gemma
              <ExternalLink size={11} />
            </a>
          </div>
        </div>
        {geeq != null && (
          <span
            className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700 shrink-0"
            title="GEEQ quality score (public)"
          >
            GEEQ {geeq.toFixed(2)}
          </span>
        )}
      </div>
      <div className="mx-auto w-full max-w-[1200px] px-6">
        <nav className="flex items-center gap-1 -mb-px overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              className={
                "px-3 py-2 text-sm cursor-pointer border-b-2 bg-transparent " +
                (t.id === activeTab
                  ? "border-sky-600 text-slate-900 font-medium dark:text-slate-100 dark:border-sky-400"
                  : "border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100")
              }
            >
              {t.label}
              {t.id === "overview" && annotationCount > 0 && (
                <span className="ml-1.5 text-[10px] tabular-nums text-slate-400">
                  {annotationCount}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>
    </section>
  );
}

function SkeletonBanner() {
  return (
    <div className="bg-white border-b border-slate-200 dark:bg-slate-800 dark:border-slate-700">
      <div className="h-1 bg-gradient-to-r from-amber-500 via-slate-900 to-sky-500" />
      <div className="mx-auto w-full max-w-[1200px] px-6 py-3 animate-pulse">
        <div className="h-4 w-24 bg-slate-200 rounded dark:bg-slate-700" />
        <div className="h-3 mt-3 w-2/3 bg-slate-200 rounded dark:bg-slate-700" />
      </div>
    </div>
  );
}

function NotFoundCard({ id }: { id: string }) {
  return (
    <PageShell>
      <div className="mx-auto w-full max-w-[1200px] px-6 py-6">
        <SectionCard title="Not found">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            No experiment found for id <span className="font-mono">{id}</span>.
          </p>
        </SectionCard>
      </div>
    </PageShell>
  );
}

// ─── Tab: Overview ───────────────────────────────────────────────────

function OverviewTab({
  dataset,
  annotations,
  annLoading,
}: {
  dataset: Dataset;
  annotations: DatasetAnnotation[];
  annLoading: boolean;
}) {
  return (
    <>
      <Description dataset={dataset} />
      <AnnotationsSection annotations={annotations} loading={annLoading} />
    </>
  );
}

function Description({ dataset }: { dataset: Dataset }) {
  const html = useMemo(() => {
    if (!dataset.description) return null;
    return marked.parse(dataset.description, { async: false }) as string;
  }, [dataset.description]);
  if (!html) {
    return (
      <SectionCard title="Description">
        <p className="text-xs text-slate-500 italic">no description provided</p>
      </SectionCard>
    );
  }
  return (
    <SectionCard title="Description">
      <div
        className="prose prose-sm dark:prose-invert max-w-none text-sm text-slate-700 dark:text-slate-200"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </SectionCard>
  );
}

function AnnotationsSection({
  annotations,
  loading,
}: {
  annotations: DatasetAnnotation[];
  loading: boolean;
}) {
  const grouped = useMemo(() => {
    const m = new Map<string, DatasetAnnotation[]>();
    for (const a of annotations) {
      const key = a.className ?? "uncategorized";
      const list = m.get(key) ?? [];
      list.push(a);
      m.set(key, list);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [annotations]);

  return (
    <SectionCard
      title="Annotations"
      subtitle={
        loading
          ? "loading…"
          : `${annotations.length} term${annotations.length === 1 ? "" : "s"}`
      }
    >
      {loading ? (
        <div className="h-6 w-2/3 bg-slate-200 rounded animate-pulse dark:bg-slate-700" />
      ) : annotations.length === 0 ? (
        <p className="text-xs text-slate-500 italic">no annotations</p>
      ) : (
        <div className="space-y-2">
          {grouped.map(([category, terms]) => (
            <div key={category} className="flex items-baseline gap-2 flex-wrap">
              <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wide dark:text-slate-400">
                {category}
              </span>
              {terms.map((t, i) => (
                <span
                  key={`${t.termUri ?? t.termName}-${i}`}
                  className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:border-slate-600"
                  title={t.termUri ?? undefined}
                >
                  {t.termName}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ─── Tab: Design (PLACEHOLDER) ───────────────────────────────────────

function DesignTab() {
  return (
    <SectionCard
      title="Experimental design"
      subtitle="Factors, factor values, and sample assignments"
      right={<GapBadge />}
    >
      <p className="text-xs text-slate-500 italic">
        Backend wire: <code>GET /rest/v2/datasets/{"{id}"}/factors</code> →
        factor / FV / sample shape. Once wired, render a compact table:
        factor × factor-values × per-FV sample count, with continuous-
        factor histograms inline.
      </p>
    </SectionCard>
  );
}

// ─── Tab: Samples (PLACEHOLDER) ──────────────────────────────────────

function SamplesTab({ nSamples }: { nSamples: number }) {
  return (
    <SectionCard
      title="Samples"
      subtitle={`${nSamples} biomaterial${nSamples === 1 ? "" : "s"}`}
      right={<GapBadge />}
    >
      <p className="text-xs text-slate-500 italic">
        Backend wire: <code>GET /rest/v2/datasets/{"{id}"}/samples</code>{" "}
        → per-sample biomaterial + GEO sample id + characteristics +
        factor-value assignments. Render the same compact table the
        curation app uses (see <code>apps/curation/src/features/samples/</code>),
        read-only.
      </p>
    </SectionCard>
  );
}

// ─── Tab: Expression ─────────────────────────────────────────────────

function ExpressionTab() {
  const data = useMemo<HeatmapData>(() => buildSyntheticDataset(40, 30), []);
  return (
    <>
      <SectionCard
        title="Differential expression"
        subtitle="Analyses and top contrasts"
        right={<GapBadge />}
      >
        <p className="text-xs text-slate-500 italic">
          Backend wire:{" "}
          <code>
            GET /rest/v2/datasets/{"{id}"}/analyses/differential
          </code>{" "}
          → list of analyses; per-analysis result-set links for top genes.
          Render one card per analysis: contrast names, threshold, top-N
          genes (gene symbol, log2FC, q-value), and a "view in heatmap"
          action that drives the viz panel below.
        </p>
      </SectionCard>
      <SectionCard
        title="Visualization"
        subtitle="Heatmap of top differential genes"
        right={<GapBadge label="synthetic data" />}
      >
        <HeatmapWidget
          data={data}
          title="Top 40 DE genes × 30 samples"
          caption="Placeholder — wires to real DE result set once available."
        />
      </SectionCard>
    </>
  );
}

// ─── Tab: Downloads ──────────────────────────────────────────────────

function DownloadsTab({ dataset }: { dataset: Dataset }) {
  const id = dataset.id;
  const u = (path: string) => gemmaUrl(path);
  return (
    <SectionCard title="Downloads" subtitle="Bulk data and metadata">
      <ul className="text-sm space-y-1.5 text-sky-700 dark:text-sky-300">
        <li>
          <a
            className="hover:underline inline-flex items-center gap-1"
            href={u(`/expressionExperiment/downloadExpressionExperiment.html?id=${id}`)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Expression matrix <ExternalLink size={11} />
          </a>
        </li>
        <li>
          <a
            className="hover:underline inline-flex items-center gap-1"
            href={u(`/expressionExperiment/downloadDEA.html?id=${id}`)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Differential expression results <ExternalLink size={11} />
          </a>
        </li>
        <li>
          <a
            className="hover:underline inline-flex items-center gap-1"
            href={u(`/expressionExperiment/showExpressionExperiment.html?id=${id}`)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Legacy Gemma page (full details) <ExternalLink size={11} />
          </a>
        </li>
      </ul>
    </SectionCard>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function GapBadge({ label = "backend wire pending" }: { label?: string }) {
  return (
    <span
      className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700"
      title="This section is scaffolded — backend endpoint or data wiring needed."
    >
      {label}
    </span>
  );
}

function buildSyntheticDataset(numRows: number, numCols: number): HeatmapData {
  const rng = mulberry32(1337);
  const values: Array<Array<number | null>> = [];
  const groupIsUp = (i: number) => i % 2 === 0;
  const colIsTreated = (j: number) => j >= numCols / 2;
  for (let i = 0; i < numRows; i++) {
    const row: Array<number | null> = [];
    for (let j = 0; j < numCols; j++) {
      const signal = colIsTreated(j) ? (groupIsUp(i) ? 1.5 : -1.5) : 0;
      const noise = (rng() - 0.5) * 1.1;
      row.push(rng() < 0.005 ? null : signal + noise);
    }
    values.push(row);
  }
  const rowLabels = Array.from(
    { length: numRows },
    (_, i) => `gene_${String(i + 1).padStart(3, "0")}`,
  );
  const colLabels = Array.from({ length: numCols }, (_, j) => `sample_${j + 1}`);
  const treatment: CategoricalAnnotation = {
    name: "treatment",
    values: Array.from({ length: numCols }, (_, j) =>
      colIsTreated(j) ? "treated" : "control",
    ),
    palette: { treated: "#ef4444", control: "#9ca3af" },
  };
  return { values, rowLabels, colLabels, colAnnotations: [treatment] };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Backend gaps for REACT_PORT_HANDOFF.md ──────────────────────────
//
// Endpoints needed for full functionality of each tab:
//
// Design tab:
// - GET /rest/v2/datasets/{id}/factors
//     Factor[] with category, factorValues[], sample assignments.
//
// Samples tab:
// - GET /rest/v2/datasets/{id}/samples
//     BioAssay[] with biomaterial id, GEO sample id, characteristics,
//     factor-value assignments. Curation app already has the table UI
//     (apps/curation/src/features/samples/) — port read-only.
//
// Expression tab:
// - GET /rest/v2/datasets/{id}/analyses/differential
//     Per-experiment list of DE analyses with result-set ids.
// - GET /rest/v2/datasets/{id}/analyses/differential/resultSets/{rsId}/results
//     Top genes per result set: gene symbol, log2FC, q-value, t-stat.
// - GET /rest/v2/datasets/{id}/expressions/genes?gene=<ids>
//     Expression vectors for a list of genes × samples (feeds HeatmapWidget).
//
// File asks in apps/browser/REACT_PORT_HANDOFF.md once shape preferences land.
