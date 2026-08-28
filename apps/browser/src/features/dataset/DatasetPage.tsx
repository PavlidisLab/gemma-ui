// Public, read-only Expression Experiment page.

import { useMemo, useRef, useState, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient, type QueryFunctionContext } from "@tanstack/react-query";
import { Link, useParams, useNavigate, useSearch } from "@tanstack/react-router";
import { marked } from "marked";
import { ExternalLink, Pencil, ChevronRight } from "lucide-react";
import { useDocumentTitle, pageTitle } from "@gemma/ui";
import { useMe } from "@/api/auth";
import { curationUrl } from "@/lib/appLinks";
import {
  groupStatementsBySubject,
  statementHasPair,
  type StatementGroup,
} from "@/lib/statementGroups";
import {
  getDatasetById,
  getDatasetAnnotations,
  getDatasetDesign,
  getDatasetPlatforms,
  getDatasetSamples,
  getDatasetQuantitationTypes,
  getDatasetPublications,
  getDatasetPipelineStatus,
  getDatasetDiffExAnalyses,
  getDatasetResultSets,
  getTopDiffExpressedGenes,
  getPvalueDistribution,
  datasetDataDownloadUrl,
  downloadResultSetTsv,
} from "@/api/endpoints";
import { HeatmapWidget } from "@gemma/heatmap";
import type {
  HeatmapData,
  HeatmapPayload,
  HeatmapPayloadColumn,
  HeatmapPayloadRow,
  Factor,
} from "@gemma/heatmap";
import { VisualizeTab } from "./VisualizeTab";
import { DiagnosticsRow } from "./diagnostics/DiagnosticsRow";
import { OntologyTermChip } from "@/components/OntologyTermChip";
import { isBaselineFactorValue, isBaselineTerm } from "@/lib/baseline";
import { tintForIndex, compareValuesNatural } from "@/lib/valueTint";
import { GEMMA_1_LABEL, useGemma1Url } from "@/features/shared/gemma1";
import { SHOW_GEEQ } from "@/lib/geeq";
import { capitalizeFirstLetter } from "@/lib/filter";
import type {
  Dataset,
  DatasetAnnotation,
  BioAssay,
  QuantitationType,
  ExperimentalDesign,
  BioMaterialFactorValueAssignment,
  ExperimentalFactorEntry,
  FactorValueBasic,
  Publication,
  PipelineStatus,
  DiffExAnalysis,
  DiffExNestedResultSet,
  DiffExResultSet,
  DiffExpressionResponse,
  GeeqScores,
  PvalueDistribution,
} from "@/lib/types";
import { niceTicks } from "@gemma/diagnostics";

type TabId =
  | "overview"
  | "design"
  | "diffex"
  | "samples"
  | "diagnostics"
  | "visualize"
  | "downloads"
  | "quantitationtypes";

// ``adminOnly`` tabs are hidden from the nav for non-admins AND their
// content is gated in DatasetPage, so a hand-typed ``?tab=`` URL can't
// reach them either.
const TABS: { id: TabId; label: string; adminOnly?: boolean }[] = [
  { id: "overview",         label: "Overview"                },
  { id: "design",           label: "Design"                  },
  { id: "diffex",           label: "Differential Expression" },
  { id: "samples",          label: "Samples"                 },
  { id: "diagnostics",      label: "Diagnostics"             },
  { id: "visualize",        label: "Expression"              },
  { id: "downloads",        label: "Downloads"               },
  { id: "quantitationtypes", label: "Quantitation Types", adminOnly: true },
];

function isTabId(s: unknown): s is TabId {
  return typeof s === "string" && TABS.some((t) => t.id === s);
}

export function DatasetPage() {
  const { id } = useParams({ from: "/dataset/$id" });
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { tab?: string };
  const me = useMe();
  const isAdmin = !!me.data?.authorities?.includes("GROUP_ADMIN");
  const requestedTab: TabId = isTabId(search.tab) ? search.tab : "overview";
  // Fall back to Overview if a non-admin lands on an admin-only tab
  // (e.g. via a shared / hand-typed ``?tab=`` URL).
  const activeTab: TabId =
    !isAdmin && TABS.find((t) => t.id === requestedTab)?.adminOnly
      ? "overview"
      : requestedTab;

  const ds = useQuery({
    queryKey: ["dataset", id],
    queryFn: ({ signal }) => getDatasetById(id, signal),
  });

  // Name the tab after the dataset. Every tab used to read "Gemma
  // Browser", so several open datasets were several identical tabs.
  // The accession leads because tabs truncate from the right, and it is
  // the part worth keeping. Called before the early returns below —
  // it's a hook.
  useDocumentTitle(pageTitle(ds.data?.shortName, "Gemma Browser"));

  if (ds.isLoading) return <PageShell><SkeletonBanner /></PageShell>;
  if (ds.isError || !ds.data) return <NotFoundCard id={id} />;

  const dataset = ds.data;

  const setTab = (tab: TabId) =>
    navigate({
      to: "/dataset/$id",
      params: { id: dataset.shortName ?? String(dataset.id) },
      search: tab === "overview" ? {} : { tab },
      replace: true,
    });

  return (
    <PageShell>
      <Banner dataset={dataset} activeTab={activeTab} onTabChange={setTab} isAdmin={isAdmin} />
      <div className="mx-auto w-full max-w-[1200px] px-6 py-6 space-y-6">
        {activeTab === "overview"   && <OverviewTab   dataset={dataset} />}
        {activeTab === "design"     && <DesignTab     datasetId={dataset.id ?? Number(id)} />}
        {activeTab === "diffex"     && <DifferentialExpressionTab datasetId={dataset.id ?? Number(id)} />}
        {activeTab === "samples"    && <SamplesTab    datasetId={dataset.id ?? Number(id)} nSamples={dataset.numberOfBioAssays} />}
        {activeTab === "diagnostics" && <ExpressionTab datasetId={dataset.id ?? Number(id)} />}
        {activeTab === "visualize"  && <VisualizeTab  dataset={dataset} isAdmin={isAdmin} />}
        {activeTab === "downloads"  && <DownloadsTab  dataset={dataset} />}
        {activeTab === "quantitationtypes" && isAdmin && <QuantitationTypesTab datasetId={dataset.id ?? Number(id)} />}
      </div>
    </PageShell>
  );
}

// ─── Layout helpers ───────────────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="h-full overflow-auto bg-slate-50">{children}</div>;
}

function SectionCard({
  title, subtitle, right, children,
}: {
  title: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-slate-200 rounded shadow-sm">
      <header className="flex items-baseline justify-between px-5 py-3 border-b border-slate-200 gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-wide">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {right}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function Empty({ msg }: { msg: string }) {
  return <p className="text-xs text-slate-500 italic">{msg}</p>;
}

// ─── Banner ───────────────────────────────────────────────────────────────────

function Banner({
  dataset, activeTab, onTabChange, isAdmin,
}: {
  dataset: Dataset; activeTab: TabId; onTabChange: (t: TabId) => void; isAdmin: boolean;
}) {
  const geo = dataset.accession?.accession;
  const geeq = dataset.geeq;
  const gemma1Url = useGemma1Url(
    `/expressionExperiment/showExpressionExperiment.html?id=${dataset.id}`,
  );
  const me = useMe();
  const curateHref = me.data ? curationUrl(`/#/experiments/${dataset.id}`) : null;

  const pipeline = useQuery({
    queryKey: ["pipelineStatus", dataset.id],
    queryFn: ({ signal }) => getDatasetPipelineStatus(dataset.id, signal),
    staleTime: 5 * 60_000,
  });
  const ps = pipeline.data ?? null;

  return (
    <section className="sticky top-0 z-10 bg-white border-b border-slate-200">
      <div className="h-1 bg-gradient-to-r from-amber-500 via-slate-900 to-sky-500" />
      <div className="mx-auto w-full max-w-[1200px] px-6 py-3 flex gap-4 flex-wrap items-start">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-3 flex-wrap">
            {/* Plain text, not a link: this used to jump to the Gemma
                1.0 page for the dataset you're already looking at. */}
            <span className="text-lg font-semibold text-slate-900">
              {dataset.shortName}
            </span>
            <h1 className="text-sm text-slate-600 leading-snug min-w-0">{dataset.name}</h1>
          </div>
          <div className="mt-1 text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
            <span>{dataset.taxon?.commonName ?? "—"}</span>
            <span>{dataset.numberOfBioAssays} samples</span>
            {geo && (
              <a href={`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${geo}`}
                target="_blank" rel="noopener noreferrer"
                className="text-sky-700 hover:underline inline-flex items-center gap-1">
                {geo}<ExternalLink size={11} />
              </a>
            )}
            {gemma1Url && (
              <a href={gemma1Url} target="_blank" rel="noopener noreferrer"
                className="text-sky-700 hover:underline inline-flex items-center gap-1">
                {GEMMA_1_LABEL}<ExternalLink size={11} />
              </a>
            )}
            {curateHref && (
              <a href={curateHref} target="_blank" rel="noopener noreferrer"
                className="text-sky-700 hover:underline inline-flex items-center gap-1"
                title="Open this experiment in the curation app">
                Curate<Pencil size={11} />
              </a>
            )}
          </div>
          {ps && <PipelineStatusRow ps={ps} />}
        </div>
        {SHOW_GEEQ && geeq && <GeeqChip geeq={geeq} />}
        {ps?.troubled && (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 shrink-0"
            title={ps.troubleDetails ?? undefined}>
            troubled
          </span>
        )}
      </div>
      <div className="mx-auto w-full max-w-[1200px] px-6">
        <nav className="flex items-center gap-1 -mb-px overflow-x-auto">
          {TABS.filter((t) => !t.adminOnly || isAdmin).map((t) => (
            <button key={t.id} type="button" onClick={() => onTabChange(t.id)}
              className={"px-3 py-2 text-sm cursor-pointer border-b-2 bg-transparent " +
                (t.id === activeTab
                  ? "border-sky-600 text-slate-900 font-medium"
                  : "border-transparent text-slate-600 hover:text-slate-900")}>
              {t.label}
            </button>
          ))}
        </nav>
      </div>
    </section>
  );
}

const STEP_LABELS: Record<string, string> = {
  preprocess: "Processed", batchInfo: "Batch", pca: "PCA",
  sampleCorrelation: "Corr", meanVariance: "MV", dea: "DEA",
};

function PipelineStatusRow({ ps }: { ps: PipelineStatus }) {
  const shown = ps.steps.filter(
    (s) => s.state !== "notApplicable" && s.step in STEP_LABELS,
  );
  if (!shown.length) return null;
  return (
    <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
      {shown.map((s) => (
        <span key={s.step}
          title={s.lastRun ? `${s.step}: ${s.state} — ${s.lastRun}` : `${s.step}: ${s.state}`}
          className={
            "text-[10px] px-1.5 py-0.5 rounded border font-mono " +
            (s.state === "ok"     ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
             s.state === "failed" ? "bg-red-50 text-red-700 border-red-200" :
                                    "bg-slate-100 text-slate-500 border-slate-200")
          }>
          {STEP_LABELS[s.step]}
        </span>
      ))}
    </div>
  );
}

// ─── GEEQ popover ─────────────────────────────────────────────────────────────

// GEEQ sub-score labels — keys mirror the actual wire field names
// emitted by gemma-rest's GeeqValueObject (see GeeqScores in
// @/lib/types). Wrong keys here would silently drop a row from the
// breakdown popover. Quality scores capture how clean the data
// actually is (outliers, replicate behaviour, batch effects).
//
// The suitability half (publication, platform amount, raw data, sample
// size) is gone: it was removed from the score, so showing its
// sub-scores would describe a number nobody computes anymore.
const Q_SCORE_LABELS: Record<string, string> = {
  qScoreOutliers:                  "Few outliers",
  qScoreSampleMeanCorrelation:     "Sample correlation (mean)",
  qScoreSampleMedianCorrelation:   "Sample correlation (median)",
  qScoreSampleCorrelationVariance: "Sample correlation (variance)",
  qScoreReplicates:                "Has replicates",
  qScorePlatformsTech:             "Platform technology",
  qScoreBatchInfo:                 "Batch info available",
  qScorePublicBatchEffect:         "Low batch effect",
  qScorePublicBatchConfound:       "Low batch confound",
};

function GeeqChip({ geeq }: { geeq: GeeqScores }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const score = geeq.publicQualityScore;
  if (score == null) return null;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 cursor-pointer"
        title="GEEQ quality score — click for breakdown"
      >
        GEEQ {score.toFixed(2)}
      </button>
      {open && <GeeqPopover geeq={geeq} />}
    </div>
  );
}

function GeeqPopover({ geeq }: { geeq: GeeqScores }) {
  return (
    <div className="absolute right-0 top-full mt-1 z-50 w-72 bg-white border border-slate-200 rounded shadow-lg text-[11px]">
      <div className="px-3 py-2 border-b border-slate-100">
        <span className="text-xs font-semibold text-slate-700">GEEQ scores</span>
      </div>
      <div className="divide-y divide-slate-100">
        <ScoreGroup label="Quality" scores={geeq} labels={Q_SCORE_LABELS} />
      </div>
      <div className="px-3 py-1.5 border-t border-slate-100 text-[10px] text-slate-400">
        Scores range −1 to 1; higher is better.
      </div>
    </div>
  );
}

function ScoreGroup({
  label, scores, labels,
}: {
  label: string;
  scores: GeeqScores;
  labels: Record<string, string>;
}) {
  const entries = Object.entries(labels)
    .map(([key, name]) => ({ key, name, value: scores[key] as number | null | undefined }))
    .filter((e) => e.value != null);

  if (!entries.length) return null;

  return (
    <div className="px-3 py-2 space-y-1.5">
      <div className="text-[10px] uppercase tracking-wide text-slate-400 font-medium mb-1">
        {label}
      </div>
      {entries.map(({ key, name, value }) => (
        <ScoreRow key={key} name={name} value={value!} />
      ))}
    </div>
  );
}

function ScoreRow({ name, value }: { name: string; value: number }) {
  // Normalise −1…1 → 0…100% for the bar width
  const pct = Math.round(((value + 1) / 2) * 100);
  const barColor =
    value >= 0.5  ? "bg-emerald-400" :
    value >= 0    ? "bg-amber-400"   :
                    "bg-rose-400";
  return (
    <div className="flex items-center gap-2">
      <span className="w-36 shrink-0 text-slate-600 truncate" title={name}>{name}</span>
      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right tabular-nums text-slate-500">{value.toFixed(2)}</span>
    </div>
  );
}

function SkeletonBanner() {
  return (
    <div className="bg-white border-b border-slate-200">
      <div className="h-1 bg-gradient-to-r from-amber-500 via-slate-900 to-sky-500" />
      <div className="mx-auto w-full max-w-[1200px] px-6 py-3 animate-pulse">
        <div className="h-4 w-24 bg-slate-200 rounded" />
        <div className="h-3 mt-3 w-2/3 bg-slate-200 rounded" />
      </div>
    </div>
  );
}

function NotFoundCard({ id }: { id: string }) {
  return (
    <PageShell>
      <div className="mx-auto w-full max-w-[1200px] px-6 py-6">
        <SectionCard title="Not found">
          <p className="text-sm text-slate-600">No experiment found for id <span className="font-mono">{id}</span>.</p>
        </SectionCard>
      </div>
    </PageShell>
  );
}

// ─── Overview tab ─────────────────────────────────────────────────────────────

function OverviewTab({ dataset }: { dataset: Dataset }) {
  const ann = useQuery({
    queryKey: ["datasetAnnotations", dataset.id],
    queryFn: ({ signal }) => getDatasetAnnotations(dataset.id, signal),
  });
  const pubs = useQuery({
    queryKey: ["datasetPublications", dataset.id],
    queryFn: ({ signal }) => getDatasetPublications(dataset.id, signal),
  });
  return (
    <>
      <DescriptionSection dataset={dataset} />
      <AnnotationsSection annotations={ann.data?.data ?? []} loading={ann.isLoading} />
      <PublicationsSection publications={pubs.data ?? []} loading={pubs.isLoading} failed={pubs.isError} />
    </>
  );
}

function DescriptionSection({ dataset }: { dataset: Dataset }) {
  const html = useMemo(() => {
    if (!dataset.description) return null;
    return marked.parse(dataset.description, { async: false }) as string;
  }, [dataset.description]);
  return (
    <SectionCard title="Description">
      {html
        ? <div className="prose prose-sm max-w-none text-sm text-slate-700"
               dangerouslySetInnerHTML={{ __html: html }} />
        : <Empty msg="no description provided" />}
    </SectionCard>
  );
}

function AnnotationsSection({ annotations, loading }: { annotations: DatasetAnnotation[]; loading: boolean }) {
  // Drop baseline / reference-level placeholders ("reference subject
  // role" etc.) — they mark a factor's control level in curation and
  // carry nothing for a browsing reader. Same rule the Design tab uses.
  const visible = useMemo(
    () => annotations.filter((a) => !isBaselineTerm(a.termName, a.termUri)),
    [annotations],
  );
  const grouped = useMemo(() => {
    const m = new Map<string, DatasetAnnotation[]>();
    for (const a of visible) {
      const key = a.className ?? "uncategorized";
      const list = m.get(key) ?? [];
      list.push(a);
      m.set(key, list);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);

  return (
    <SectionCard title="Annotations"
      subtitle={loading ? "loading…" : `${visible.length} term${visible.length === 1 ? "" : "s"}`}>
      {loading ? <div className="h-6 w-2/3 bg-slate-200 rounded animate-pulse" /> :
       visible.length === 0 ? <Empty msg="no annotations" /> : (
        <div className="space-y-2">
          {grouped.map(([cat, terms]) => (
            <div key={cat} className="flex items-baseline gap-2 flex-wrap">
              <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{cat}</span>
              {terms.map((t, i) => (
                <OntologyTermChip key={`${t.termUri ?? t.termName}-${i}`} uri={t.termUri}>
                  {t.termName}
                </OntologyTermChip>
              ))}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

/** Compact publication list — no section card / header chrome. One
 *  publication is the common case, so the card-shaped wrapper + a
 *  "1" subtitle wasted vertical real estate. Multi-pub datasets are
 *  rare; when they happen each publication stacks as its own row. */
function PublicationsSection({ publications, loading, failed }: { publications: Publication[]; loading: boolean; failed: boolean }) {
  if (loading) {
    return <div className="h-5 w-1/3 bg-slate-200 rounded animate-pulse" />;
  }
  // A failed fetch is not the same as an unpublished dataset — stay
  // silent rather than assert an absence we didn't establish.
  if (failed) return null;
  if (publications.length === 0) return <Empty msg="no publication available" />;
  return (
    <ul className="space-y-1.5">
      {publications.map((p, i) => (
        <li key={p.id ?? i} className="text-sm leading-snug">
          <span className="font-medium text-slate-800">
            {p.title ?? "Untitled"}
          </span>
          {p.authorList ? (
            <span className="text-xs text-slate-500">
              {" — "}
              <span className="line-clamp-1 inline">{p.authorList}</span>
            </span>
          ) : null}
          <span className="text-xs text-slate-500 ml-1">
            {[
              p.publication,
              p.publicationDate
                ? String(new Date(p.publicationDate).getFullYear())
                : null,
              p.volume && p.issue ? `Vol ${p.volume}(${p.issue})` : null,
              p.pages ? `pp.${p.pages}` : null,
            ]
              .filter(Boolean)
              .map((s, idx, arr) => (
                <span key={idx}>
                  {s}
                  {idx < arr.length - 1 ? ", " : ""}
                </span>
              ))}
          </span>
          {p.pubAccession ? (
            <a
              href={`https://pubmed.ncbi.nlm.nih.gov/${p.pubAccession}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-700 hover:underline inline-flex items-center gap-0.5 text-xs ml-1.5"
            >
              PMID:{p.pubAccession}
              <ExternalLink size={10} />
            </a>
          ) : null}
          {p.retracted ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 ml-1.5">
              RETRACTED
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// ─── Design tab ───────────────────────────────────────────────────────────────

/**
 * Read-only port of the curator-UI design view, simplified for
 * public browse. Rules adopted from
 * ``apps/curation/src/features/design/`` and worth re-stating here
 * because they live behind a few small components in curation:
 *
 *  - **Batch / block factors are nuisance variables**, not real
 *    biological factors. They sort last and live under a separate
 *    "Nuisance variables" header so the reader's eye lands on the
 *    biological factors first. EFC category ``block`` or factor
 *    name ``batch`` triggers the bucket.
 *  - **Factor card palette = sky** (mirrors the curation factor
 *    cards). One consistent colour learns the reader "blue = factor".
 *  - **FV identity comes from S-P-O statements when present**, with
 *    the free-text label as fallback. A genotype FV like
 *    ``Sox9 has_genotype Overexpression`` reads better as a
 *    structured triple than as the server's "summary" string.
 *  - **Ontology rendering**: emerald chip + CURIE tail when URI
 *    present; muted italic chip when free-text. Predicate is a
 *    muted slate chip — connective tissue, not the load-bearing
 *    term.
 *  - **Baseline indicator**: a small amber pill on the FV row when
 *    flagged. The Gemma 1.x design endpoint doesn't always populate
 *    ``isBaseline`` — when absent we skip the pill rather than
 *    guessing.
 *
 *  No editing affordances. Browse users see structure, not chrome.
 */
function DesignTab({ datasetId }: { datasetId: number }) {
  const q = useQuery({
    queryKey: ["datasetDesign", datasetId],
    queryFn: ({ signal }) => getDatasetDesign(datasetId, signal),
  });

  if (q.isLoading) return <SectionCard title="Experimental design"><LoadingRow /></SectionCard>;
  if (q.isError)   return <SectionCard title="Experimental design"><ErrorRow /></SectionCard>;
  if (!q.data || !q.data.experimentalFactors.length)
    return <SectionCard title="Experimental design"><Empty msg="no experimental design recorded" /></SectionCard>;

  const design: ExperimentalDesign = q.data;
  // Split bio vs nuisance. EFC category trumps factor name — a
  // factor named "treatment_batch" but categorised as ``treatment``
  // is still biological. Match curation's lower-case label check.
  const bio: typeof design.experimentalFactors = [];
  const nuisance: typeof design.experimentalFactors = [];
  for (const f of design.experimentalFactors) {
    if (isNuisanceFactor(f)) nuisance.push(f);
    else bio.push(f);
  }
  // How many samples carry each factor value — the same
  // per-sample→FV assignment the crosstab pivots, tallied per FV id so
  // each detail row can show its sample count.
  const sampleCountByFvId = new Map<number, number>();
  for (const a of design.bioMaterialAssignments) {
    for (const id of a.factorValueIds ?? []) {
      sampleCountByFvId.set(id, (sampleCountByFvId.get(id) ?? 0) + 1);
    }
  }
  return (
    <div className="space-y-4">
      {/* Lead with the sample-breakdown crosstab — the standalone view
          of how samples partition across the design (mirrors the
          curator-ui overview's Design table). The per-factor detail
          cards stay below for the value-by-value / statement view. */}
      <DesignBreakdown design={design} />
      <SectionCard
        title="Factor details"
        subtitle={`${bio.length} biological factor${bio.length === 1 ? "" : "s"}${
          nuisance.length ? ` · ${nuisance.length} nuisance` : ""
        }`}
      >
        <div className="space-y-3">
          {bio.map((f) => (
            <FactorCard
              key={f.id}
              factor={f}
              sampleCountByFvId={sampleCountByFvId}
            />
          ))}
          {nuisance.length > 0 ? (
            <div className="pt-2 mt-2 border-t border-slate-200">
              <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1.5 px-1">
                Nuisance variables
              </div>
              <div className="space-y-2">
                {nuisance.map((f) => (
                  <FactorCard
                    key={f.id}
                    factor={f}
                    nuisance
                    sampleCountByFvId={sampleCountByFvId}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </SectionCard>
    </div>
  );
}

/** Display label for a factor value in the crosstab: the server summary
 *  / free-text label, falling back to a characteristic value or the
 *  statement subject. Baseline-role placeholder labels ("reference
 *  subject role" etc.) collapse to "baseline" — a reader needn't see the
 *  role term — but a meaningful label that merely HAS a baseline URI
 *  (e.g. "0 h") is kept as-is (we only substitute when the visible label
 *  itself is the placeholder). */
function factorValueLabel(v: FactorValueBasic): string {
  const raw = (
    v.summary ||
    v.value ||
    v.characteristics?.find((c) => (c.value ?? "").trim())?.value ||
    v.statements?.find((s) => (s.subject ?? "").trim())?.subject ||
    ""
  ).trim();
  const label = raw || `FV ${v.id}`;
  return isBaselineTerm(label) ? "baseline" : label;
}

/** Label + ontology URI for a factor value, for chip rendering (the
 *  condition side of a DE contrast). Unlike {@link factorValueLabel} this
 *  keeps the real label (conditions are never the baseline placeholder)
 *  and surfaces the URI so the chip can show the CURIE + link out. */
function factorValueTerm(v: FactorValueBasic): {
  label: string;
  uri: string | null;
} {
  const char = v.characteristics?.find((c) => (c.value ?? "").trim());
  const stmt = v.statements?.find((s) => (s.subject ?? "").trim());
  const label = (
    v.summary ||
    v.value ||
    char?.value ||
    stmt?.subject ||
    `FV ${v.id}`
  ).trim();
  return { label, uri: char?.valueUri ?? stmt?.subjectUri ?? null };
}

const UNASSIGNED = "(unassigned)";

/** Sample-breakdown crosstab for the Design tab — one row per unique
 *  combination of categorical factor levels, an "Assays" count column,
 *  and colour-tinted cells so identical partitions line up visually.
 *  Sortable by any column. Continuous + nuisance factors are noted but
 *  kept out of the row tuples (per the curator-ui convention). Built to
 *  stand alone as the primary design view. */
function DesignBreakdown({ design }: { design: ExperimentalDesign }) {
  const factors = design.experimentalFactors;
  const assignments = design.bioMaterialAssignments;

  const isContinuous = (f: ExperimentalFactorEntry) => f.type === "continuous";
  const standard = factors.filter(
    (f) => !isNuisanceFactor(f) && !isContinuous(f),
  );
  const continuous = factors.filter(isContinuous);
  const nuisance = factors.filter(isNuisanceFactor);

  // Per standard factor: fvId → display label, used both to build the
  // row tuples and to resolve a sample's level in each column.
  const labelByFvIdByCol = useMemo(
    () =>
      standard.map((f) => {
        const m = new Map<number, string>();
        for (const v of f.values) {
          if (v.id != null) m.set(v.id, factorValueLabel(v));
        }
        return m;
      }),
    [standard],
  );

  // Crosstab rows: for each sample, the tuple of its level in every
  // standard factor; identical tuples collapse into one counted row.
  // A sample with no FV in some factor gets "(unassigned)" so the gap
  // surfaces instead of vanishing.
  const rows = useMemo(() => {
    if (standard.length === 0 || assignments.length === 0) return [];
    const buckets = new Map<string, { values: string[]; count: number }>();
    for (const a of assignments) {
      const assigned = new Set(a.factorValueIds ?? []);
      const tuple = standard.map((f, j) => {
        for (const v of f.values) {
          if (v.id != null && assigned.has(v.id)) {
            return labelByFvIdByCol[j].get(v.id) ?? UNASSIGNED;
          }
        }
        return UNASSIGNED;
      });
      const key = tuple.join("␟");
      const existing = buckets.get(key);
      if (existing) existing.count++;
      else buckets.set(key, { values: tuple, count: 1 });
    }
    return Array.from(buckets.values()).sort((a, b) =>
      compareValuesNatural(a.values.join(" / "), b.values.join(" / ")),
    );
  }, [standard, assignments, labelByFvIdByCol]);

  const [sort, setSort] = useState<
    { col: "assays" | number; dir: "asc" | "desc" } | null
  >(null);
  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) =>
      sort.col === "assays"
        ? (a.count - b.count) * sign
        : compareValuesNatural(a.values[sort.col], b.values[sort.col]) * sign,
    );
  }, [rows, sort]);

  // First-seen value index per column → shared tint. Walk rows in the
  // current display order so the tint tracks the active sort.
  const valueIdxByCol = useMemo(() => {
    const out: Array<Map<string, number>> = standard.map(() => new Map());
    for (const row of sortedRows) {
      row.values.forEach((v, j) => {
        if (v === UNASSIGNED) return;
        if (!out[j].has(v)) out[j].set(v, out[j].size);
      });
    }
    return out;
  }, [sortedRows, standard]);

  const onSortClick = (col: "assays" | number) =>
    setSort((cur) => {
      if (!cur || cur.col !== col) return { col, dir: "asc" };
      if (cur.dir === "asc") return { col, dir: "desc" };
      return null;
    });
  const sortArrow = (col: "assays" | number) =>
    !sort || sort.col !== col ? "" : sort.dir === "asc" ? " ▲" : " ▼";

  const factorHeader = (f: ExperimentalFactorEntry) =>
    f.name || f.category?.category || "(factor)";

  const fvTotal = factors.reduce((n, f) => n + f.values.length, 0);
  const confound = useMemo(
    () => detectBatchConfound(nuisance, standard, assignments),
    [nuisance, standard, assignments],
  );

  return (
    <SectionCard
      title="Experimental design"
      subtitle={`${assignments.length} sample${assignments.length === 1 ? "" : "s"}`}
    >
      {/* Cohort numbers + design notes strip. */}
      <div className="mb-2 flex items-baseline gap-3 flex-wrap text-[11px] text-slate-600">
        <span>
          <span className="font-mono font-medium text-slate-800">
            {assignments.length}
          </span>{" "}
          sample{assignments.length === 1 ? "" : "s"}
        </span>
        <span>
          <span className="font-mono font-medium text-slate-800">
            {factors.length}
          </span>{" "}
          factor{factors.length === 1 ? "" : "s"} /{" "}
          <span className="font-mono font-medium text-slate-800">{fvTotal}</span>{" "}
          value{fvTotal === 1 ? "" : "s"}
        </span>
        {confound ? (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-violet-900 border border-amber-300 font-medium"
            title={
              `Batch / block factor "${confound.batch.name || confound.batch.category?.category}" ` +
              `partitions samples identically to "${confound.with.name || confound.with.category?.category}". ` +
              "The batch effect can't be separated from the factor's effect in DEA."
            }
          >
            ⚠ batch confound
          </span>
        ) : null}
        {continuous.length > 0 ? (
          <span className="text-slate-500 italic">
            Continuous factor{continuous.length > 1 ? "s" : ""} not shown here (
            {continuous.map((f) => f.name || f.category?.category).join(", ")}).
          </span>
        ) : null}
      </div>

      {standard.length === 0 || rows.length === 0 ? (
        <p className="text-[11px] text-slate-500 italic">
          No categorical factors to cross-tabulate.
          {nuisance.length > 0
            ? ` ${nuisance.length} nuisance factor${nuisance.length === 1 ? "" : "s"} present (block / batch).`
            : ""}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse w-full">
            <thead>
              <tr className="bg-slate-50 text-slate-700">
                <th
                  className="px-2 py-1.5 text-left border border-slate-200 font-medium w-16 cursor-pointer select-none hover:bg-slate-100"
                  onClick={() => onSortClick("assays")}
                  title="click to sort by sample count"
                >
                  Samples{sortArrow("assays")}
                </th>
                {standard.map((f, colIdx) => (
                  <th
                    key={f.id}
                    className="px-2 py-1.5 text-left border border-slate-200 font-medium cursor-pointer select-none hover:bg-slate-100"
                    onClick={() => onSortClick(colIdx)}
                    title={`${factorHeader(f)}${f.description ? `\n${f.description}` : ""}\n\n(click to sort)`}
                  >
                    {factorHeader(f)}
                    {sortArrow(colIdx)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, i) => (
                <tr key={i}>
                  <td className="px-2 py-1 border border-slate-200 font-mono text-slate-700">
                    {row.count}
                  </td>
                  {row.values.map((v, j) => {
                    const tint =
                      v === UNASSIGNED
                        ? undefined
                        : tintForIndex(valueIdxByCol[j]?.get(v) ?? -1);
                    return (
                      <td
                        key={j}
                        className={
                          "px-2 py-1 border border-slate-200 " +
                          (v === UNASSIGNED
                            ? "text-rose-700 italic"
                            : "text-slate-700")
                        }
                        style={tint ? { backgroundColor: tint } : undefined}
                      >
                        {v}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nuisance.length > 0 ? (
        <div className="mt-2 text-[11px] text-slate-600">
          Nuisance / covariate factor{nuisance.length > 1 ? "s" : ""}:{" "}
          {nuisance
            .map((f) => {
              const k = f.values.length;
              return `${f.name || f.category?.category} (${k} level${k === 1 ? "" : "s"})`;
            })
            .join(", ")}
          .
        </div>
      ) : null}
    </SectionCard>
  );
}

/** Detect a confounded batch / block factor: every nuisance level
 *  contains exactly one level of some standard factor, so the batch
 *  effect can't be separated from that factor's effect in DEA. Returns
 *  the first confound found, or null. Browser port of the curator-ui
 *  check, keyed on per-sample ``factorValueIds``. */
function detectBatchConfound(
  nuisance: ExperimentalFactorEntry[],
  standard: ExperimentalFactorEntry[],
  assignments: BioMaterialFactorValueAssignment[],
): { batch: ExperimentalFactorEntry; with: ExperimentalFactorEntry } | null {
  if (nuisance.length === 0 || standard.length === 0) return null;
  // sampleId → level label, for one factor.
  const levelBySample = (f: ExperimentalFactorEntry): Map<number, string> => {
    const fvIds = new Map<number, string>();
    for (const v of f.values) {
      if (v.id != null) fvIds.set(v.id, factorValueLabel(v));
    }
    const out = new Map<number, string>();
    for (const a of assignments) {
      for (const id of a.factorValueIds ?? []) {
        const lab = fvIds.get(id);
        if (lab !== undefined) {
          out.set(a.bioMaterialId, lab);
          break;
        }
      }
    }
    return out;
  };
  for (const batch of nuisance) {
    const batchMap = levelBySample(batch);
    if (batchMap.size === 0) continue;
    for (const f of standard) {
      const fMap = levelBySample(f);
      const levelsByBatch = new Map<string, Set<string>>();
      for (const [sampleId, b] of batchMap) {
        const v = fMap.get(sampleId);
        if (v === undefined) continue;
        const s = levelsByBatch.get(b) ?? new Set<string>();
        s.add(v);
        levelsByBatch.set(b, s);
      }
      if (levelsByBatch.size < 2) continue;
      const confounded = [...levelsByBatch.values()].every((s) => s.size === 1);
      const observed = new Set(fMap.values());
      if (confounded && observed.size >= 2) return { batch, with: f };
    }
  }
  return null;
}

/** Match curation's bio-vs-nuisance partition. ``block`` and
 *  ``batch`` EFC categories are nuisance; ``batch`` as a factor name
 *  also counts because Gemma's importer sometimes names the scan-date
 *  batch factor ``batch`` while categorising it as ``block``. */
function isNuisanceFactor(f: ExperimentalFactorEntry): boolean {
  const cat = (f.category?.category || "").trim().toLowerCase();
  if (cat === "block" || cat === "batch") return true;
  const name = (f.name || "").trim().toLowerCase();
  if (name === "batch" || name === "block") return true;
  return false;
}

function FactorCard({
  factor,
  nuisance = false,
  sampleCountByFvId,
}: {
  factor: ExperimentalFactorEntry;
  nuisance?: boolean;
  sampleCountByFvId: Map<number, number>;
}) {
  const categoryLabel = factor.category?.category ?? null;
  const categoryUri = factor.category?.categoryUri ?? null;
  // Sort baselines first within the FV list (mirrors curation's
  // FactorValueList sort) so the reader's eye lands on the reference
  // level before treatment levels.
  const sortedValues = [...factor.values].sort((a, b) => {
    const aB = a.isBaseline ? 1 : 0;
    const bB = b.isBaseline ? 1 : 0;
    return bB - aB;
  });
  return (
    <div
      className={
        "rounded-lg border " +
        (nuisance
          ? "border-slate-200 bg-slate-50/60"
          : "border-sky-300 bg-sky-50/60")
      }
    >
      <header
        className={
          "px-3 py-1.5 border-b flex items-baseline gap-2 flex-wrap " +
          (nuisance ? "border-slate-200" : "border-sky-300")
        }
      >
        <span className="text-sm font-semibold text-slate-800">
          {factor.name || categoryLabel || `Factor ${factor.id}`}
        </span>
        {categoryLabel ? (
          <OntologyTermChip uri={categoryUri}>{categoryLabel}</OntologyTermChip>
        ) : null}
        <span className="text-[11px] text-slate-500">
          {factor.type === "continuous" ? "continuous" : `${factor.values.length} level${factor.values.length === 1 ? "" : "s"}`}
        </span>
        {factor.description ? (
          <span
            className="text-[11px] text-slate-500 italic line-clamp-1"
            title={factor.description}
          >
            — {factor.description}
          </span>
        ) : null}
      </header>
      {factor.values.length === 0 ? (
        <div className="px-3 py-2 text-xs text-slate-400 italic">
          no values
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {sortedValues.map((v) => (
            <FactorValueRow
              key={v.id}
              value={v}
              factor={factor}
              sampleCount={sampleCountByFvId.get(v.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** One FV row. Renders statements as S-P-O lines when present;
 *  otherwise falls back to the server-rendered ``summary`` (preferred)
 *  or the raw ``value`` label. Baseline FVs get a small amber pill
 *  on the left so they stand out in the list. */
function FactorValueRow({
  value,
  factor,
  sampleCount,
}: {
  value: FactorValueBasic;
  factor: ExperimentalFactorEntry;
  /** Number of samples assigned this factor value (from the design's
   *  per-sample assignments). Undefined when unknown. */
  sampleCount?: number;
}) {
  const stmts = value.statements ?? [];
  // FVs with no S-P-O statements still carry ontology identity in their
  // characteristics (value + valueUri) — render those as chips so the
  // CURIE shows, rather than flattening to the plain summary label.
  const chars = (value.characteristics ?? []).filter(
    (c) => (c.value ?? "").trim() || c.valueUri,
  );
  // Baseline / reference levels ("reference subject role" etc.) are
  // curation plumbing — a browsing reader needn't see the role term, just
  // that this is the control. Detect the baseline by its term (the wire's
  // `isBaseline` flag is best-effort and usually absent on the Gemma 1.x
  // design endpoint), collapse the row to a plain "baseline" marker, and
  // drop the role term from the chips so it never renders as a value.
  const isBaselineFv = isBaselineFactorValue(
    value.isBaseline,
    chars.some((c) => isBaselineTerm(c.value, c.valueUri)) ||
      stmts.some(
        (s) =>
          isBaselineTerm(s.subject, s.subjectUri) ||
          isBaselineTerm(s.object, s.objectUri),
      ),
  );
  const visibleChars = chars.filter(
    (c) => !isBaselineTerm(c.value, c.valueUri),
  );
  const visibleStmts = stmts.filter(
    (s) =>
      !(
        isBaselineTerm(s.subject, s.subjectUri) ||
        isBaselineTerm(s.object, s.objectUri)
      ),
  );
  const fallbackLabel = value.summary || value.value || `FV ${value.id}`;
  return (
    <li className="px-3 py-1.5 flex items-baseline gap-2 flex-wrap">
      <span
        className="inline-block w-2 text-center text-slate-400 leading-none"
        aria-hidden
      >
        ○
      </span>
      {isBaselineFv ? (
        <span
          className="text-[10px] uppercase tracking-wide font-semibold px-1 py-0 rounded bg-amber-100 text-amber-800 border border-amber-300"
          title="Baseline / reference level for this factor"
        >
          baseline
        </span>
      ) : null}
      {visibleStmts.length > 0 ? (
        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          {/* One line per SUBJECT, not per statement. Gemma stores the
              pairs flat and repeats the subject on each, so a value
              carrying "delivered for duration 2 d" and "delivered at
              dose 1 µM" printed GSK2879552 and its CURIE twice. */}
          {groupStatementsBySubject(visibleStmts).map((g, i) => (
            <StatementLine key={g.statements[0]?.id ?? i} group={g} />
          ))}
        </div>
      ) : !value.isMeasurement && visibleChars.length > 0 ? (
        <div className="flex items-baseline gap-1 flex-wrap flex-1 min-w-0">
          {visibleChars.map((c, i) => (
            <OntologyTermChip key={c.id ?? i} uri={c.valueUri ?? null}>
              {c.value ?? fallbackLabel}
            </OntologyTermChip>
          ))}
        </div>
      ) : isBaselineFv ? null : (
        <span className="text-xs text-slate-700 break-words flex-1 min-w-0">
          {fallbackLabel}
        </span>
      )}
      {factor.type === "continuous" && value.isMeasurement ? (
        <span className="text-[10px] text-slate-400 font-mono">numeric</span>
      ) : null}
      {sampleCount != null ? (
        <span
          className="ml-auto shrink-0 text-[11px] text-slate-500 tabular-nums"
          title={`${sampleCount} sample${sampleCount === 1 ? "" : "s"} assigned this value`}
        >
          <span className="font-mono font-semibold text-slate-700">
            {sampleCount}
          </span>{" "}
          {sampleCount === 1 ? "sample" : "samples"}
        </span>
      ) : null}
    </li>
  );
}

/** One SUBJECT and everything said about it — subject chip once,
 *  followed by each [predicate] object pair.
 *
 *  Ontology-resolved terms in emerald chips, predicate in slate, and
 *  missing parts omitted so a subject-only statement reads as just the
 *  subject. Same shape the curation editor uses for a multi-pair
 *  subject, so the two surfaces describe one value the same way. */
function StatementLine({ group }: { group: StatementGroup }) {
  const hasSubject = !!(group.subject || group.subjectUri);
  const pairs = group.statements.filter(statementHasPair);
  return (
    <div className="flex items-baseline gap-1 flex-wrap text-[12px]">
      {hasSubject ? (
        <OntologyTermChip uri={group.subjectUri ?? null}>
          {group.subject ?? ""}
        </OntologyTermChip>
      ) : null}
      {pairs.map((s, i) => {
        const hasPredicate = !!(s.predicate || s.predicateUri);
        const hasObject = !!(s.object || s.objectUri);
        return (
          <span
            key={s.id ?? i}
            className="inline-flex items-baseline gap-1 flex-wrap"
          >
            {hasPredicate ? (
              <OntologyTermChip
                uri={s.predicateUri ?? null}
                variant="predicate"
              >
                {s.predicate ?? ""}
              </OntologyTermChip>
            ) : null}
            {hasObject ? (
              <OntologyTermChip uri={s.objectUri ?? null}>
                {s.object ?? ""}
              </OntologyTermChip>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

// ─── Samples tab ──────────────────────────────────────────────────────────────

function SamplesTab({ datasetId, nSamples }: { datasetId: number; nSamples: number }) {
  const q = useQuery({
    queryKey: ["datasetSamples", datasetId],
    queryFn: ({ signal }) => getDatasetSamples(datasetId, signal),
  });

  // Shares the DesignTab's query key so the two dedupe / reuse cache.
  // Used only to resolve each experimental factor's human-readable
  // ``description`` for the column headers.
  const design = useQuery({
    queryKey: ["datasetDesign", datasetId],
    queryFn: ({ signal }) => getDatasetDesign(datasetId, signal),
  });

  const samples: BioAssay[] = q.data ?? [];

  // factorId → the design endpoint's ``description`` (used as the column
  // header). Kept separate from the samples data, which only carries the
  // factor's category.
  const factorDescriptions = useMemo(() => {
    const m = new Map<number, string>();
    for (const ef of design.data?.experimentalFactors ?? []) {
      if (ef.id != null && ef.description) m.set(ef.id, ef.description);
    }
    return m;
  }, [design.data]);

  // Pivot each sample's inline factorValues into one column per
  // experimental factor. Column order follows first appearance across
  // the samples, except "block" (batch) factors are always sunk to the
  // end — right before Flags — since they're bookkeeping, not biology.
  // The header is the factor's design ``description``, falling back to
  // the (capitalized) category, then the factor id.
  const factorColumns = useMemo(() => {
    const cols = new Map<number, { label: string; isBlock: boolean }>();
    for (const s of samples) {
      for (const fv of s.sample?.factorValues ?? []) {
        const fid = fv.experimentalFactorId;
        if (fid == null || cols.has(fid)) continue;
        const cat = fv.experimentalFactorCategory?.category;
        const label =
          factorDescriptions.get(fid) ||
          (cat ? capitalizeFirstLetter(cat) : `Factor ${fid}`);
        cols.set(fid, { label, isBlock: cat?.toLowerCase() === "block" });
      }
    }
    return [...cols.entries()]
      .map(([id, meta]) => ({ id, ...meta }))
      // Stable sort: non-block keep appearance order, block factors last.
      .sort((a, b) => Number(a.isBlock) - Number(b.isBlock));
  }, [samples, factorDescriptions]);

  return (
    <SectionCard title="Samples"
      subtitle={q.isLoading ? "loading…" : `${samples.length || nSamples} sample${nSamples === 1 ? "" : "s"}`}>
      {q.isLoading ? <LoadingRow /> : q.isError ? <ErrorRow /> : samples.length === 0 ? <Empty msg="no samples" /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-1.5 pr-4 font-medium text-slate-600">Name</th>
                <th className="text-left py-1.5 pr-4 font-medium text-slate-600">Accession</th>
                {factorColumns.map((c) => (
                  <th key={c.id} className="text-left py-1.5 pr-4 font-medium text-slate-600">
                    <span className="block max-w-[12rem] truncate" title={c.label}>
                      {c.label}
                    </span>
                  </th>
                ))}
                <th className="text-left py-1.5 font-medium text-slate-600">Flags</th>
              </tr>
            </thead>
            <tbody>
              {samples.map((s) => {
                const outlier = s.outlier || s.predictedOutlier || s.userFlaggedOutlier;
                return (
                  <tr key={s.id} className={"border-b border-slate-100 " + (outlier ? "bg-amber-50/40" : "")}>
                    <td className="py-1.5 pr-4 text-slate-800">
                      <span className="inline-flex items-center">
                        {s.name ?? s.shortName ?? `BA ${s.id}`}
                        <SampleMetaPopover assay={s} />
                      </span>
                    </td>
                    <td className="py-1.5 pr-4 font-mono text-slate-600">
                      {s.accession?.accession
                        ? <a href={`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${s.accession.accession}`}
                            target="_blank" rel="noopener noreferrer"
                            className="text-sky-700 hover:underline">
                            {s.accession.accession}
                          </a>
                        : "—"}
                    </td>
                    {factorColumns.map((c) => {
                      const fv = s.sample?.factorValues?.find((f) => f.experimentalFactorId === c.id);
                      return (
                        <td key={c.id} className="py-1.5 pr-4 text-slate-600">
                          {fv?.summary || fv?.value || "—"}
                        </td>
                      );
                    })}
                    <td className="py-1.5">
                      {s.userFlaggedOutlier && <FlagChip label="outlier" color="red" />}
                      {!s.userFlaggedOutlier && s.predictedOutlier && <FlagChip label="predicted outlier" color="amber" />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

/** Popover dimensions — kept in module scope so the flip-above /
 *  slide-left math can budget for the box before it paints. */
const SAMPLE_POPOVER_W = 340;
const SAMPLE_POPOVER_MAX_H = 420;
const SAMPLE_ANCHOR_OFFSET = 4;

/**
 * Tiny "i" chip beside a sample's name in the Samples table. Clicking
 * opens a popover with the sample's additional metadata — the
 * biomaterial characteristics (sex, tissue, molecular entity, …, each
 * with its ontology term where Gemma mapped one), platform, processing
 * date, and any free-text description — without widening the table,
 * whose columns stay limited to the experimental factors.
 *
 * Mirrors the curation app's ``BiomaterialMetaPopover`` (portal +
 * fixed-position pattern) because the table sits inside an
 * ``overflow-x-auto`` scroll container: an absolutely-positioned
 * popover would be clipped by that ancestor. The portal escapes the
 * boundary; viewport coords from the anchor's bounding rect keep it
 * visually attached. Closes on Esc / click-outside / resize.
 */
function SampleMetaPopover({ assay }: { assay: BioAssay }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      setPos(null);
      return;
    }
    const rect = anchorRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = rect.bottom + SAMPLE_ANCHOR_OFFSET;
    let left = rect.left;
    if (left + SAMPLE_POPOVER_W + 8 > vw) {
      left = Math.max(8, vw - SAMPLE_POPOVER_W - 8);
    }
    if (top + SAMPLE_POPOVER_MAX_H + 8 > vh) {
      const above = rect.top - SAMPLE_ANCHOR_OFFSET - SAMPLE_POPOVER_MAX_H;
      top = above >= 8 ? above : Math.max(8, vh - SAMPLE_POPOVER_MAX_H - 8);
    }
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const bm = assay.sample;
  const chars = (bm?.characteristics ?? []).filter(
    (c) => (c.value ?? "").trim() !== "",
  );
  const description =
    (assay.description ?? "").trim() || (bm?.description ?? "").trim() || "";
  const platform =
    assay.arrayDesign?.shortName || assay.arrayDesign?.name || null;
  const processed = assay.processingDate
    ? assay.processingDate.slice(0, 10)
    : null;
  const metadata = (assay.metadata ?? "").trim();

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-slate-300 bg-white text-slate-500 hover:bg-slate-50 hover:text-sky-700 text-[9px] leading-none font-bold ml-1.5 align-middle"
        title="show all metadata for this sample"
        aria-label="show sample metadata"
      >
        i
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={popoverRef}
              className="fixed z-50 bg-white border border-slate-200 rounded shadow-xl text-xs text-slate-700"
              style={{
                top: pos.top,
                left: pos.left,
                width: SAMPLE_POPOVER_W,
                maxHeight: SAMPLE_POPOVER_MAX_H,
              }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="px-3 py-2 border-b border-slate-100 flex items-baseline justify-between gap-2">
                <span className="font-semibold text-slate-800 truncate">
                  {assay.name ?? assay.shortName ?? `BA ${assay.id}`}
                </span>
                <button
                  type="button"
                  className="text-slate-400 hover:text-slate-700 shrink-0"
                  onClick={() => setOpen(false)}
                  title="close"
                >
                  ×
                </button>
              </div>
              <div
                className="px-3 py-2 space-y-2 overflow-auto"
                style={{ maxHeight: SAMPLE_POPOVER_MAX_H - 44 }}
              >
                {assay.accession?.accession ? (
                  <SampleMetaField label="Accession">
                    <a
                      href={`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${assay.accession.accession}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-sky-700 hover:underline"
                    >
                      {assay.accession.accession}
                    </a>
                  </SampleMetaField>
                ) : null}
                {platform ? (
                  <SampleMetaField label="Platform">
                    <span className="text-slate-800">{platform}</span>
                    {assay.arrayDesign?.name &&
                    assay.arrayDesign.name !== platform ? (
                      <span className="text-slate-500">
                        {" "}
                        · {assay.arrayDesign.name}
                      </span>
                    ) : null}
                  </SampleMetaField>
                ) : null}
                {processed ? (
                  <SampleMetaField label="Processed">
                    <span className="text-slate-700 tabular-nums">
                      {processed}
                    </span>
                  </SampleMetaField>
                ) : null}
                {description ? (
                  <SampleMetaField label="Description">
                    <div className="text-slate-700 whitespace-pre-wrap break-words">
                      {description}
                    </div>
                  </SampleMetaField>
                ) : null}
                {metadata ? (
                  <SampleMetaField label="Metadata">
                    <div className="text-slate-700 whitespace-pre-wrap break-words">
                      {metadata}
                    </div>
                  </SampleMetaField>
                ) : null}
                <SampleMetaField label={`Characteristics (${chars.length})`}>
                  {chars.length === 0 ? (
                    <div className="italic text-slate-400">none recorded</div>
                  ) : (
                    <table className="w-full text-[11px]">
                      <tbody>
                        {chars.map((c, i) => (
                          <tr
                            key={c.id ?? i}
                            className="align-top border-b border-slate-100 last:border-b-0"
                          >
                            <td className="py-0.5 pr-2 text-slate-500 whitespace-nowrap">
                              {c.category ?? "—"}
                            </td>
                            <td className="py-0.5 text-slate-800 break-words">
                              {c.valueUri ? (
                                <OntologyTermChip uri={c.valueUri}>
                                  {c.value}
                                </OntologyTermChip>
                              ) : (
                                c.value
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </SampleMetaField>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function SampleMetaField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-0.5">
        {label}
      </div>
      {children}
    </div>
  );
}

// ─── Quantitation Types tab (admin-only) ──────────────────────────────────────

// Boolean QT attributes surfaced as chips — only the ``true`` ones render.
// ``isPreferred`` / ``isMaskedPreferred`` get the sky highlight; the rest
// are neutral. Keyed on QuantitationType so the flags stay in sync with
// the type.
const QT_FLAGS: { key: keyof QuantitationType; label: string; color: "sky" | "slate" }[] = [
  { key: "isPreferred",           label: "Preferred",       color: "sky"   },
  { key: "isMaskedPreferred",     label: "Masked preferred", color: "sky"  },
  { key: "isNormalized",          label: "Normalized",      color: "slate" },
  { key: "isBackgroundSubtracted", label: "Bg-subtracted",  color: "slate" },
  { key: "isBatchCorrected",      label: "Batch-corrected", color: "slate" },
  { key: "isRecomputedFromRawData", label: "Recomputed",    color: "slate" },
  { key: "isRatio",               label: "Ratio",           color: "slate" },
  { key: "isBackground",          label: "Background",      color: "slate" },
];

function QuantitationTypesTab({ datasetId }: { datasetId: number }) {
  const q = useQuery({
    queryKey: ["datasetQuantitationTypes", datasetId],
    queryFn: ({ signal }) => getDatasetQuantitationTypes(datasetId, signal),
  });
  const qts: QuantitationType[] = q.data ?? [];

  return (
    <SectionCard title="Quantitation types"
      subtitle={q.isLoading ? "loading…" : `${qts.length} quantitation type${qts.length === 1 ? "" : "s"}`}>
      {q.isLoading ? <LoadingRow /> : q.isError ? <ErrorRow /> : qts.length === 0 ? <Empty msg="no quantitation types" /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-1.5 pr-4 font-medium text-slate-600">Name</th>
                <th className="text-left py-1.5 pr-4 font-medium text-slate-600">General type</th>
                <th className="text-left py-1.5 pr-4 font-medium text-slate-600">Type</th>
                <th className="text-left py-1.5 pr-4 font-medium text-slate-600">Representation</th>
                <th className="text-left py-1.5 pr-4 font-medium text-slate-600">Scale</th>
                <th className="text-left py-1.5 font-medium text-slate-600">Flags</th>
              </tr>
            </thead>
            <tbody>
              {qts.map((qt) => (
                <tr key={qt.id} className={"border-b border-slate-100 " + (qt.isPreferred ? "bg-sky-50/40" : "")}>
                  <td className="py-1.5 pr-4 text-slate-800 align-top">
                    <div className="font-medium">{qt.name ?? `QT ${qt.id}`}</div>
                    {qt.description && <div className="text-slate-500 mt-0.5">{qt.description}</div>}
                  </td>
                  <td className="py-1.5 pr-4 text-slate-600 align-top">{qt.generalType ?? "—"}</td>
                  <td className="py-1.5 pr-4 text-slate-600 align-top">{qt.type ?? "—"}</td>
                  <td className="py-1.5 pr-4 text-slate-600 align-top">{qt.representation ?? "—"}</td>
                  <td className="py-1.5 pr-4 text-slate-600 align-top">{qt.scale ?? "—"}</td>
                  <td className="py-1.5 align-top">
                    <div className="flex flex-wrap gap-1">
                      {QT_FLAGS.filter((f) => qt[f.key]).map((f) => (
                        <FlagChip key={f.key} label={f.label} color={f.color} />
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

function FlagChip({ label, color }: { label: string; color: "red" | "amber" | "sky" | "slate" }) {
  const cls =
    color === "red"   ? "bg-red-50 text-red-700 border-red-200"   :
    color === "amber" ? "bg-amber-50 text-amber-700 border-amber-200" :
    color === "sky"   ? "bg-sky-50 text-sky-700 border-sky-200"   :
                        "bg-slate-50 text-slate-600 border-slate-200";
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${cls}`}>{label}</span>
  );
}

// ─── Differential Expression tab ──────────────────────────────────────────────

/** Shared query options for a result set's corrected p-value histogram.
 *  Used both by the per-row {@link PvalueHistogramStrip} and by the
 *  tab-level prefetch below — keeping the key/args/staleTime identical
 *  in one place so a prefetch reliably warms the cache the strips read.
 *  The 30-min staleTime means an expand never re-hits the network for a
 *  set already fetched this session. */
function pvalueDistQueryOptions(resultSetId: number) {
  return {
    queryKey: ["resultset-pvalue-dist", resultSetId] as const,
    queryFn: ({ signal }: QueryFunctionContext) =>
      getPvalueDistribution(resultSetId, { bins: 20, column: "corrected" }, signal),
    staleTime: 30 * 60_000,
  };
}

function DifferentialExpressionTab({ datasetId }: { datasetId: number }) {
  const queryClient = useQueryClient();
  const analyses = useQuery({
    queryKey: ["datasetDiffEx", datasetId],
    queryFn: ({ signal }) => getDatasetDiffExAnalyses(datasetId, signal),
  });

  // Warm the p-value histograms for the analyses that render OPEN by
  // default (the whole-experiment, non-subset ones — see the default
  // openIds in DiffExAnalysesList), so their strips read from cache
  // instead of firing a `resultSets/{id}/pvalueDistribution` per row on
  // first paint. Subset analyses default collapsed and can number in the
  // dozens on single-cell datasets; prefetching every one would fan out
  // a request per contrast at once and stampede a slow / hiccuping
  // backend. Those fetch lazily instead — a subset's strips mount (and
  // fire the same-keyed query) only when the curator expands it. React
  // Query dedupes against the in-flight prefetch if a row mounts first.
  const analysesData = analyses.data;
  useEffect(() => {
    if (!analysesData) return;
    for (const a of analysesData) {
      if (a.isSubset) continue;
      for (const rs of a.resultSets ?? []) {
        void queryClient.prefetchQuery(pvalueDistQueryOptions(rs.id));
      }
    }
  }, [analysesData, queryClient]);

  return (
    <SectionCard title="Differential expression analyses"
      subtitle={analyses.isLoading ? "loading…" : `${(analyses.data ?? []).length} analys${(analyses.data ?? []).length === 1 ? "is" : "es"}`}>
      {analyses.isLoading ? <LoadingRow /> :
       analyses.isError   ? <ErrorRow /> :
       !analyses.data?.length ? <Empty msg="no differential expression analyses" /> : (
        <DiffExAnalysesList key={datasetId} analyses={analyses.data} datasetId={datasetId} />
      )}
    </SectionCard>
  );
}

// ─── Diagnostics tab ──────────────────────────────────────────────────────────

function ExpressionTab({ datasetId }: { datasetId: number }) {
  return (
    /* Diagnostics — replaces the old standalone PCA scree.
       Four panels (Sample correlation · PCA scree · PC × factor ·
       Mean-variance) mirror the curation app's Diagnostics tab. */
    <SectionCard
      title="Diagnostics"
      subtitle="Sample correlation · PCA scree · PC × factor · mean-variance"
    >
      <DiagnosticsRow datasetId={datasetId} />
    </SectionCard>
  );
}

/** Top-level list of DE analyses for a dataset.
 *
 *  Each analysis renders as a sub-card. Single-cell experiments
 *  typically run one analysis per cell type (``isSubset === true``)
 *  with a ``subsetFactorValue`` carrying the cell-type label, so the
 *  outer header surfaces that — multi-subset datasets can have a lot
 *  of analyses and the curator needs to see the subset partition at a
 *  glance. Within each analysis, one row per result set surfaces the
 *  contrast factor(s), baseline, DE counts, and the per-row heatmap +
 *  download actions. */
function DiffExAnalysesList({
  analyses,
  datasetId,
}: {
  analyses: DiffExAnalysis[];
  datasetId: number;
}) {
  // Sort so non-subset analyses come first, then subsets ordered by
  // their factor-value label. Stable secondary order = original order
  // from the server.
  const sorted = useMemo(() => {
    return [...analyses].sort((a, b) => {
      const aSub = a.isSubset ? 1 : 0;
      const bSub = b.isSubset ? 1 : 0;
      if (aSub !== bSub) return aSub - bSub;
      const aLab = subsetLabel(a) || "";
      const bLab = subsetLabel(b) || "";
      return aLab.localeCompare(bLab);
    });
  }, [analyses]);

  // Each analysis's contrasts collapse under its subset title to keep
  // many-subset (single-cell) datasets compact. Default-open the
  // whole-experiment analyses; collapse the subsets — there can be
  // dozens, and the header still surfaces DE + contrast counts.
  const [openIds, setOpenIds] = useState<Set<number>>(
    () => new Set(sorted.filter((a) => !a.isSubset).map((a) => a.id)),
  );
  const toggle = (id: number) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const setAll = (open: boolean) =>
    setOpenIds(open ? new Set(sorted.map((a) => a.id)) : new Set());
  const allOpen = sorted.every((a) => openIds.has(a.id));

  return (
    <div className="space-y-3">
      {sorted.length > 1 ? (
        <div className="flex justify-end -mb-1">
          <button
            type="button"
            onClick={() => setAll(!allOpen)}
            className="text-[11px] text-sky-700 hover:underline cursor-pointer"
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        </div>
      ) : null}
      {sorted.map((a) => (
        <AnalysisCard
          key={a.id}
          analysis={a}
          datasetId={datasetId}
          open={openIds.has(a.id)}
          onToggle={() => toggle(a.id)}
        />
      ))}
    </div>
  );
}

/** Pull a human label out of an analysis's `subsetFactorValue` —
 *  prefers the server-provided ``summary``, falling back to
 *  ``factorValue`` and finally the first characteristic value. */
function subsetLabel(a: DiffExAnalysis): string | null {
  const sfv = a.subsetFactorValue;
  if (!sfv) return null;
  return (
    sfv.summary ||
    sfv.factorValue ||
    sfv.value ||
    sfv.characteristics?.[0]?.value ||
    null
  );
}

function AnalysisCard({
  analysis,
  datasetId,
  open,
  onToggle,
}: {
  analysis: DiffExAnalysis;
  datasetId: number;
  open: boolean;
  onToggle: () => void;
}) {
  // Interaction contrasts (>1 factor, no single baseline/condition) sort
  // last — the main-effect comparisons are what a reader scans for first.
  // Stable sort keeps the server order within each group.
  const resultSets = [...(analysis.resultSets ?? [])].sort(
    (a, b) =>
      ((a.experimentalFactors?.length ?? 0) > 1 ? 1 : 0) -
      ((b.experimentalFactors?.length ?? 0) > 1 ? 1 : 0),
  );
  const subLabel = subsetLabel(analysis);
  const subFactor = analysis.subsetFactor?.name;
  // Total DE probes across this analysis's contrasts — surfaced in the
  // header so a collapsed subset still conveys whether it has signal.
  const totalDE = resultSets.reduce(
    (sum, rs) => sum + (rs.numberOfDiffExpressedProbes ?? 0),
    0,
  );
  const bodyId = `analysis-${analysis.id}-body`;
  return (
    <div className="rounded border border-slate-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={bodyId}
        className={
          "w-full text-left px-3 py-1.5 bg-slate-50/60 hover:bg-slate-100/70 cursor-pointer flex items-baseline gap-2 flex-wrap " +
          (open ? "border-b border-slate-100" : "")
        }
      >
        <ChevronRight
          size={13}
          className={
            "shrink-0 self-center text-slate-400 transition-transform " +
            (open ? "rotate-90" : "")
          }
        />
        {subLabel ? (
          <span className="text-xs font-semibold text-slate-800">
            {subFactor ? (
              <span className="text-slate-500 font-normal">{subFactor}: </span>
            ) : null}
            {subLabel}
          </span>
        ) : (
          <span className="text-xs font-semibold text-slate-800">
            Whole-experiment analysis
          </span>
        )}
        <span className="text-[10px] text-slate-400 font-mono">
          #{analysis.id}
        </span>
        <span className="ml-auto inline-flex items-baseline gap-2">
          {totalDE > 0 ? (
            <span className="text-[10px] text-slate-500">
              <span className="font-mono text-slate-700">
                {totalDE.toLocaleString()}
              </span>{" "}
              DE
            </span>
          ) : null}
          <span className="text-[10px] text-slate-500">
            {resultSets.length} contrast{resultSets.length === 1 ? "" : "s"}
          </span>
        </span>
      </button>
      {open ? (
        resultSets.length === 0 ? (
          <div id={bodyId} className="px-3 py-2 text-xs text-slate-500 italic">
            No result sets recorded.
          </div>
        ) : (
          <ul id={bodyId} className="divide-y divide-slate-100">
            {resultSets.map((rs) => (
              <ResultSetRow
                key={rs.id}
                resultSet={rs}
                datasetId={datasetId}
                subsetSamplesLabel={subLabel ?? null}
              />
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

/** One result-set row: factor labels, baseline, DE counts + up/down
 *  split chip, and per-row "Top genes heatmap" / "Download TSV"
 *  actions. The heatmap expands inline below the row to keep the
 *  curator in context (no modal navigation). */
function ResultSetRow({
  resultSet,
  datasetId,
  subsetSamplesLabel,
}: {
  resultSet: DiffExNestedResultSet;
  datasetId: number;
  /** Subset cell-type / tissue label, threaded into the heatmap
   *  caption so the curator sees which samples the matrix is over. */
  subsetSamplesLabel: string | null;
}) {
  const [heatmapOpen, setHeatmapOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadErr, setDownloadErr] = useState<string | null>(null);

  const factorLabels = (resultSet.experimentalFactors ?? [])
    .map((f) => f.name?.trim() || f.category?.trim())
    .filter(Boolean) as string[];
  const contrastLabel =
    factorLabels.length > 0 ? factorLabels.join(" × ") : `result set ${resultSet.id}`;

  // What was actually contrasted. The wire only names the factor + its
  // baseline group ("baseline = reference subject role"), never the test
  // condition — so cross-reference the design (same cached query as the
  // Design tab) to recover the non-baseline level(s). A result set over
  // >1 factor is an interaction term (no single baseline / condition).
  const rsFactors = resultSet.experimentalFactors ?? [];
  const isInteraction = rsFactors.length > 1;
  const baselineFvId = resultSet.baselineGroup?.id ?? null;
  const designQ = useQuery({
    queryKey: ["datasetDesign", datasetId],
    queryFn: ({ signal }) => getDatasetDesign(datasetId, signal),
    staleTime: 5 * 60_000,
  });
  const { conditionTerms, baselineLabel } = useMemo(() => {
    const bgRaw =
      resultSet.baselineGroup?.factorValue ||
      resultSet.baselineGroup?.characteristics?.[0]?.value ||
      null;
    // Cleaned baseline label — never the raw role placeholder.
    const bgLabel = bgRaw
      ? isBaselineTerm(bgRaw)
        ? "baseline"
        : bgRaw
      : null;
    if (isInteraction || rsFactors.length === 0) {
      return { conditionTerms: [], baselineLabel: bgLabel };
    }
    const df = (designQ.data?.experimentalFactors ?? []).find(
      (f) => f.id === rsFactors[0].id,
    );
    if (!df) return { conditionTerms: [], baselineLabel: bgLabel };
    const conds = df.values.filter((v) =>
      baselineFvId != null
        ? v.id !== baselineFvId
        : !isBaselineTerm(factorValueTerm(v).label),
    );
    const baseFv =
      baselineFvId != null
        ? df.values.find((v) => v.id === baselineFvId)
        : undefined;
    return {
      conditionTerms: conds.map(factorValueTerm),
      baselineLabel: baseFv ? factorValueLabel(baseFv) : bgLabel,
    };
  }, [designQ.data, rsFactors, isInteraction, baselineFvId, resultSet.baselineGroup]);

  const nDE = resultSet.numberOfDiffExpressedProbes ?? 0;
  const nTotal = resultSet.numberOfProbesAnalyzed ?? 0;
  const fdr = resultSet.threshold ?? 0.05;
  const pctDE = nTotal > 0 ? (nDE / nTotal) * 100 : 0;
  const up =
    resultSet.upregulatedCount ?? resultSet.numberOfUpregulatedProbes ?? 0;
  const down =
    resultSet.downregulatedCount ?? resultSet.numberOfDownregulatedProbes ?? 0;

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    setDownloadErr(null);
    try {
      const fname = `dataset_${datasetId}_resultSet_${resultSet.id}.tsv`;
      await downloadResultSetTsv(resultSet.id, fname);
    } catch (e: unknown) {
      setDownloadErr(
        e && typeof e === "object" && "message" in e
          ? String((e as { message: string }).message)
          : "Download failed.",
      );
    } finally {
      setDownloading(false);
    }
  };

  return (
    <li className="px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-3 text-sm">
        {/* Lead every row with the factor name, then the comparison it
            tested — condition(s) vs baseline. Naming stays consistent
            across single-factor and interaction rows (both open with the
            factor name in the same weight) so the eye tracks one column.
            The comparison fills the left; the DE metrics live in
            fixed-width, right-justified columns so they line up row to
            row regardless of description length. */}
        <div className="flex-1 min-w-0">
          {isInteraction ? (
            <span className="inline-flex items-baseline gap-1.5">
              <span className="font-medium text-slate-800">{contrastLabel}</span>
              <span className="text-[10px] uppercase tracking-wide text-slate-400">
                interaction
              </span>
            </span>
          ) : conditionTerms.length > 0 ? (
            <span className="inline-flex items-baseline gap-1.5 flex-wrap">
              <span
                className="font-medium text-slate-800"
                title="experimental factor"
              >
                {contrastLabel}
              </span>
              <span className="text-[11px] text-slate-400">·</span>
              {conditionTerms.map((t, i) => (
                // Long ontology labels (e.g. gene-marker cell types) would
                // otherwise run under the DE metric columns — cap the width
                // so the label ellipsizes; the full term is on hover.
                <span key={i} className="inline-flex min-w-0 max-w-[22rem]">
                  <OntologyTermChip uri={t.uri} labelTitle={t.label}>
                    {t.label}
                  </OntologyTermChip>
                </span>
              ))}
              <span className="text-[11px] text-slate-400">vs</span>
              <span
                className="text-[11px] text-slate-500 italic truncate max-w-[22rem]"
                title={baselineLabel ?? "baseline"}
              >
                {baselineLabel ?? "baseline"}
              </span>
            </span>
          ) : (
            <span className="inline-flex items-baseline gap-1.5 min-w-0">
              <span className="font-medium text-slate-800">{contrastLabel}</span>
              {baselineLabel ? (
                <span className="text-[11px] text-slate-500 inline-flex items-baseline gap-1 min-w-0">
                  vs{" "}
                  <span
                    className="italic truncate max-w-[22rem]"
                    title={baselineLabel}
                  >
                    {baselineLabel}
                  </span>
                </span>
              ) : null}
            </span>
          )}
        </div>

        {/* DE metrics — fixed-width, right-justified columns. Empty slots
            still reserve their width so the histogram + actions stay
            aligned across rows with and without DE. */}
        <div className="shrink-0 flex items-center gap-3">
          <span className="w-44 flex justify-end">
            <DeCountChip nDE={nDE} nTotal={nTotal} pct={pctDE} fdr={fdr} />
          </span>
          <span className="w-20 text-right text-[10px] font-mono tabular-nums whitespace-nowrap">
            {up > 0 || down > 0 ? (
              <>
                <span className="text-rose-600">↑{up}</span>{" "}
                <span className="text-sky-600">↓{down}</span>
              </>
            ) : null}
          </span>
          <span className="w-[100px] inline-flex justify-start">
            <PvalueHistogramStrip
              resultSetId={resultSet.id}
              label={
                subsetSamplesLabel
                  ? `${contrastLabel} · ${subsetSamplesLabel}`
                  : contrastLabel
              }
            />
          </span>
        </div>

        {/* Compact text-link actions — the bordered pills ate width and
            forced the description to wrap. Always enabled: the heatmap
            fetches the top-50 by p-value (threshold=1), so it shows the
            lowest-p-value genes even when nothing clears the FDR cutoff —
            exactly the view a reader still wants for a no-significant-hit
            contrast. */}
        <span className="shrink-0 inline-flex items-center gap-3 text-[11px]">
          <button
            type="button"
            onClick={() => setHeatmapOpen(true)}
            className="text-sky-700 hover:underline"
            title="Pop out the top-50 genes by lowest p-value as a heatmap"
          >
            View top
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="text-slate-500 hover:underline disabled:text-slate-300 disabled:cursor-wait"
            title="Download per-gene contrast TSV"
          >
            {downloading ? "…" : "TSV"}
          </button>
          <span className="text-[10px] text-slate-400 font-mono">
            #{resultSet.id}
          </span>
        </span>
      </div>
      {downloadErr ? (
        <p className="text-[11px] text-rose-600">{downloadErr}</p>
      ) : null}
      {heatmapOpen ? (
        <HeatmapPopup
          title={
            subsetSamplesLabel
              ? `${contrastLabel} · ${subsetSamplesLabel}`
              : contrastLabel
          }
          onClose={() => setHeatmapOpen(false)}
        >
          <ResultSetHeatmap
            datasetId={datasetId}
            resultSetId={resultSet.id}
            contrastLabel={contrastLabel}
            contrastFactorId={resultSet.experimentalFactors?.[0]?.id ?? null}
            subsetSamplesLabel={subsetSamplesLabel}
          />
        </HeatmapPopup>
      ) : null}
    </li>
  );
}

/** Modal pop-out for the "Top genes" heatmap.
 *
 *  Behaviour:
 *  - **Snug initial size** — uses `width: max-content` so the modal
 *    sizes itself to whatever the heatmap renders at; max-w / max-h
 *    cap it to the viewport. No fixed 1100px box that dwarfs a
 *    7-column DE matrix.
 *  - **Draggable** — grab the title bar to move the modal. Tracks an
 *    offset applied via CSS `transform: translate()`.
 *  - **Resizable** — CSS `resize: both` on the card gives a SE
 *    corner handle for free. `min-width` and `min-height` keep the
 *    matrix from collapsing into the header.
 *  - **Backdrop click / Esc close** — backdrop dismisses; the
 *    card's onClick stops propagation; Escape works regardless.
 *
 *  The backdrop is `pointer-events-none` on the card area so the
 *  curator can interact with the resize handle without the
 *  modal grabbing the click. */
function HeatmapPopup({
  children,
  title,
  onClose,
}: {
  children: React.ReactNode;
  title?: string;
  onClose: () => void;
}) {
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Drag-by-titlebar. Pointer events let us track motion + release
  // cleanly without juggling mouse/touch — capture lives on the
  // titlebar element itself.
  const onTitleBarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only left-button drags; skip the close button.
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    dragStateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: offset.x,
      baseY: offset.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onTitleBarPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragStateRef.current;
    if (!s) return;
    setOffset({
      x: s.baseX + (e.clientX - s.startX),
      y: s.baseY + (e.clientY - s.startY),
    });
  };
  const onTitleBarPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStateRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[900] flex items-center justify-center bg-slate-900/45 p-3"
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex flex-col bg-white rounded-lg shadow-2xl overflow-hidden"
        style={{
          // Snug-by-default: card width follows its content. Caller's
          // content (the HeatmapWidget) decides what natural width
          // looks like.
          width: "max-content",
          maxWidth: "min(96vw, 1400px)",
          maxHeight: "92vh",
          minWidth: 360,
          minHeight: 240,
          resize: "both",
          // Move via offset transform — keeps the auto-centering of
          // the parent flexbox while letting drag nudge it around.
          transform: `translate(${offset.x}px, ${offset.y}px)`,
        }}
      >
        <div
          onPointerDown={onTitleBarPointerDown}
          onPointerMove={onTitleBarPointerMove}
          onPointerUp={onTitleBarPointerUp}
          onPointerCancel={onTitleBarPointerUp}
          className="flex items-center justify-between px-3 py-1.5 border-b border-slate-200 bg-slate-50 select-none"
          style={{ cursor: dragStateRef.current ? "grabbing" : "grab" }}
          title="Drag to move; SE corner to resize"
        >
          <span className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold truncate">
            {title ?? "Heatmap"}
          </span>
          <button
            type="button"
            data-no-drag
            onClick={onClose}
            aria-label="Close heatmap"
            className="inline-flex items-center justify-center h-6 w-6 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200 text-xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-auto p-2">{children}</div>
      </div>
    </div>
  );
}

/** Compact chip surfacing the # DE probes + % vs total. Uses a colour
 *  ramp so a curator scanning a 30-row single-cell dataset can spot
 *  the analyses with strong DE at a glance. */
function DeCountChip({
  nDE,
  nTotal,
  pct,
  fdr,
}: {
  nDE: number;
  nTotal: number;
  pct: number;
  fdr: number;
}) {
  // Bucket the percentage into a tint so dense + faint signals look
  // visually different. Thresholds tuned for the typical 5-20% range
  // microarray analyses land in.
  const tint =
    pct >= 10
      ? "bg-emerald-100 border-emerald-300 text-emerald-800"
      : pct >= 2
        ? "bg-amber-50 border-amber-300 text-amber-800"
        : pct > 0
          ? "bg-slate-100 border-slate-300 text-slate-700"
          : "bg-white border-slate-200 text-slate-500";
  return (
    <span
      className={
        "inline-flex items-baseline gap-1 text-[11px] px-1.5 py-0.5 rounded border " +
        tint
      }
      title={`${nDE} differentially expressed of ${nTotal} probes at FDR < ${fdr}`}
    >
      <span className="font-semibold tabular-nums">{nDE.toLocaleString()}</span>
      <span className="text-[10px] opacity-70">
        ({pct >= 1 ? pct.toFixed(0) : pct === 0 ? "0" : "<1"}% @ FDR&lt;{fdr})
      </span>
    </span>
  );
}

/** Tiny inline histogram of the corrected-p-value distribution for a
 *  result set. Fetches the binned payload from
 *  ``GET /resultSets/{id}/pvalueDistribution`` (shipped 2026-05-23).
 *  Renders 20 bars
 *  on a 100×24 SVG canvas; the leftmost bar (smallest p-values) is
 *  highlighted so a curator scanning a multi-subset single-cell page
 *  can spot real-signal analyses (left-skewed = good) vs flat /
 *  weird ones in one glance.
 *
 *  Renders nothing when the endpoint 204s or errors — this is a
 *  diagnostic, not load-bearing UI; failing silently keeps the row
 *  uncluttered. Tooltip carries the bar counts so the curator can
 *  hover-inspect without a popover. */
function PvalueHistogramStrip({
  resultSetId,
  label,
}: {
  resultSetId: number;
  /** Contrast label — used in the enlarged-modal title. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const q = useQuery(pvalueDistQueryOptions(resultSetId));
  if (q.isLoading) {
    return (
      <span
        className="inline-block h-[18px] w-[100px] bg-slate-100 rounded animate-pulse"
        aria-hidden
      />
    );
  }
  if (q.isError || !q.data || q.data.bins.length === 0) return null;

  const dist = q.data;
  const W = 100;
  const H = 18;
  const maxCount = dist.bins.reduce((m, b) => (b.count > m ? b.count : m), 0);
  if (maxCount === 0) return null;
  const barW = W / dist.bins.length;
  // Uniform-shape null = flat at n / bins per bar; surface it as a
  // dashed reference line so the curator sees how far the
  // distribution departs from uniform.
  const flatY = (1 - dist.n / dist.bins.length / maxCount) * H;
  const title =
    `Corrected p-value histogram · n=${dist.n.toLocaleString()} probes\n` +
    dist.bins
      .map(
        (b, i) =>
          `[${b.lo.toFixed(2)}, ${b.hi.toFixed(2)}${i === dist.bins.length - 1 ? "]" : ")"}) ${b.count}`,
      )
      .join("\n") +
    "\n(click to enlarge)";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Enlarge corrected p-value distribution"
        className="inline-flex items-center align-middle rounded p-0 cursor-pointer hover:ring-1 hover:ring-sky-300 focus:outline-none focus:ring-1 focus:ring-sky-400"
      >
        <svg
          width={W}
          height={H}
          role="img"
          aria-label="corrected p-value distribution"
          className="inline-block align-middle"
          style={{ display: "inline-block" }}
        >
          <title>{title}</title>
          <rect x={0} y={0} width={W} height={H} fill="#f8fafc" />
          {/* Uniform-null reference. Faint, dashed; hint at the shape a
              well-behaved no-signal analysis would produce. */}
          {flatY > 0 && flatY < H ? (
            <line
              x1={0}
              y1={flatY}
              x2={W}
              y2={flatY}
              stroke="#cbd5e1"
              strokeWidth={0.5}
              strokeDasharray="2 2"
            />
          ) : null}
          {dist.bins.map((b, i) => {
            const h = (b.count / maxCount) * H;
            const x = i * barW;
            const y = H - h;
            // Leftmost bin = smallest p-values; tinted differently so
            // the "signal peak at zero" pattern jumps out.
            const fill = i === 0 ? "#0284c7" : "#94a3b8";
            return (
              <rect
                key={i}
                x={x + 0.3}
                y={y}
                width={Math.max(0.6, barW - 0.6)}
                height={h}
                fill={fill}
              />
            );
          })}
        </svg>
      </button>
      {open ? (
        <HeatmapPopup
          title={
            label
              ? `Corrected p-value distribution · ${label}`
              : "Corrected p-value distribution"
          }
          onClose={() => setOpen(false)}
        >
          <PvalueHistogramLarge dist={dist} />
        </HeatmapPopup>
      ) : null}
    </>
  );
}

/** Enlarged, axis-labelled corrected-p-value histogram shown in the
 *  pop-out modal when a curator clicks the inline strip. Same data +
 *  colour semantics as the strip (leftmost bin = smallest p-values,
 *  highlighted; dashed uniform-null reference) with real axes: probe
 *  counts on y, p-value [0, 1] on x. */
function PvalueHistogramLarge({ dist }: { dist: PvalueDistribution }) {
  const W = 640;
  const H = 420;
  const padL = 64;
  const padR = 20;
  const padT = 22;
  const padB = 52;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const maxCount = dist.bins.reduce((m, b) => (b.count > m ? b.count : m), 0);
  const yTicks = niceTicks(0, maxCount, 5);
  const yMax = Math.max(maxCount, yTicks[yTicks.length - 1] ?? maxCount) || 1;
  const xTicks = [0, 0.25, 0.5, 0.75, 1];
  const barW = innerW / dist.bins.length;
  // Uniform-null per-bar count (flat expectation for a no-signal set).
  const flatCount = dist.n / dist.bins.length;
  const flatY = padT + innerH * (1 - flatCount / yMax);
  const SUBTLE = "#6b7280";
  const GRID = "#e5e7eb";
  const AXIS = "#334155";
  return (
    <div className="p-3 bg-white">
      <svg
        width={W}
        height={H}
        role="img"
        aria-label="corrected p-value distribution, enlarged"
      >
        <rect x={0} y={0} width={W} height={H} fill="#ffffff" />
        {/* y grid + tick labels */}
        {yTicks.map((t) => {
          const y = padT + innerH * (1 - t / yMax);
          return (
            <g key={`y${t}`}>
              <line
                x1={padL}
                x2={padL + innerW}
                y1={y}
                y2={y}
                stroke={GRID}
                strokeWidth={0.5}
              />
              <text
                x={padL - 8}
                y={y + 4}
                fontSize={11}
                fill={SUBTLE}
                textAnchor="end"
                fontFamily="-apple-system, sans-serif"
              >
                {t.toLocaleString()}
              </text>
            </g>
          );
        })}
        {/* Uniform-null reference line + label. */}
        {maxCount > 0 && flatCount <= yMax ? (
          <g>
            <line
              x1={padL}
              x2={padL + innerW}
              y1={flatY}
              y2={flatY}
              stroke="#cbd5e1"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
            <text
              x={padL + innerW - 2}
              y={flatY - 4}
              fontSize={10}
              fill="#94a3b8"
              textAnchor="end"
              fontFamily="-apple-system, sans-serif"
            >
              uniform null
            </text>
          </g>
        ) : null}
        {/* bars */}
        {dist.bins.map((b, i) => {
          const h = maxCount > 0 ? (b.count / yMax) * innerH : 0;
          const x = padL + i * barW;
          const y = padT + innerH - h;
          const fill = i === 0 ? "#0284c7" : "#94a3b8";
          return (
            <rect
              key={i}
              x={x + 0.5}
              y={y}
              width={Math.max(1, barW - 1)}
              height={h}
              fill={fill}
            >
              <title>
                {`[${b.lo.toFixed(2)}, ${b.hi.toFixed(2)}${
                  i === dist.bins.length - 1 ? "]" : ")"
                }) — ${b.count.toLocaleString()} probes`}
              </title>
            </rect>
          );
        })}
        {/* axes */}
        <line x1={padL} y1={padT} x2={padL} y2={padT + innerH} stroke={AXIS} strokeWidth={1} />
        <line
          x1={padL}
          y1={padT + innerH}
          x2={padL + innerW}
          y2={padT + innerH}
          stroke={AXIS}
          strokeWidth={1}
        />
        {/* x ticks + labels */}
        {xTicks.map((t) => {
          const x = padL + innerW * t;
          return (
            <g key={`x${t}`}>
              <line
                x1={x}
                y1={padT + innerH}
                x2={x}
                y2={padT + innerH + 4}
                stroke={AXIS}
                strokeWidth={1}
              />
              <text
                x={x}
                y={padT + innerH + 17}
                fontSize={11}
                fill={SUBTLE}
                textAnchor="middle"
                fontFamily="-apple-system, sans-serif"
              >
                {t.toFixed(2)}
              </text>
            </g>
          );
        })}
        {/* axis titles */}
        <text
          x={padL + innerW / 2}
          y={H - 6}
          fontSize={12}
          fill={AXIS}
          textAnchor="middle"
          fontFamily="-apple-system, sans-serif"
        >
          corrected p-value
        </text>
        <text
          x={16}
          y={padT + innerH / 2}
          fontSize={12}
          fill={AXIS}
          textAnchor="middle"
          transform={`rotate(-90 16 ${padT + innerH / 2})`}
          fontFamily="-apple-system, sans-serif"
        >
          number of probes
        </text>
      </svg>
      <p className="mt-1 text-[11px] text-slate-500 text-center">
        n = {dist.n.toLocaleString()} probes · {dist.bins.length} bins ·
        leftmost bin (smallest p-values) highlighted
      </p>
    </div>
  );
}

/** Inline heatmap of the top-50 DE genes for a result set.
 *
 *  Fetches `/datasets/{id}/expressions/differential?diffExSet={rsId}`
 *  with a high threshold so the response includes the top genes even
 *  when the FDR-significant set is small. The endpoint is
 *  subset-aware: for a single-cell per-cell-type analysis the
 *  response only contains samples in that subset.
 *
 *  Column ordering: the API returns samples grouped by FV in practice
 *  (verified on staging), so we pass them through as-is. Proper
 *  contrast-aware sort + a categorical strip showing the FV
 *  assignment per column is a future iteration — needs the
 *  biomaterial → factor-value mapping the design endpoint carries.
 */
function ResultSetHeatmap({
  datasetId,
  resultSetId,
  contrastLabel,
  contrastFactorId,
  subsetSamplesLabel,
}: {
  datasetId: number;
  resultSetId: number;
  contrastLabel: string;
  /** Owning contrast factor id — used to default the heatmap's group
   *  strips to the factor this result set actually contrasts. */
  contrastFactorId: number | null;
  subsetSamplesLabel: string | null;
}) {
  const limit = 50;
  const q = useQuery({
    queryKey: ["dataset-de-top", datasetId, resultSetId, limit],
    queryFn: ({ signal }) =>
      // Threshold=1 so the endpoint returns the top-N by p-value
      // regardless of significance — guards the heatmap against a
      // result set whose strictly-FDR<0.05 set is < N.
      getTopDiffExpressedGenes(
        datasetId,
        resultSetId,
        { threshold: 1, limit },
        signal,
      ),
    staleTime: 5 * 60_000,
  });

  // Sample factor-value assignments (per-column FV + canonical sample
  // order) and the experimental design (canonical factor / FV order +
  // baseline flags) — together these let the DE heatmap reproduce the
  // Expression tab's group strips AND sample ordering. Fetched
  // alongside the DE vectors; while either is absent the heatmap
  // degrades to the annotation-free ``data`` path below.
  const samplesQ = useQuery({
    queryKey: ["dataset-samples", datasetId],
    queryFn: ({ signal }) => getDatasetSamples(datasetId, signal),
    staleTime: 5 * 60_000,
  });
  // Probe links are in-app now, and a probe is addressable only as
  // platform + element. One platform ⇒ every row's design element is
  // on it; several ⇒ the payload doesn't say which, so no probe link.
  const platformsQ = useQuery({
    queryKey: ["datasetPlatforms", datasetId],
    queryFn: ({ signal }) => getDatasetPlatforms(datasetId, signal),
    staleTime: 30 * 60_000,
  });
  const platformShortName =
    platformsQ.data?.length === 1
      ? (platformsQ.data[0].shortName ?? undefined)
      : undefined;

  const designQ = useQuery({
    queryKey: ["dataset-design", datasetId],
    queryFn: ({ signal }) => getDatasetDesign(datasetId, signal),
    staleTime: 5 * 60_000,
  });

  // Order genes by FDR (corrected p-value) ascending — most-significant
  // first. The endpoint does NOT return them in this order, so we sort
  // once here and drive the heatmap builders AND the row-label tooltip
  // (rowInfo, below) off this single ordered list — keeping tooltip row
  // i aligned with heatmap row i.
  const orderedData = useMemo<DiffExpressionResponse | null>(() => {
    if (!q.data) return null;
    const levels = [...(q.data.geneExpressionLevels ?? [])].sort(
      (a, b) =>
        (a.correctedPvalue ?? Infinity) - (b.correctedPvalue ?? Infinity),
    );
    return { ...q.data, geneExpressionLevels: levels };
  }, [q.data]);

  const payload = useMemo<HeatmapPayload | null>(() => {
    if (!orderedData || !samplesQ.data || !designQ.data) return null;
    return buildDeHeatmapPayload(orderedData, samplesQ.data, designQ.data, datasetId);
  }, [orderedData, samplesQ.data, designQ.data, datasetId]);

  const data = useMemo<HeatmapData | null>(() => {
    if (!orderedData) return null;
    return buildDeHeatmap(orderedData);
  }, [orderedData]);

  if (q.isLoading) {
    return (
      <div className="mt-2 px-2 py-3 border border-slate-200 rounded text-xs text-slate-500 italic">
        Loading top-{limit} expression heatmap…
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="mt-2 px-2 py-3 border border-rose-200 bg-rose-50 rounded text-xs text-rose-700">
        Couldn't load the expression heatmap.
      </div>
    );
  }
  if (!data || !data.values.length) {
    return (
      <div className="mt-2 px-2 py-3 border border-slate-200 rounded text-xs text-slate-500 italic">
        No expression vectors returned for this result set.
      </div>
    );
  }
  const caption = subsetSamplesLabel
    ? `Top ${data.values.length} genes by p-value · samples constrained to ${subsetSamplesLabel}`
    : `Top ${data.values.length} genes by p-value`;
  // Filename stem used by the widget's download buttons. Falls back
  // to the result-set id when we don't have a subset label.
  const downloadStem = [
    `de_rs${resultSetId}`,
    subsetSamplesLabel?.replace(/\s+/g, "_"),
    contrastLabel.replace(/\W+/g, "_"),
  ]
    .filter(Boolean)
    .join("__");
  // Per-row info producer used both by the heatmap tooltip and the
  // (now-retired) side table. Reads from the FDR-ordered list so it
  // stays in sync with row order in the heatmap.
  const rowInfo = (i: number) => {
    const lvl = orderedData?.geneExpressionLevels?.[i];
    if (!lvl) return null;
    const vec = lvl.vectors?.[0];
    return {
      symbol: lvl.geneOfficialSymbol ?? null,
      officialName: lvl.geneOfficialName ?? null,
      fdr: lvl.correctedPvalue ?? null,
      pvalue: lvl.pvalue ?? null,
      log2FoldChange: lvl.log2FoldChange ?? null,
      // Ids, not hrefs: both links are in-app routes now rather than
      // absolute URLs into the legacy JSP UI.
      geneNcbiId: lvl.geneNcbiId ?? null,
      probeName: vec?.designElementName ?? null,
      designElementId: vec?.designElementId ?? null,
    };
  };
  return (
    <div className="min-w-0">
      <HeatmapWidget
        // Prefer the payload path once samples have joined in — it
        // renders the per-factor group strips + grouping/gaps. Until
        // then (or if samples fail) fall back to the annotation-free
        // ``data`` matrix so the heatmap still shows.
        {...(payload ? { payload } : { data })}
        defaultMainGroupingFactorId={contrastFactorId}
        title={contrastLabel}
        caption={caption}
        // DE values (esp. row-scaled) are signed around zero — pin
        // the palette to diverging despite the project-wide
        // sequential default the widget switched to 2026-05-27.
        defaultPalette="ambsky"
        defaultRowScale
        defaultControlsOpen={false}
        // DE result sets typically have a handful of samples (5–30)
        // and 50 genes. We want the matrix dense, not poster-sized;
        // the legacy Gemma popup paints cells ~14×11px which lets a
        // 50×18 matrix fit on a ~400px-wide pane alongside legible row
        // labels. Match that proportion as the minimum-target footprint.
        // Curators can still pull the Cell H / Cell W sliders to grow
        // the matrix from the Options popover.
        defaultFitMode="expand"
        defaultMaxWidth={14}
        defaultMaxHeight={18}
        rowLabelGutterWidth={370}
        downloadFilenameStem={downloadStem}
        rowLabelTooltip={(i) => {
          const r = rowInfo(i);
          if (!r) return null;
          return (
            <div className="space-y-1">
              {r.symbol ? (
                <div className="font-semibold text-slate-800">{r.symbol}</div>
              ) : null}
              {r.officialName ? (
                <div className="text-slate-600">{r.officialName}</div>
              ) : null}
              {r.probeName ? (
                <div className="text-[10px] text-slate-500 font-mono">
                  {r.probeName}
                </div>
              ) : null}
              {r.fdr != null || r.pvalue != null || r.log2FoldChange != null ? (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 pt-1 text-[10px] font-mono tabular-nums text-slate-600">
                  {r.fdr != null ? (
                    <span>
                      <span className="text-slate-400">FDR </span>
                      {formatPvalueLabel(r.fdr)}
                    </span>
                  ) : null}
                  {r.pvalue != null ? (
                    <span>
                      <span className="text-slate-400">p </span>
                      {formatPvalueLabel(r.pvalue)}
                    </span>
                  ) : null}
                  {r.log2FoldChange != null ? (
                    <span>
                      <span className="text-slate-400">log2FC </span>
                      {r.log2FoldChange.toFixed(2)}
                    </span>
                  ) : null}
                </div>
              ) : null}
              <div className="flex gap-3 pt-1 text-[11px]">
                {r.geneNcbiId != null ? (
                  <Link
                    to="/gene/ncbi/$ncbiId"
                    params={{ ncbiId: String(r.geneNcbiId) }}
                    className="text-sky-700 hover:underline"
                  >
                    gene page →
                  </Link>
                ) : null}
                {platformShortName && r.designElementId != null ? (
                  <Link
                    to="/platforms/$shortName/probe/$elementId"
                    params={{
                      shortName: platformShortName,
                      elementId: String(r.designElementId),
                    }}
                    className="text-sky-700 hover:underline"
                  >
                    probe page →
                  </Link>
                ) : null}
              </div>
            </div>
          );
        }}
      />
    </div>
  );
}

/** Flatten the differential-expression API response into a
 *  ``HeatmapData`` the existing widget can render directly. One row
 *  per gene (one vector per gene assumed — the endpoint surfaces the
 *  representative probe), columns in the order the API returns them
 *  (which is FV-grouped in practice). */
function buildDeHeatmap(response: DiffExpressionResponse): HeatmapData {
  // Order genes by FDR ascending (see buildDeHeatmapPayload) so the
  // annotation-free fallback matches the primary path's row order.
  const levels = [...(response.geneExpressionLevels ?? [])].sort(
    (a, b) =>
      (a.correctedPvalue ?? Infinity) - (b.correctedPvalue ?? Infinity),
  );
  if (levels.length === 0) return { values: [] };
  const anyPvalue = levels.some(
    (l) => l.pvalue != null && Number.isFinite(l.pvalue),
  );
  // Column set = union of bioAssay names across vectors, preserving
  // the first-seen order. Rare for a vector to be missing samples,
  // but the union guards against per-gene drift in test responses.
  const colOrder: string[] = [];
  const seen = new Set<string>();
  for (const lvl of levels) {
    for (const v of lvl.vectors ?? []) {
      for (const key of Object.keys(v.bioAssayExpressionLevels ?? {})) {
        if (!seen.has(key)) {
          seen.add(key);
          colOrder.push(key);
        }
      }
    }
  }
  const rowLabels: string[] = [];
  const rowLabelColumns: string[][] = [];
  const values: (number | null)[][] = [];
  for (const lvl of levels) {
    const sym = lvl.geneOfficialSymbol || String(lvl.geneNcbiId ?? "?");
    const name = lvl.geneOfficialName ?? "";
    rowLabels.push([sym, name].filter(Boolean).join(" · "));
    rowLabelColumns.push(
      anyPvalue ? [formatPvalueLabel(lvl.pvalue), sym, name] : [sym, name],
    );
    const vec = lvl.vectors?.[0]?.bioAssayExpressionLevels ?? {};
    values.push(
      colOrder.map((c) => {
        const raw = vec[c];
        if (raw == null) return null;
        const n = typeof raw === "number" ? raw : Number(raw);
        return Number.isFinite(n) ? n : null;
      }),
    );
  }
  return {
    values,
    rowLabels,
    rowLabelColumns,
    rowLabelColumnKinds: anyPvalue ? ["num", "text", "text"] : ["text", "text"],
    colLabels: colOrder,
  };
}

/** Compact p-value label for the annotation-free heatmap's gutter
 *  column — mirrors the shared widget's formatter (scientific for tiny
 *  values, fixed-decimal otherwise). */
function formatPvalueLabel(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "";
  if (p <= 0) return "0";
  if (p < 1e-3) return p.toExponential(1);
  if (p < 1) return p.toFixed(3);
  return p.toFixed(2);
}

/** Build a full ``HeatmapPayload`` for the DE top-genes matrix so the
 *  widget renders the same per-factor group strips + grouping/gaps —
 *  AND the same sample ordering — as the Expression tab.
 *
 *  Three inputs, three roles:
 *   - ``response`` (DE vectors): the expression values, keyed by
 *     bioAssay name. Carries no factor / ordering info.
 *   - ``samples`` (``/datasets/{id}/samples``): maps bioAssay name →
 *     its factor-value assignments (``columns.factorValueIds``), and
 *     defines the server's canonical sample sequence. We order the
 *     columns by this sequence (restricted to the samples present in
 *     this DE response) so the base order — and thus the within-group
 *     tie-break in ``computeColumnOrder`` — matches the Expression
 *     tab's, rather than the DE response's arbitrary first-seen order.
 *   - ``design`` (``/datasets/{id}/design``): the canonical factor
 *     metadata — declared factor-value order + ``isBaseline`` flags.
 *     These drive group ordering (baseline first, then declared
 *     order), so sourcing them here (instead of reconstructing from
 *     sample-iteration order) is what makes the grouped column order
 *     agree with the Expression tab.
 *
 *  Returns ``null`` when there are no expression levels, no samples, or
 *  no design — the caller then falls back to the annotation-free
 *  ``buildDeHeatmap`` path. */
function buildDeHeatmapPayload(
  response: DiffExpressionResponse,
  samples: BioAssay[],
  design: ExperimentalDesign,
  datasetId: number,
): HeatmapPayload | null {
  // Order genes by FDR (corrected p-value) ascending — most-significant
  // first. Missing values sort last. The endpoint already returns them
  // in this order, but sorting here makes the row order deterministic
  // regardless of wire order.
  const levels = [...(response.geneExpressionLevels ?? [])].sort(
    (a, b) =>
      (a.correctedPvalue ?? Infinity) - (b.correctedPvalue ?? Infinity),
  );
  if (levels.length === 0) return null;

  // Names present in this DE response = the columns we can render.
  const dePresent = new Set<string>();
  for (const lvl of levels) {
    for (const v of lvl.vectors ?? []) {
      for (const key of Object.keys(v.bioAssayExpressionLevels ?? {})) {
        dePresent.add(key);
      }
    }
  }

  // Column order follows the samples endpoint (the server's canonical
  // sample sequence — same base order the Expression tab sees),
  // restricted to samples present in this DE response. DE columns with
  // no matching sample (rare) are appended so they're never dropped.
  const byName = new Map<string, BioAssay>();
  for (const ba of samples) {
    if (ba.name) byName.set(ba.name, ba);
  }
  const colOrder: string[] = [];
  const usedNames = new Set<string>();
  for (const ba of samples) {
    if (ba.name && dePresent.has(ba.name)) {
      colOrder.push(ba.name);
      usedNames.add(ba.name);
    }
  }
  for (const name of dePresent) {
    if (!usedNames.has(name)) colOrder.push(name);
  }

  // Canonical factors from the design — declared FV order + baseline
  // flags — so the grouped column order matches the Expression tab.
  const factors: Factor[] = design.experimentalFactors.map((ef) => {
    const label =
      ef.category?.category ?? ef.category?.value ?? ef.name ?? `factor ${ef.id}`;
    const isContinuous = ef.type === "continuous";
    return {
      id: ef.id,
      name: ef.name ?? label,
      category: { label, uri: ef.category?.categoryUri ?? null },
      type: isContinuous ? "continuous" : "categorical",
      factor_values: (ef.values ?? []).map((fv) => {
        const numeric = isContinuous ? Number(fv.value) : NaN;
        return {
          id: fv.id,
          free_text_label: fv.summary ?? fv.value ?? "",
          is_baseline: !!fv.isBaseline,
          statements: [],
          numeric_value: Number.isFinite(numeric) ? numeric : undefined,
        };
      }),
    };
  });

  const columns: HeatmapPayloadColumn[] = colOrder.map((name, idx) => {
    const ba = byName.get(name);
    const factorValueIds: Record<number, number> = {};
    for (const fv of ba?.sample?.factorValues ?? []) {
      if (fv.experimentalFactorId != null && fv.id != null) {
        factorValueIds[fv.experimentalFactorId] = fv.id;
      }
    }
    // Negative synthetic ids keep unmatched columns distinct without
    // colliding with real bioAssay / bioMaterial ids.
    return {
      bioAssayId: ba?.id ?? -(idx + 1),
      bioMaterialId: ba?.sample?.id ?? -(idx + 1),
      name,
      outlier: !!ba?.outlier,
      factorValueIds,
    };
  });

  const rows: HeatmapPayloadRow[] = [];
  const values: (number | null)[][] = [];
  for (const lvl of levels) {
    const sym = lvl.geneOfficialSymbol || String(lvl.geneNcbiId ?? "?");
    const vec0 = lvl.vectors?.[0];
    const vec = vec0?.bioAssayExpressionLevels ?? {};
    rows.push({
      designElementId: vec0?.designElementId ?? -1,
      designElementName: vec0?.designElementName ?? "",
      geneIds: lvl.geneId != null ? [lvl.geneId] : [],
      geneSymbols: [sym],
      geneNames: [lvl.geneOfficialName ?? ""],
      // Raw p-value drives the leading gutter column (and the
      // cell-detail panel). Rows are still ordered by FDR (see above).
      pvalue: lvl.pvalue ?? undefined,
    });
    values.push(
      colOrder.map((c) => {
        const raw = vec[c];
        if (raw == null) return null;
        const n = typeof raw === "number" ? raw : Number(raw);
        return Number.isFinite(n) ? n : null;
      }),
    );
  }

  return {
    datasetId: response.datasetId ?? datasetId,
    matrix: {
      values,
      rows: values.length,
      cols: colOrder.length,
      // Synthetic QT — the DE endpoint doesn't carry one. Row-scaling
      // is on by default for this heatmap so the scale is cosmetic.
      quantitationType: {
        name: "differential expression",
        isPreferred: true,
        isRatio: false,
        scale: "LINEAR",
      },
    },
    rows,
    columns,
    factors,
  };
}

// ─── Downloads tab ────────────────────────────────────────────────────────────

function DownloadsTab({ dataset }: { dataset: Dataset }) {
  const id = dataset.id;
  const gemma1Full = useGemma1Url(
    `/expressionExperiment/showExpressionExperiment.html?id=${id}`,
  );
  // Result-set list — populates the per-contrast DE download rows.
  // We hit `/datasets/{id}/analyses/differential/resultSets` which 302s
  // to `/resultSets?datasets={id}`; fetch follows the redirect.
  // Empty data is fine (most datasets without DE will return an empty
  // list rather than 404).
  const resultSetsQ = useQuery({
    queryKey: ["dataset-resultsets", id],
    queryFn: ({ signal }) => getDatasetResultSets(id, signal),
    staleTime: 5 * 60_000,
  });

  return (
    <div className="space-y-4">
      <SectionCard
        title="Expression data"
        subtitle="Processed and raw expression matrices"
      >
        <ul className="text-sm space-y-1.5">
          <li className="flex items-baseline gap-2">
            {/* `/datasets/{id}/data` returns Content-Disposition
                attachment so a plain anchor triggers a real file
                download; no JS dance needed. ``?filter=true`` strips
                low-variance / batch-only probes — the standard
                processed export. */}
            <a
              className="text-sky-700 hover:underline"
              href={datasetDataDownloadUrl(id, "processed", { filter: true })}
            >
              Processed expression matrix (TSV)
            </a>
            <span className="text-[11px] text-slate-500">
              filtered; gzip-encoded over the wire
            </span>
          </li>
          <li className="flex items-baseline gap-2">
            <a
              className="text-sky-700 hover:underline"
              href={datasetDataDownloadUrl(id, "processed", { filter: false })}
            >
              Processed expression matrix — unfiltered (TSV)
            </a>
          </li>
          <li className="flex items-baseline gap-2">
            {/* Raw data is only present for some datasets; the link
                404s when there's no raw. We surface the link
                unconditionally; the curator can try it. */}
            <a
              className="text-sky-700 hover:underline"
              href={datasetDataDownloadUrl(id, "raw")}
            >
              Raw expression data (TSV)
            </a>
            <span className="text-[11px] text-slate-500">
              not available for every dataset
            </span>
          </li>
        </ul>
      </SectionCard>

      <SectionCard
        title="Differential expression"
        subtitle="One TSV per analysis result set"
      >
        {resultSetsQ.isLoading ? (
          <LoadingRow />
        ) : resultSetsQ.isError ? (
          <ErrorRow />
        ) : !resultSetsQ.data || resultSetsQ.data.length === 0 ? (
          <p className="text-xs text-slate-500 italic">
            No differential expression analyses are available for this
            dataset.
          </p>
        ) : (
          <ul className="text-sm space-y-1.5">
            {resultSetsQ.data.map((rs) => (
              <ResultSetDownloadRow
                key={rs.id}
                resultSet={rs}
                datasetAccession={dataset.shortName || `dataset-${id}`}
              />
            ))}
          </ul>
        )}
      </SectionCard>

      {gemma1Full && (
        <SectionCard title="Other" subtitle="External resources">
          <ul className="text-sm space-y-1.5 text-sky-700">
            <li>
              <a
                className="hover:underline inline-flex items-center gap-1"
                href={gemma1Full}
                target="_blank"
                rel="noopener noreferrer"
              >
                {GEMMA_1_LABEL} page (full details)
                <ExternalLink size={11} />
              </a>
            </li>
          </ul>
        </SectionCard>
      )}
    </div>
  );
}

/** One row in the DE downloads list — a label describing the result
 *  set (factor name(s) + analysis name) plus a "Download TSV" button.
 *  The button uses ``downloadResultSetTsv`` because a plain anchor
 *  hitting ``/resultSets/{id}`` would content-negotiate to JSON;
 *  TSV needs an explicit ``Accept`` header.
 *
 *  Filename: ``<accession>_resultSet_<id>.tsv`` — mirrors the legacy
 *  expression-matrix download naming so a curator's downloads folder
 *  groups them. */
function ResultSetDownloadRow({
  resultSet,
  datasetAccession,
}: {
  resultSet: DiffExResultSet;
  datasetAccession: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const factorLabels = (resultSet.experimentalFactors ?? [])
    .map((f) => f.name?.trim() || f.category?.trim())
    .filter(Boolean) as string[];
  const label =
    factorLabels.length > 0
      ? factorLabels.join(" × ")
      : `result set ${resultSet.id}`;
  const analysisName = resultSet.analysis?.name ?? null;
  const filename = `${datasetAccession}_resultSet_${resultSet.id}.tsv`;

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await downloadResultSetTsv(resultSet.id, filename);
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message: string }).message)
          : "Download failed.";
      setErr(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex items-baseline gap-2 flex-wrap">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className={
          "text-sky-700 hover:underline disabled:text-slate-400 disabled:cursor-wait"
        }
        title={`Download contrast TSV for result set ${resultSet.id}`}
      >
        {busy ? "Preparing…" : label}
      </button>
      {analysisName ? (
        <span className="text-[11px] text-slate-500 font-mono">
          {analysisName}
        </span>
      ) : null}
      <span className="text-[10px] text-slate-400 font-mono">
        #{resultSet.id}
      </span>
      {err ? (
        <span
          className="text-[11px] text-rose-600"
          title={err}
        >
          {err}
        </span>
      ) : null}
    </li>
  );
}

// ─── Shared micro-components ──────────────────────────────────────────────────

function LoadingRow() {
  return <div className="h-6 w-2/3 bg-slate-200 rounded animate-pulse" />;
}

function ErrorRow() {
  return <p className="text-xs text-red-600">Failed to load. Try refreshing.</p>;
}
