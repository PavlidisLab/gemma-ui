// Public, read-only Expression Experiment page.

import { useMemo, useRef, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useNavigate, useSearch } from "@tanstack/react-router";
import { marked } from "marked";
import { ExternalLink, Pencil } from "lucide-react";
import { useMe } from "@/api/auth";
import { curationUrl } from "@/lib/appLinks";
import {
  getDatasetById,
  getDatasetAnnotations,
  getDatasetDesign,
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
import { gemmaUrl, geneUrl, compositeSequenceUrl } from "@/lib/gemmaConfig";
import { capitalizeFirstLetter } from "@/lib/filter";
import type {
  Dataset,
  DatasetAnnotation,
  BioAssay,
  QuantitationType,
  ExperimentalDesign,
  ExperimentalFactorEntry,
  FactorValueBasic,
  FactorValueStatement,
  Publication,
  PipelineStatus,
  DiffExAnalysis,
  DiffExNestedResultSet,
  DiffExResultSet,
  DiffExpressionResponse,
  GeeqScores,
} from "@/lib/types";

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
  const legacyUrl = gemmaUrl(`/expressionExperiment/showExpressionExperiment.html?id=${dataset.id}`);
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
            <a href={legacyUrl} target="_blank" rel="noopener noreferrer"
              className="text-lg font-semibold text-slate-900 hover:underline">
              {dataset.shortName}
            </a>
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
            <a href={legacyUrl} target="_blank" rel="noopener noreferrer"
              className="text-sky-700 hover:underline inline-flex items-center gap-1">
              Gemma<ExternalLink size={11} />
            </a>
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
        {geeq && <GeeqChip geeq={geeq} />}
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
// breakdown popover. Suitability scores capture whether the dataset
// is fit for downstream use (publication, platform amount, raw data,
// sample size); quality scores capture how clean the data actually is
// (outliers, replicate behaviour, batch effects).
const S_SCORE_LABELS: Record<string, string> = {
  sScorePublication:           "Has publication",
  sScoreSampleSize:            "Sample size",
  sScoreRawData:               "Raw data available",
  sScoreMissingValues:         "Few missing values",
  sScorePlatformAmount:        "Platform amount",
  sScorePlatformTechMulti:     "Single technology",
  sScoreAvgPlatformPopularity: "Platform popularity",
  sScoreAvgPlatformSize:       "Platform size",
};

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
      <div className="px-3 py-2 border-b border-slate-100 flex items-baseline justify-between">
        <span className="text-xs font-semibold text-slate-700">GEEQ scores</span>
        {geeq.publicSuitabilityScore != null && (
          <span className="text-slate-500">
            suitability {geeq.publicSuitabilityScore.toFixed(2)}
          </span>
        )}
      </div>
      <div className="divide-y divide-slate-100">
        <ScoreGroup label="Suitability" scores={geeq} labels={S_SCORE_LABELS} />
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
      <PublicationsSection publications={pubs.data ?? []} loading={pubs.isLoading} />
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
    <SectionCard title="Annotations"
      subtitle={loading ? "loading…" : `${annotations.length} term${annotations.length === 1 ? "" : "s"}`}>
      {loading ? <div className="h-6 w-2/3 bg-slate-200 rounded animate-pulse" /> :
       annotations.length === 0 ? <Empty msg="no annotations" /> : (
        <div className="space-y-2">
          {grouped.map(([cat, terms]) => (
            <div key={cat} className="flex items-baseline gap-2 flex-wrap">
              <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{cat}</span>
              {terms.map((t, i) => (
                <span key={`${t.termUri ?? t.termName}-${i}`}
                  className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200"
                  title={t.termUri ?? undefined}>
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

/** Compact publication list — no section card / header chrome. One
 *  publication is the common case, so the card-shaped wrapper + a
 *  "1" subtitle wasted vertical real estate. Multi-pub datasets are
 *  rare; when they happen each publication stacks as its own row. */
function PublicationsSection({ publications, loading }: { publications: Publication[]; loading: boolean }) {
  if (loading) {
    return <div className="h-5 w-1/3 bg-slate-200 rounded animate-pulse" />;
  }
  if (publications.length === 0) return null;
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
  return (
    <SectionCard
      title="Experimental design"
      subtitle={`${bio.length} biological factor${bio.length === 1 ? "" : "s"}${
        nuisance.length ? ` · ${nuisance.length} nuisance` : ""
      } · ${design.bioMaterialAssignments.length} samples`}
    >
      <div className="space-y-3">
        {bio.map((f) => (
          <FactorCard key={f.id} factor={f} />
        ))}
        {nuisance.length > 0 ? (
          <div className="pt-2 mt-2 border-t border-slate-200">
            <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1.5 px-1">
              Nuisance variables
            </div>
            <div className="space-y-2">
              {nuisance.map((f) => (
                <FactorCard key={f.id} factor={f} nuisance />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
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
}: {
  factor: ExperimentalFactorEntry;
  nuisance?: boolean;
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
            <FactorValueRow key={v.id} value={v} factor={factor} />
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
}: {
  value: FactorValueBasic;
  factor: ExperimentalFactorEntry;
}) {
  const stmts = value.statements ?? [];
  const fallbackLabel = value.summary || value.value || `FV ${value.id}`;
  return (
    <li className="px-3 py-1.5 flex items-baseline gap-2 flex-wrap">
      <span
        className="inline-block w-2 text-center text-slate-400 leading-none"
        aria-hidden
      >
        ○
      </span>
      {value.isBaseline ? (
        <span
          className="text-[10px] uppercase tracking-wide font-semibold px-1 py-0 rounded bg-amber-100 text-amber-800 border border-amber-300"
          title="Baseline / reference level for this factor"
        >
          baseline
        </span>
      ) : null}
      {stmts.length > 0 ? (
        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          {stmts.map((s, i) => (
            <StatementLine key={s.id ?? i} statement={s} />
          ))}
        </div>
      ) : (
        <span className="text-xs text-slate-700 break-words flex-1 min-w-0">
          {fallbackLabel}
        </span>
      )}
      {factor.type === "continuous" && value.isMeasurement ? (
        <span className="text-[10px] text-slate-400 font-mono">numeric</span>
      ) : null}
    </li>
  );
}

/** One S-P-O statement line — subject [predicate] object, with the
 *  curation conventions: ontology-resolved terms in emerald chips,
 *  free-text in muted italic, predicate in slate. Missing parts are
 *  omitted so a subject-only statement reads as just the subject. */
function StatementLine({ statement }: { statement: FactorValueStatement }) {
  const hasSubject = !!(statement.subject || statement.subjectUri);
  const hasPredicate = !!(statement.predicate || statement.predicateUri);
  const hasObject = !!(statement.object || statement.objectUri);
  return (
    <div className="flex items-baseline gap-1 flex-wrap text-[12px]">
      {hasSubject ? (
        <OntologyTermChip uri={statement.subjectUri ?? null}>
          {statement.subject ?? ""}
        </OntologyTermChip>
      ) : null}
      {hasPredicate ? (
        <OntologyTermChip
          uri={statement.predicateUri ?? null}
          variant="predicate"
        >
          {statement.predicate ?? ""}
        </OntologyTermChip>
      ) : null}
      {hasObject ? (
        <OntologyTermChip uri={statement.objectUri ?? null}>
          {statement.object ?? ""}
        </OntologyTermChip>
      ) : null}
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
                    <td className="py-1.5 pr-4 text-slate-800">{s.name ?? s.shortName ?? `BA ${s.id}`}</td>
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

function DifferentialExpressionTab({ datasetId }: { datasetId: number }) {
  const analyses = useQuery({
    queryKey: ["datasetDiffEx", datasetId],
    queryFn: ({ signal }) => getDatasetDiffExAnalyses(datasetId, signal),
  });

  return (
    <SectionCard title="Differential expression analyses"
      subtitle={analyses.isLoading ? "loading…" : `${(analyses.data ?? []).length} analys${(analyses.data ?? []).length === 1 ? "is" : "es"}`}>
      {analyses.isLoading ? <LoadingRow /> :
       analyses.isError   ? <ErrorRow /> :
       !analyses.data?.length ? <Empty msg="no differential expression analyses" /> : (
        <DiffExAnalysesList analyses={analyses.data} datasetId={datasetId} />
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

  return (
    <div className="space-y-3">
      {sorted.map((a) => (
        <AnalysisCard key={a.id} analysis={a} datasetId={datasetId} />
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
}: {
  analysis: DiffExAnalysis;
  datasetId: number;
}) {
  const resultSets = analysis.resultSets ?? [];
  const subLabel = subsetLabel(analysis);
  const subFactor = analysis.subsetFactor?.name;
  return (
    <div className="rounded border border-slate-200 bg-white">
      <header className="px-3 py-1.5 border-b border-slate-100 bg-slate-50/60 flex items-baseline gap-2 flex-wrap">
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
        {resultSets.length > 1 ? (
          <span className="ml-auto text-[10px] text-slate-500">
            {resultSets.length} contrasts
          </span>
        ) : null}
      </header>
      {resultSets.length === 0 ? (
        <div className="px-3 py-2 text-xs text-slate-500 italic">
          No result sets recorded.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {resultSets.map((rs) => (
            <ResultSetRow
              key={rs.id}
              resultSet={rs}
              datasetId={datasetId}
              subsetSamplesLabel={subLabel ?? null}
            />
          ))}
        </ul>
      )}
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
  const baseline =
    resultSet.baselineGroup?.factorValue ||
    resultSet.baselineGroup?.characteristics?.[0]?.value ||
    null;

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
      <div className="flex items-baseline gap-2 flex-wrap text-sm">
        <span className="font-medium text-slate-800">{contrastLabel}</span>
        {baseline ? (
          <span className="text-[11px] text-slate-500">
            baseline = <span className="italic">{baseline}</span>
          </span>
        ) : null}
        <DeCountChip nDE={nDE} nTotal={nTotal} pct={pctDE} fdr={fdr} />
        {up > 0 || down > 0 ? (
          <span className="text-[10px] font-mono">
            <span className="text-rose-600">↑{up}</span>{" "}
            <span className="text-sky-600">↓{down}</span>
          </span>
        ) : null}
        <PvalueHistogramStrip resultSetId={resultSet.id} />

        <span className="ml-auto inline-flex items-center gap-2">
          {/* Always enabled: the heatmap fetches the top-50 by
              p-value (threshold=1), so it shows the lowest-p-value
              genes even when nothing clears the FDR cutoff. Gating on
              the FDR-significant count (nDE) would hide the top genes
              for contrasts with no strictly-significant hits, which is
              exactly the view a curator still wants to see. */}
          <button
            type="button"
            onClick={() => setHeatmapOpen(true)}
            className="text-[11px] px-2 py-0.5 rounded border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
            title="Pop out the top-50 genes by lowest p-value as a heatmap"
          >
            Top genes ↗
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="text-[11px] px-2 py-0.5 rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:text-slate-400 disabled:cursor-wait"
            title="Download per-gene contrast TSV"
          >
            {downloading ? "Preparing…" : "Download TSV"}
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
 *  ``GET /resultSets/{id}/pvalueDistribution`` (shipped 2026-05-23 in
 *  response to ``DE_PVALUE_DISTRIBUTION_HANDOFF``). Renders 20 bars
 *  on a 100×24 SVG canvas; the leftmost bar (smallest p-values) is
 *  highlighted so a curator scanning a multi-subset single-cell page
 *  can spot real-signal analyses (left-skewed = good) vs flat /
 *  weird ones in one glance.
 *
 *  Renders nothing when the endpoint 204s or errors — this is a
 *  diagnostic, not load-bearing UI; failing silently keeps the row
 *  uncluttered. Tooltip carries the bar counts so the curator can
 *  hover-inspect without a popover. */
function PvalueHistogramStrip({ resultSetId }: { resultSetId: number }) {
  const q = useQuery({
    queryKey: ["resultset-pvalue-dist", resultSetId],
    queryFn: ({ signal }) =>
      getPvalueDistribution(resultSetId, { bins: 20, column: "corrected" }, signal),
    staleTime: 30 * 60_000,
  });
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
      .join("\n");
  return (
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
  const designQ = useQuery({
    queryKey: ["dataset-design", datasetId],
    queryFn: ({ signal }) => getDatasetDesign(datasetId, signal),
    staleTime: 5 * 60_000,
  });

  const payload = useMemo<HeatmapPayload | null>(() => {
    if (!q.data || !samplesQ.data || !designQ.data) return null;
    return buildDeHeatmapPayload(q.data, samplesQ.data, designQ.data, datasetId);
  }, [q.data, samplesQ.data, designQ.data, datasetId]);

  const data = useMemo<HeatmapData | null>(() => {
    if (!q.data) return null;
    return buildDeHeatmap(q.data);
  }, [q.data]);

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
  // (now-retired) side table. Reads straight from q.data so it stays
  // in sync with row order in the heatmap.
  const rowInfo = (i: number) => {
    const lvl = q.data?.geneExpressionLevels?.[i];
    if (!lvl) return null;
    const vec = lvl.vectors?.[0];
    return {
      symbol: lvl.geneOfficialSymbol ?? null,
      officialName: lvl.geneOfficialName ?? null,
      ncbiHref:
        lvl.geneNcbiId != null || lvl.geneId != null
          ? geneUrl({ ncbiId: lvl.geneNcbiId, geneId: lvl.geneId })
          : null,
      probeName: vec?.designElementName ?? null,
      probeHref:
        vec?.designElementId != null
          ? compositeSequenceUrl(vec.designElementId)
          : null,
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
        rowLabelGutterWidth={300}
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
              <div className="flex gap-3 pt-1 text-[11px]">
                {r.ncbiHref ? (
                  <a
                    href={r.ncbiHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-700 hover:underline"
                  >
                    NCBI Gene ↗
                  </a>
                ) : null}
                {r.probeHref ? (
                  <a
                    href={r.probeHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-700 hover:underline"
                  >
                    Gemma probe ↗
                  </a>
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
  const levels = response.geneExpressionLevels ?? [];
  if (levels.length === 0) return { values: [] };
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
    rowLabelColumns.push([sym, name]);
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
    colLabels: colOrder,
  };
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
  const levels = response.geneExpressionLevels ?? [];
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

      <SectionCard title="Other" subtitle="External resources">
        <ul className="text-sm space-y-1.5 text-sky-700">
          <li>
            <a
              className="hover:underline inline-flex items-center gap-1"
              href={gemmaUrl(
                `/expressionExperiment/showExpressionExperiment.html?id=${id}`,
              )}
              target="_blank"
              rel="noopener noreferrer"
            >
              Legacy Gemma page (full details)
              <ExternalLink size={11} />
            </a>
          </li>
        </ul>
      </SectionCard>
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
