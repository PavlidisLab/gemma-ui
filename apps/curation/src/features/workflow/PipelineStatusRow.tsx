/**
 * One experiment row in the workflow queue. Shows accession + title,
 * both pipeline tracks (analysis + curation), and key flags (troubled,
 * needs attention, public, GEEQ scores).
 *
 * Clicking the row navigates to the experiment. Clicking a specific
 * track badge could navigate to the relevant tab (future enhancement).
 */
import type { ExperimentPipelineStatus, WorkflowDatasetRow } from "@/api/workflowTypes";
import { experimentRoute, navigate } from "@/routes";
import { AnalysisTrackStrip, CurationTrackStrip } from "./PipelineTrackStrip";

function GeeqPill({ score, label }: { score: number | null; label: string }) {
  if (score === null || typeof score !== "number" || !Number.isFinite(score)) return null;
  const pct = Math.round(((score + 1) / 2) * 100);
  const color =
    pct >= 70
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
      : pct >= 40
        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
        : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${color}`}>
      {label} {pct}%
    </span>
  );
}

export function PipelineStatusRow({
  dataset,
  status,
  groupContext,
}: {
  dataset: WorkflowDatasetRow;
  status: ExperimentPipelineStatus | undefined;
  /** When the queue is rendered inside a specific Group (workflow
   *  page anchored on a group id), forward that as ``?group=<id>``
   *  on the experiment-page link so the inline prev/next nav cluster
   *  on the experiment banner anchors to the same set the curator
   *  was browsing. Undefined for the global queue (no anchor). */
  groupContext?: string;
}) {
  const accession = dataset.short_name || String(dataset.id);
  const title = dataset.name;
  const goTo = () =>
    navigate(experimentRoute(dataset.id, undefined, groupContext));

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={goTo}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") goTo();
      }}
      className="group flex flex-col gap-1.5 px-4 py-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 transition-colors"
    >
      {/* Header row: accession + title + flags */}
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-mono text-xs font-semibold text-slate-600 dark:text-slate-300 shrink-0">
            {accession}
          </span>
          <span className="text-sm text-slate-700 dark:text-slate-200 truncate">
            {title}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {dataset.troubled && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 ring-1 ring-inset ring-red-200 dark:ring-red-800">
              troubled
            </span>
          )}
          {dataset.needs_attention && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 ring-1 ring-inset ring-amber-200 dark:ring-amber-800">
              attention
            </span>
          )}
          {dataset.is_public && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400 ring-1 ring-inset ring-sky-200 dark:ring-sky-800">
              public
            </span>
          )}
          <GeeqPill score={dataset.geeq_public_quality_score} label="Q" />
          <GeeqPill score={dataset.geeq_public_suitability_score} label="S" />
        </div>
      </div>

      {/* Pipeline tracks */}
      {status && status.analysis && status.curation ? (
        <div className="flex flex-col gap-1 pl-0">
          <AnalysisTrackStrip track={status.analysis} />
          <CurationTrackStrip track={status.curation} />
        </div>
      ) : status ? (
        <div className="text-[11px] text-slate-400 dark:text-slate-500 italic pl-0">
          pipeline status unavailable
        </div>
      ) : (
        <div className="h-10 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
      )}

      {/* Curation note if present */}
      {status?.curation_note && (
        <p className="text-xs text-slate-500 dark:text-slate-400 italic truncate pl-16">
          {status.curation_note}
        </p>
      )}
    </div>
  );
}
