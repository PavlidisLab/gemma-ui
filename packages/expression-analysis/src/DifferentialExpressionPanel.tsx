/**
 * Differential expression browse: analyses → contrasts (result sets),
 * DE counts, up/down split, p-value distribution, TSV download.
 *
 * Extracted from apps/browser's `DifferentialExpressionTab`
 * (`DatasetPage.tsx`, 2026-09-30) so apps/curation can offer the same
 * feature without a second implementation.
 *
 * 🛑 **Scope cut from the source it was extracted from:** the original
 * also has a per-contrast "View top" button that pops out a heatmap of
 * the top-50 DE genes (`ResultSetHeatmap`). That path pulls in three
 * more queries (dataset samples, platforms, full design) AND two
 * browser-only route links (gene page, probe page) on top of what this
 * panel already needs — deep enough coupling that porting it faithfully
 * was cut from this pass rather than shipped half-verified. Analyses,
 * contrasts, DE counts, p-value distributions and TSV download are all
 * present; the gene-level drill-down heatmap is not yet. Follow-up.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient, type QueryFunctionContext } from "@tanstack/react-query";
import { niceTicks } from "@gemma/diagnostics";
import { middleEllipsis, isBaselineTerm } from "./util";
import type {
  DiffExAnalysis,
  DiffExNestedResultSet,
  DifferentialExpressionApi,
  ExperimentalFactorEntry,
  FactorValueBasic,
  PvalueDistribution,
} from "./deTypes";

export interface TermChipInput {
  uri: string | null;
  label: string;
}

export interface DifferentialExpressionPanelProps {
  api: DifferentialExpressionApi;
  entityId: number;
  /** Renders one condition-term chip. Omit for a plain-text fallback —
   *  the original's chip links into an app-local ontology-search route
   *  this package can't know about. */
  renderTermChip?: (input: TermChipInput) => React.ReactNode;
}

const INLINE_LEVELS = 2;

export function factorValueLabel(v: FactorValueBasic): string {
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

export function factorValueTerm(v: FactorValueBasic): { label: string; uri: string | null } {
  const char = v.characteristics?.find((c) => (c.value ?? "").trim());
  const stmt = v.statements?.find((s) => (s.subject ?? "").trim());
  const label = (v.summary || v.value || char?.value || stmt?.subject || `FV ${v.id}`).trim();
  return { label, uri: char?.valueUri ?? stmt?.subjectUri ?? null };
}

function pvalueDistQueryOptions(api: DifferentialExpressionApi, resultSetId: number) {
  return {
    queryKey: ["differential-expression:pvalue-dist", resultSetId] as const,
    queryFn: ({ signal }: QueryFunctionContext) =>
      api.getPvalueDistribution(resultSetId, { bins: 20, column: "raw" }, signal),
    staleTime: 30 * 60_000,
  };
}

export function DifferentialExpressionPanel({ api, entityId, renderTermChip }: DifferentialExpressionPanelProps) {
  const queryClient = useQueryClient();
  const analyses = useQuery({
    queryKey: ["differential-expression:analyses", entityId],
    queryFn: ({ signal }) => api.getAnalyses(entityId, signal),
  });

  const analysesData = analyses.data;
  useEffect(() => {
    if (!analysesData) return;
    for (const a of analysesData) {
      if (a.isSubset) continue;
      for (const rs of a.resultSets ?? []) {
        void queryClient.prefetchQuery(pvalueDistQueryOptions(api, rs.id));
      }
    }
  }, [analysesData, queryClient, api]);

  const count = analyses.data?.length ?? 0;
  return (
    <section className="bg-white border border-slate-200 rounded">
      <header className="px-4 py-2 border-b border-slate-200 flex items-baseline justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold tracking-wide">Differential expression analyses</h2>
        <span className="text-[11px] text-slate-500">
          {analyses.isLoading ? "loading…" : `${count} analys${count === 1 ? "is" : "es"}`}
        </span>
      </header>
      <div className="p-3">
        {analyses.isLoading ? (
          <LoadingRow />
        ) : analyses.isError ? (
          <ErrorRow />
        ) : !analyses.data?.length ? (
          <Empty msg="no differential expression analyses" />
        ) : (
          <DiffExAnalysesList key={entityId} api={api} analyses={analyses.data} entityId={entityId} renderTermChip={renderTermChip} />
        )}
      </div>
    </section>
  );
}

function LoadingRow() {
  return <p className="text-xs text-slate-500 italic px-1 py-2">loading…</p>;
}
function ErrorRow() {
  return <p className="text-xs text-rose-600 px-1 py-2">Couldn't load.</p>;
}
function Empty({ msg }: { msg: string }) {
  return <p className="text-xs text-slate-500 italic px-1 py-2">{msg}</p>;
}

function subsetLabel(a: DiffExAnalysis): string | null {
  const sfv = a.subsetFactorValue;
  if (!sfv) return null;
  return sfv.summary || sfv.factorValue || sfv.value || sfv.characteristics?.[0]?.value || null;
}

function DiffExAnalysesList({
  api, analyses, entityId, renderTermChip,
}: {
  api: DifferentialExpressionApi;
  analyses: DiffExAnalysis[];
  entityId: number;
  renderTermChip?: (input: TermChipInput) => React.ReactNode;
}) {
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
  const setAll = (open: boolean) => setOpenIds(open ? new Set(sorted.map((a) => a.id)) : new Set());
  const allOpen = sorted.every((a) => openIds.has(a.id));

  return (
    <div className="space-y-3">
      {sorted.length > 1 ? (
        <div className="flex justify-end -mb-1">
          <button type="button" onClick={() => setAll(!allOpen)} className="text-[11px] text-sky-700 hover:underline cursor-pointer">
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        </div>
      ) : null}
      {sorted.map((a) => (
        <AnalysisCard key={a.id} api={api} analysis={a} entityId={entityId} open={openIds.has(a.id)} onToggle={() => toggle(a.id)} renderTermChip={renderTermChip} />
      ))}
    </div>
  );
}

function AnalysisCard({
  api, analysis, entityId, open, onToggle, renderTermChip,
}: {
  api: DifferentialExpressionApi;
  analysis: DiffExAnalysis;
  entityId: number;
  open: boolean;
  onToggle: () => void;
  renderTermChip?: (input: TermChipInput) => React.ReactNode;
}) {
  const resultSets = [...(analysis.resultSets ?? [])].sort(
    (a, b) => ((a.experimentalFactors?.length ?? 0) > 1 ? 1 : 0) - ((b.experimentalFactors?.length ?? 0) > 1 ? 1 : 0),
  );
  const subLabel = subsetLabel(analysis);
  const subFactor = analysis.subsetFactor?.name;
  const totalDE = resultSets.reduce((sum, rs) => sum + (rs.numberOfDiffExpressedProbes ?? 0), 0);
  const bodyId = `analysis-${analysis.id}-body`;
  return (
    <div className="rounded border border-slate-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={bodyId}
        className={"w-full text-left px-3 py-1.5 bg-slate-50/60 hover:bg-slate-100/70 cursor-pointer flex items-baseline gap-2 flex-wrap " + (open ? "border-b border-slate-100" : "")}
      >
        <span className={"shrink-0 self-center text-slate-400 transition-transform inline-block " + (open ? "rotate-90" : "")}>›</span>
        {subLabel ? (
          <span className="text-xs font-semibold text-slate-800">
            {subFactor ? <span className="text-slate-500 font-normal">{subFactor}: </span> : null}
            {subLabel}
          </span>
        ) : (
          <span className="text-xs font-semibold text-slate-800">Whole-experiment analysis</span>
        )}
        <span className="text-[10px] text-slate-400 font-mono">#{analysis.id}</span>
        <span className="ml-auto inline-flex items-baseline gap-2">
          {totalDE > 0 ? (
            <span className="text-[10px] text-slate-500">
              <span className="font-mono text-slate-700">{totalDE.toLocaleString()}</span> DE
            </span>
          ) : null}
          <span className="text-[10px] text-slate-500">{resultSets.length} contrast{resultSets.length === 1 ? "" : "s"}</span>
        </span>
      </button>
      {open ? (
        resultSets.length === 0 ? (
          <div id={bodyId} className="px-3 py-2 text-xs text-slate-500 italic">No result sets recorded.</div>
        ) : (
          <ul id={bodyId} className="divide-y divide-slate-100">
            {resultSets.map((rs) => (
              <ResultSetRow key={rs.id} api={api} resultSet={rs} entityId={entityId} subsetSamplesLabel={subLabel ?? null} renderTermChip={renderTermChip} />
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

function ResultSetRow({
  api, resultSet, entityId, subsetSamplesLabel, renderTermChip,
}: {
  api: DifferentialExpressionApi;
  resultSet: DiffExNestedResultSet;
  entityId: number;
  subsetSamplesLabel: string | null;
  renderTermChip?: (input: TermChipInput) => React.ReactNode;
}) {
  const [downloading, setDownloading] = useState(false);
  const [downloadErr, setDownloadErr] = useState<string | null>(null);
  const [levelsOpen, setLevelsOpen] = useState(false);

  const factorLabels = (resultSet.experimentalFactors ?? [])
    .map((f) => f.name?.trim() || f.category?.trim())
    .filter(Boolean) as string[];
  const contrastLabel = factorLabels.length > 0 ? factorLabels.join(" × ") : `result set ${resultSet.id}`;

  const rsFactors = resultSet.experimentalFactors ?? [];
  const isInteraction = rsFactors.length > 1;
  const baselineFvId = resultSet.baselineGroup?.id ?? null;
  const designQ = useQuery({
    queryKey: ["differential-expression:design", entityId],
    queryFn: ({ signal }) => (api.getDesign ? api.getDesign(entityId, signal) : Promise.resolve(null)),
    enabled: !!api.getDesign,
    staleTime: 5 * 60_000,
  });
  const { conditionTerms, baselineLabel } = useMemo(() => {
    const bgRaw = resultSet.baselineGroup?.factorValue || resultSet.baselineGroup?.characteristics?.[0]?.value || null;
    const bgLabel = bgRaw ? (isBaselineTerm(bgRaw) ? "baseline" : bgRaw) : null;
    if (isInteraction || rsFactors.length === 0) return { conditionTerms: [] as ReturnType<typeof factorValueTerm>[], baselineLabel: bgLabel };
    const df: ExperimentalFactorEntry | undefined = (designQ.data?.experimentalFactors ?? []).find((f) => f.id === rsFactors[0].id);
    if (!df) return { conditionTerms: [] as ReturnType<typeof factorValueTerm>[], baselineLabel: bgLabel };
    const conds = df.values.filter((v) =>
      baselineFvId != null ? v.id !== baselineFvId : !isBaselineTerm(factorValueTerm(v).label),
    );
    const baseFv = baselineFvId != null ? df.values.find((v) => v.id === baselineFvId) : undefined;
    return {
      conditionTerms: conds.map(factorValueTerm),
      baselineLabel: baseFv ? factorValueLabel(baseFv) : bgLabel,
    };
  }, [designQ.data, rsFactors, isInteraction, baselineFvId, resultSet.baselineGroup]);

  const nDE = resultSet.numberOfDiffExpressedProbes ?? 0;
  const nTotal = resultSet.numberOfProbesAnalyzed ?? 0;
  const fdr = resultSet.threshold ?? 0.05;
  const pctDE = nTotal > 0 ? (nDE / nTotal) * 100 : 0;
  const up = resultSet.upregulatedCount ?? resultSet.numberOfUpregulatedProbes ?? 0;
  const down = resultSet.downregulatedCount ?? resultSet.numberOfDownregulatedProbes ?? 0;

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    setDownloadErr(null);
    try {
      const fname = `dataset_${entityId}_resultSet_${resultSet.id}.tsv`;
      await api.downloadResultSetTsv(resultSet.id, fname);
    } catch (e: unknown) {
      setDownloadErr(e && typeof e === "object" && "message" in e ? String((e as { message: string }).message) : "Download failed.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <li className="px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-3 text-sm flex-wrap">
        <div className="flex-1 min-w-0">
          {isInteraction ? (
            <span className="inline-flex items-baseline gap-1.5">
              <span className="font-medium text-slate-800">{contrastLabel}</span>
              <span className="text-[10px] uppercase tracking-wide text-slate-400">interaction</span>
            </span>
          ) : conditionTerms.length > 0 ? (
            <span className="inline-flex items-baseline gap-1.5 flex-wrap">
              <span className="font-medium text-slate-800" title="experimental factor">{contrastLabel}</span>
              <span className="text-[11px] text-slate-400">·</span>
              {conditionTerms.length > INLINE_LEVELS && !levelsOpen ? (
                <button
                  type="button"
                  onClick={() => setLevelsOpen(true)}
                  className="text-[11px] text-slate-600 underline underline-offset-2 decoration-dotted hover:text-slate-900"
                  title={conditionTerms.map((c) => c.label).join("\n")}
                >
                  {conditionTerms.length} levels
                </button>
              ) : (
                <>
                  {conditionTerms.map((t, i) => (
                    <span key={i} className="inline-flex min-w-0 max-w-[22rem]">
                      {renderTermChip ? renderTermChip(t) : <DefaultTermChip {...t} />}
                    </span>
                  ))}
                  {conditionTerms.length > INLINE_LEVELS ? (
                    <button type="button" onClick={() => setLevelsOpen(false)} className="text-[11px] text-slate-500 underline underline-offset-2 decoration-dotted hover:text-slate-800">
                      fewer
                    </button>
                  ) : null}
                </>
              )}
              <span className="text-[11px] text-slate-400">vs</span>
              <span className="text-[11px] text-slate-500 italic truncate max-w-[22rem]" title={baselineLabel ?? "baseline"}>
                {baselineLabel ?? "baseline"}
              </span>
            </span>
          ) : (
            <span className="inline-flex items-baseline gap-1.5 min-w-0">
              <span className="font-medium text-slate-800">{contrastLabel}</span>
              {baselineLabel ? (
                <span className="text-[11px] text-slate-500 inline-flex items-baseline gap-1 min-w-0">
                  vs <span className="italic truncate max-w-[22rem]" title={baselineLabel}>{baselineLabel}</span>
                </span>
              ) : null}
            </span>
          )}
        </div>

        <div className="shrink-0 flex items-center gap-3">
          <span className="w-44 flex justify-end">
            <DeCountChip nDE={nDE} nTotal={nTotal} pct={pctDE} fdr={fdr} />
          </span>
          <span className="w-20 text-right text-[10px] font-mono tabular-nums whitespace-nowrap">
            {up > 0 || down > 0 ? (
              <>
                <span className="text-rose-600">↑{up}</span> <span className="text-sky-600">↓{down}</span>
              </>
            ) : null}
          </span>
          <span className="w-[100px] inline-flex justify-start">
            <PvalueHistogramStrip api={api} resultSetId={resultSet.id} label={subsetSamplesLabel ? `${contrastLabel} · ${subsetSamplesLabel}` : contrastLabel} />
          </span>
        </div>

        <span className="shrink-0 inline-flex items-center gap-3 text-[11px]">
          <button type="button" onClick={handleDownload} disabled={downloading} className="text-slate-500 hover:underline disabled:text-slate-300 disabled:cursor-wait" title="Download per-gene contrast TSV">
            {downloading ? "…" : "TSV"}
          </button>
          <span className="text-[10px] text-slate-400 font-mono">#{resultSet.id}</span>
        </span>
      </div>
      {downloadErr ? <p className="text-[11px] text-rose-600">{downloadErr}</p> : null}
    </li>
  );
}

function DefaultTermChip({ uri, label }: TermChipInput) {
  return (
    <span className={"text-[11px] px-1.5 py-0.5 rounded border " + (uri ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-500 italic")} title={label}>
      {middleEllipsis(label)}
    </span>
  );
}

function DeCountChip({ nDE, nTotal, pct, fdr }: { nDE: number; nTotal: number; pct: number; fdr: number }) {
  const tint =
    pct >= 15 ? "bg-rose-50 text-rose-800 border-rose-200" :
    pct >= 5 ? "bg-amber-50 text-amber-800 border-amber-200" :
    nDE > 0 ? "bg-sky-50 text-sky-800 border-sky-200" :
    "bg-slate-50 text-slate-500 border-slate-200";
  return (
    <span
      className={"text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded border whitespace-nowrap " + tint}
      title={`${nDE} differentially expressed of ${nTotal} probes at FDR < ${fdr}`}
    >
      {nDE.toLocaleString()}/{nTotal.toLocaleString()} ({pct.toFixed(1)}%)
    </span>
  );
}

// ─── p-value distribution ───────────────────────────────────────────────────

function PvalueHistogramStrip({ api, resultSetId, label }: { api: DifferentialExpressionApi; resultSetId: number; label?: string }) {
  const [open, setOpen] = useState(false);
  const q = useQuery(pvalueDistQueryOptions(api, resultSetId));
  if (q.isLoading) {
    return <span className="inline-block h-[18px] w-[100px] bg-slate-100 rounded animate-pulse" aria-hidden />;
  }
  if (q.isError || !q.data || q.data.bins.length === 0) return null;

  const dist = q.data;
  const W = 100;
  const H = 18;
  const maxCount = dist.bins.reduce((m, b) => (b.count > m ? b.count : m), 0);
  if (maxCount === 0) return null;
  const barW = W / dist.bins.length;
  const flatY = (1 - dist.n / dist.bins.length / maxCount) * H;
  const title =
    `Corrected p-value histogram · n=${dist.n.toLocaleString()} probes\n` +
    dist.bins.map((b, i) => `[${b.lo.toFixed(2)}, ${b.hi.toFixed(2)}${i === dist.bins.length - 1 ? "]" : ")"}) ${b.count}`).join("\n") +
    "\n(click to enlarge)";
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Enlarge raw p-value distribution" className="inline-flex items-center align-middle rounded p-0 cursor-pointer hover:ring-1 hover:ring-sky-300 focus:outline-none focus:ring-1 focus:ring-sky-400">
        <svg width={W} height={H} role="img" aria-label="raw p-value distribution" className="inline-block align-middle">
          <title>{title}</title>
          <rect x={0} y={0} width={W} height={H} fill="#f8fafc" />
          {flatY > 0 && flatY < H ? <line x1={0} y1={flatY} x2={W} y2={flatY} stroke="#cbd5e1" strokeWidth={0.5} strokeDasharray="2 2" /> : null}
          {dist.bins.map((b, i) => {
            const h = (b.count / maxCount) * H;
            const x = i * barW;
            const y = H - h;
            const fill = i === 0 ? "#0284c7" : "#94a3b8";
            return <rect key={i} x={x + 0.3} y={y} width={Math.max(0.6, barW - 0.6)} height={h} fill={fill} />;
          })}
        </svg>
      </button>
      {open ? (
        <HeatmapPopup title={label ? `Corrected p-value distribution · ${label}` : "Corrected p-value distribution"} onClose={() => setOpen(false)}>
          <PvalueHistogramLarge dist={dist} />
        </HeatmapPopup>
      ) : null}
    </>
  );
}

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
  const flatCount = dist.n / dist.bins.length;
  const flatY = padT + innerH * (1 - flatCount / yMax);
  const SUBTLE = "#6b7280";
  const GRID = "#e5e7eb";
  const AXIS = "#334155";
  return (
    <div className="p-3 bg-white">
      <svg width={W} height={H} role="img" aria-label="raw p-value distribution, enlarged">
        <rect x={0} y={0} width={W} height={H} fill="#ffffff" />
        {yTicks.map((t) => {
          const y = padT + innerH * (1 - t / yMax);
          return (
            <g key={`y${t}`}>
              <line x1={padL} x2={padL + innerW} y1={y} y2={y} stroke={GRID} strokeWidth={0.5} />
              <text x={padL - 8} y={y + 4} fontSize={11} fill={SUBTLE} textAnchor="end" fontFamily="-apple-system, sans-serif">
                {t.toLocaleString()}
              </text>
            </g>
          );
        })}
        {maxCount > 0 && flatCount <= yMax ? (
          <g>
            <line x1={padL} x2={padL + innerW} y1={flatY} y2={flatY} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="4 3" />
            <text x={padL + innerW - 2} y={flatY - 4} fontSize={10} fill="#94a3b8" textAnchor="end" fontFamily="-apple-system, sans-serif">
              uniform null
            </text>
          </g>
        ) : null}
        {dist.bins.map((b, i) => {
          const h = maxCount > 0 ? (b.count / yMax) * innerH : 0;
          const x = padL + i * barW;
          const y = padT + innerH - h;
          const fill = i === 0 ? "#0284c7" : "#94a3b8";
          return (
            <rect key={i} x={x + 0.5} y={y} width={Math.max(1, barW - 1)} height={h} fill={fill}>
              <title>{`[${b.lo.toFixed(2)}, ${b.hi.toFixed(2)}${i === dist.bins.length - 1 ? "]" : ")"}) — ${b.count.toLocaleString()} probes`}</title>
            </rect>
          );
        })}
        <line x1={padL} y1={padT} x2={padL} y2={padT + innerH} stroke={AXIS} strokeWidth={1} />
        <line x1={padL} y1={padT + innerH} x2={padL + innerW} y2={padT + innerH} stroke={AXIS} strokeWidth={1} />
        {xTicks.map((t) => {
          const x = padL + innerW * t;
          return (
            <g key={`x${t}`}>
              <line x1={x} y1={padT + innerH} x2={x} y2={padT + innerH + 4} stroke={AXIS} strokeWidth={1} />
              <text x={x} y={padT + innerH + 17} fontSize={11} fill={SUBTLE} textAnchor="middle" fontFamily="-apple-system, sans-serif">
                {t.toFixed(2)}
              </text>
            </g>
          );
        })}
        <text x={padL + innerW / 2} y={H - 6} fontSize={12} fill={AXIS} textAnchor="middle" fontFamily="-apple-system, sans-serif">raw p-value</text>
        <text x={16} y={padT + innerH / 2} fontSize={12} fill={AXIS} textAnchor="middle" transform={`rotate(-90 16 ${padT + innerH / 2})`} fontFamily="-apple-system, sans-serif">number of probes</text>
      </svg>
      <p className="mt-1 text-[11px] text-slate-500 text-center">
        n = {dist.n.toLocaleString()} probes · {dist.bins.length} bins · leftmost bin (smallest p-values) highlighted
      </p>
    </div>
  );
}

/** Minimal draggable/resizable pop-out modal — used for the enlarged
 *  p-value distribution. Ported verbatim from apps/browser's
 *  `HeatmapPopup` (no app coupling there — plain DOM + React state). */
function HeatmapPopup({ children, title, onClose }: { children: React.ReactNode; title?: string; onClose: () => void }) {
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragStateRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onTitleBarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    dragStateRef.current = { startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onTitleBarPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragStateRef.current;
    if (!s) return;
    setOffset({ x: s.baseX + (e.clientX - s.startX), y: s.baseY + (e.clientY - s.startY) });
  };
  const onTitleBarPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStateRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  };

  return (
    <div onClick={onClose} className="fixed inset-0 z-[900] flex items-center justify-center bg-slate-900/45 p-3" role="dialog" aria-modal="true">
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex flex-col bg-white rounded-lg shadow-2xl overflow-hidden"
        style={{
          width: "max-content", maxWidth: "min(96vw, 1400px)", maxHeight: "92vh",
          minWidth: 360, minHeight: 240, resize: "both",
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
          <span className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold truncate">{title ?? "Distribution"}</span>
          <button type="button" data-no-drag onClick={onClose} aria-label="Close" className="inline-flex items-center justify-center h-6 w-6 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200 text-xl leading-none">×</button>
        </div>
        <div className="flex-1 overflow-auto p-2">{children}</div>
      </div>
    </div>
  );
}
