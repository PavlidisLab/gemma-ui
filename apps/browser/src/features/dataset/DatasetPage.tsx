// Public, read-only Expression Experiment page.

import { useMemo, useRef, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useNavigate, useSearch } from "@tanstack/react-router";
import { marked } from "marked";
import { ExternalLink } from "lucide-react";
import {
  getDatasetById,
  getDatasetAnnotations,
  getDatasetDesign,
  getDatasetSamples,
  getDatasetPublications,
  getDatasetPipelineStatus,
  getDatasetDiffExAnalyses,
  getDatasetSvd,
  getDatasetGeeq,
} from "@/api/endpoints";
import { gemmaUrl } from "@/lib/gemmaConfig";
import type {
  Dataset,
  DatasetAnnotation,
  BioAssay,
  ExperimentalDesign,
  Publication,
  PipelineStatus,
  DiffExAnalysis,
  SvdResult,
  GeeqScores,
} from "@/lib/types";

type TabId = "overview" | "design" | "samples" | "expression" | "downloads";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview",   label: "Overview"    },
  { id: "design",     label: "Design"      },
  { id: "samples",    label: "Samples"     },
  { id: "expression", label: "Expression"  },
  { id: "downloads",  label: "Downloads"   },
];

function isTabId(s: unknown): s is TabId {
  return typeof s === "string" && TABS.some((t) => t.id === s);
}

export function DatasetPage() {
  const { id } = useParams({ from: "/dataset/$id" });
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { tab?: string };
  const activeTab: TabId = isTabId(search.tab) ? search.tab : "overview";

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
      <Banner dataset={dataset} activeTab={activeTab} onTabChange={setTab} />
      <div className="mx-auto w-full max-w-[1200px] px-6 py-6 space-y-6">
        {activeTab === "overview"   && <OverviewTab   dataset={dataset} />}
        {activeTab === "design"     && <DesignTab     datasetId={dataset.id ?? Number(id)} />}
        {activeTab === "samples"    && <SamplesTab    datasetId={dataset.id ?? Number(id)} nSamples={dataset.numberOfBioAssays} />}
        {activeTab === "expression" && <ExpressionTab datasetId={dataset.id ?? Number(id)} />}
        {activeTab === "downloads"  && <DownloadsTab  dataset={dataset} />}
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
  dataset, activeTab, onTabChange,
}: {
  dataset: Dataset; activeTab: TabId; onTabChange: (t: TabId) => void;
}) {
  const geo = dataset.accession?.accession;
  const geeq = dataset.geeq?.publicQualityScore;
  const legacyUrl = gemmaUrl(`/expressionExperiment/showExpressionExperiment.html?id=${dataset.id}`);

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
          </div>
          {ps && <PipelineStatusRow ps={ps} />}
        </div>
        {geeq != null && (
          <GeeqChip datasetId={dataset.id} score={geeq} />
        )}
        {ps?.troubled && (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 shrink-0"
            title={ps.troubleDetails ?? undefined}>
            troubled
          </span>
        )}
      </div>
      <div className="mx-auto w-full max-w-[1200px] px-6">
        <nav className="flex items-center gap-1 -mb-px overflow-x-auto">
          {TABS.map((t) => (
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

const S_SCORE_LABELS: Record<string, string> = {
  sScorePublication:              "Publication",
  sScoreOutliers:                 "Few outliers",
  sScoreSampleMeanCorrelation:    "Sample correlation",
  sScoreExperimentDesignProblems: "Design (no problems)",
  sScoreReplicates:               "Has replicates",
  sScorePlatformTechMulti:        "Single technology",
  sScorePlatformPopularity:       "Platform popularity",
};

const Q_SCORE_LABELS: Record<string, string> = {
  qScoreOutlierLow:           "Outlier detection (low)",
  qScoreOutlierHigh:          "Outlier detection (high)",
  qScoreSampleCorrelation:    "Sample correlation",
  qScorePlatformAmount:       "Platform amount",
  qScoreReplicateCorrelation: "Replicate correlation",
  qScoreRawDataAvailable:     "Raw data available",
  qScoreRawDataSuitable:      "Raw data suitable",
  qScorePublicBatchEffect:    "Batch effect",
  qScorePublicBatchConfound:  "Batch confound",
};

function GeeqChip({ datasetId, score }: { datasetId: number; score: number }) {
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

  const geeqQ = useQuery({
    queryKey: ["geeq", datasetId],
    queryFn: ({ signal }) => getDatasetGeeq(datasetId, signal),
    enabled: open,
    staleTime: Infinity,
  });

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
      {open && <GeeqPopover geeq={geeqQ.data ?? null} loading={geeqQ.isLoading} />}
    </div>
  );
}

function GeeqPopover({ geeq, loading }: { geeq: GeeqScores | null; loading: boolean }) {
  return (
    <div className="absolute right-0 top-full mt-1 z-50 w-72 bg-white border border-slate-200 rounded shadow-lg text-[11px]">
      <div className="px-3 py-2 border-b border-slate-100 flex items-baseline justify-between">
        <span className="text-xs font-semibold text-slate-700">GEEQ scores</span>
        {geeq?.publicSuitabilityScore != null && (
          <span className="text-slate-500">
            suitability {geeq.publicSuitabilityScore.toFixed(2)}
          </span>
        )}
      </div>
      {loading ? (
        <div className="px-3 py-3 text-slate-400 italic">Loading…</div>
      ) : !geeq ? (
        <div className="px-3 py-3 text-slate-400 italic">No GEEQ data.</div>
      ) : (
        <div className="divide-y divide-slate-100">
          <ScoreGroup label="Suitability" scores={geeq} labels={S_SCORE_LABELS} />
          <ScoreGroup label="Quality" scores={geeq} labels={Q_SCORE_LABELS} />
        </div>
      )}
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

function PublicationsSection({ publications, loading }: { publications: Publication[]; loading: boolean }) {
  if (!loading && publications.length === 0) return null;
  return (
    <SectionCard title="Publications"
      subtitle={loading ? "loading…" : `${publications.length}`}>
      {loading ? <div className="h-6 w-1/2 bg-slate-200 rounded animate-pulse" /> : (
        <ul className="space-y-3">
          {publications.map((p, i) => (
            <li key={p.id ?? i} className="text-sm">
              <div className="font-medium text-slate-800 leading-snug">{p.title ?? "Untitled"}</div>
              {p.authorList && (
                <div className="text-xs text-slate-500 mt-0.5 line-clamp-1">{p.authorList}</div>
              )}
              <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-x-2">
                {p.publication && <span>{p.publication}</span>}
                {p.publicationDate && <span>{new Date(p.publicationDate).getFullYear()}</span>}
                {p.volume && p.issue && <span>Vol {p.volume}({p.issue})</span>}
                {p.pages && <span>pp.{p.pages}</span>}
                {p.pubAccession && (
                  <a href={`https://pubmed.ncbi.nlm.nih.gov/${p.pubAccession}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-sky-700 hover:underline inline-flex items-center gap-0.5">
                    PMID:{p.pubAccession}<ExternalLink size={10} />
                  </a>
                )}
              </div>
              {p.retracted && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 mt-1 inline-block">
                  RETRACTED
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ─── Design tab ───────────────────────────────────────────────────────────────

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

  return (
    <SectionCard title="Experimental design"
      subtitle={`${design.experimentalFactors.length} factor${design.experimentalFactors.length === 1 ? "" : "s"} · ${design.bioMaterialAssignments.length} samples`}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-1.5 pr-4 font-medium text-slate-600 w-40">Factor</th>
              <th className="text-left py-1.5 pr-4 font-medium text-slate-600 w-24">Type</th>
              <th className="text-left py-1.5 font-medium text-slate-600">Values</th>
            </tr>
          </thead>
          <tbody>
            {design.experimentalFactors.map((f) => (
              <tr key={f.id} className="border-b border-slate-100 align-top">
                <td className="py-2 pr-4 text-slate-800 font-medium">{f.name ?? `Factor ${f.id}`}</td>
                <td className="py-2 pr-4 text-slate-500 italic">{f.type ?? "—"}</td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-1">
                    {f.values.map((v) => (
                      <span key={v.id}
                        className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200">
                        {v.value ?? `FV ${v.id}`}
                      </span>
                    ))}
                    {f.values.length === 0 && <span className="text-slate-400 italic">no values</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

// ─── Samples tab ──────────────────────────────────────────────────────────────

function SamplesTab({ datasetId, nSamples }: { datasetId: number; nSamples: number }) {
  const q = useQuery({
    queryKey: ["datasetSamples", datasetId],
    queryFn: ({ signal }) => getDatasetSamples(datasetId, signal),
  });

  const samples: BioAssay[] = q.data ?? [];

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
                <th className="text-left py-1.5 pr-4 font-medium text-slate-600">Platform</th>
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
                    <td className="py-1.5 pr-4 text-slate-600">{s.arrayDesign?.shortName ?? "—"}</td>
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

function FlagChip({ label, color }: { label: string; color: "red" | "amber" }) {
  const cls = color === "red"
    ? "bg-red-50 text-red-700 border-red-200"
    : "bg-amber-50 text-amber-700 border-amber-200";
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${cls}`}>{label}</span>
  );
}

// ─── Expression tab ───────────────────────────────────────────────────────────

function ExpressionTab({ datasetId }: { datasetId: number }) {
  const analyses = useQuery({
    queryKey: ["datasetDiffEx", datasetId],
    queryFn: ({ signal }) => getDatasetDiffExAnalyses(datasetId, signal),
  });
  const svd = useQuery({
    queryKey: ["datasetSvd", datasetId],
    queryFn: ({ signal }) => getDatasetSvd(datasetId, signal),
    staleTime: 10 * 60_000,
  });

  return (
    <>
      <SectionCard title="Differential expression analyses"
        subtitle={analyses.isLoading ? "loading…" : `${(analyses.data ?? []).length} analys${(analyses.data ?? []).length === 1 ? "is" : "es"}`}>
        {analyses.isLoading ? <LoadingRow /> :
         analyses.isError   ? <ErrorRow /> :
         !analyses.data?.length ? <Empty msg="no differential expression analyses" /> : (
          <DiffExTable analyses={analyses.data} datasetId={datasetId} />
        )}
      </SectionCard>
      <SvdSection svd={svd.data ?? null} loading={svd.isLoading} />
    </>
  );
}

function DiffExTable({ analyses, datasetId }: { analyses: DiffExAnalysis[]; datasetId: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-slate-200">
            <th className="text-left py-1.5 pr-4 font-medium text-slate-600">Analysis</th>
            <th className="text-left py-1.5 pr-4 font-medium text-slate-600">Factors</th>
            <th className="text-left py-1.5 font-medium text-slate-600">Links</th>
          </tr>
        </thead>
        <tbody>
          {analyses.map((a) => {
            const factorNames = Object.values(a.factorValuesUsed ?? {})
              .flat()
              .map((fv) => fv.factor?.name)
              .filter(Boolean);
            const uniqueFactors = [...new Set(factorNames)];
            return (
              <tr key={a.id} className="border-b border-slate-100">
                <td className="py-2 pr-4 text-slate-800 font-mono">ID {a.id}</td>
                <td className="py-2 pr-4 text-slate-600">
                  {uniqueFactors.length ? uniqueFactors.join(", ") : "—"}
                  {a.subsetFactor && (
                    <span className="ml-1 text-slate-400 italic">
                      (subset: {a.subsetFactor.name})
                    </span>
                  )}
                </td>
                <td className="py-2">
                  <a href={gemmaUrl(`/expressionExperiment/showExpressionExperiment.html?id=${datasetId}#dea-${a.id}`)}
                    target="_blank" rel="noopener noreferrer"
                    className="text-sky-700 hover:underline inline-flex items-center gap-1">
                    View on Gemma<ExternalLink size={10} />
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SvdSection({ svd, loading }: { svd: SvdResult | null; loading: boolean }) {
  if (loading) return (
    <SectionCard title="PCA / SVD"><LoadingRow /></SectionCard>
  );
  if (!svd || !svd.variances?.length) return (
    <SectionCard title="PCA / SVD"><Empty msg="no SVD computed for this dataset" /></SectionCard>
  );

  const variances = svd.variances.slice(0, 10);
  const maxV = Math.max(...variances);

  return (
    <SectionCard title="PCA / SVD" subtitle="Variance explained per component">
      <div className="space-y-1.5">
        {variances.map((v, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="text-[11px] font-mono text-slate-500 w-6 text-right">{i + 1}</span>
            <div className="flex-1 h-3 bg-slate-100 rounded overflow-hidden">
              <div
                className="h-full bg-sky-500 rounded"
                style={{ width: `${(v / maxV) * 100}%` }}
              />
            </div>
            <span className="text-[11px] tabular-nums text-slate-600 w-12 text-right">
              {(v * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

// ─── Downloads tab ────────────────────────────────────────────────────────────

function DownloadsTab({ dataset }: { dataset: Dataset }) {
  const id = dataset.id;
  const u = (path: string) => gemmaUrl(path);
  return (
    <SectionCard title="Downloads" subtitle="Bulk data and metadata">
      <ul className="text-sm space-y-1.5 text-sky-700">
        <li>
          <a className="hover:underline inline-flex items-center gap-1"
            href={u(`/expressionExperiment/downloadExpressionExperiment.html?id=${id}`)}
            target="_blank" rel="noopener noreferrer">
            Expression matrix<ExternalLink size={11} />
          </a>
        </li>
        <li>
          <a className="hover:underline inline-flex items-center gap-1"
            href={u(`/expressionExperiment/downloadDEA.html?id=${id}`)}
            target="_blank" rel="noopener noreferrer">
            Differential expression results<ExternalLink size={11} />
          </a>
        </li>
        <li>
          <a className="hover:underline inline-flex items-center gap-1"
            href={u(`/expressionExperiment/showExpressionExperiment.html?id=${id}`)}
            target="_blank" rel="noopener noreferrer">
            Legacy Gemma page (full details)<ExternalLink size={11} />
          </a>
        </li>
      </ul>
    </SectionCard>
  );
}

// ─── Shared micro-components ──────────────────────────────────────────────────

function LoadingRow() {
  return <div className="h-6 w-2/3 bg-slate-200 rounded animate-pulse" />;
}

function ErrorRow() {
  return <p className="text-xs text-red-600">Failed to load. Try refreshing.</p>;
}
