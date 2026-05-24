/**
 * Per-experiment pipeline management panel.
 *
 * Shows the full analysis + curation pipeline status for one experiment,
 * with one-click dispatch buttons for each runnable analysis step and
 * live task-progress tracking. Curation steps are read-only (done by
 * curators manually in the other tabs). GEEQ scores and visibility are
 * also managed here.
 *
 * Mounted as the "Pipeline" tab in the experiment Shell.
 */
import {
  usePipelineStatus,
  useRunPreprocess,
  useFetchBatchInfo,
  useRunDiagnostics,
  useRunDea,
  useRecalculateGeeq,
  useGeeq,
  useSetVisibility,
  useTask,
} from "@/api/workflow";
import type {
  AnalysisTrack,
  AsyncTask,
  CurationTrack,
  PipelineStep,
  StepStatus,
} from "@/api/workflowTypes";
import { useState } from "react";

// ---------------------------------------------------------------------------
// Status helpers (shared visuals)
// ---------------------------------------------------------------------------

function statusDot(status: StepStatus) {
  const base = "shrink-0 w-2.5 h-2.5 rounded-full mt-0.5";
  switch (status) {
    case "ok":              return <span className={`${base} bg-emerald-500`} />;
    case "failed":          return <span className={`${base} bg-red-500`} />;
    case "in_progress":     return <span className={`${base} bg-blue-500 animate-pulse`} />;
    case "needs_attention": return <span className={`${base} bg-amber-400`} />;
    case "na":              return <span className={`${base} bg-slate-200 dark:bg-slate-700`} />;
    default:                return <span className={`${base} bg-slate-300 dark:bg-slate-600`} />;
  }
}

function statusLabel(status: StepStatus) {
  const base = "text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded";
  switch (status) {
    case "ok":              return <span className={`${base} bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400`}>ok</span>;
    case "failed":          return <span className={`${base} bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400`}>failed</span>;
    case "in_progress":     return <span className={`${base} bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 animate-pulse`}>running</span>;
    case "needs_attention": return <span className={`${base} bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400`}>attention</span>;
    case "na":              return <span className={`${base} bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-600`}>n/a</span>;
    default:                return <span className={`${base} bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400`}>not run</span>;
  }
}

function formatTs(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

// ---------------------------------------------------------------------------
// Active task banner
// ---------------------------------------------------------------------------

function TaskBanner({
  task,
  onDismiss,
}: {
  task: AsyncTask;
  onDismiss: () => void;
}) {
  const live = useTask(task.status === "running" ? task.task_id : null);
  const t = live.data ?? task;
  const elapsed = t.started_at
    ? Math.round((Date.now() - new Date(t.started_at).getTime()) / 1000)
    : 0;

  const [bg, icon] =
    t.status === "running"
      ? ["bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800", "⟳"]
      : t.status === "completed"
        ? ["bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800", "✓"]
        : ["bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800", "✕"];

  return (
    <div className={`flex items-start gap-3 px-4 py-3 rounded-lg border text-xs ${bg}`}>
      <span
        className={`text-base leading-none shrink-0 ${t.status === "running" ? "animate-spin inline-block" : ""}`}
        style={t.status === "running" ? { animationDuration: "1.5s" } : undefined}
      >
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <span className="font-semibold capitalize">{t.step.replace("_", " ")}</span>
        {" · "}
        <span className="text-slate-600 dark:text-slate-300 capitalize">{t.status}</span>
        {t.status === "running" && elapsed > 0 && (
          <span className="text-slate-400 dark:text-slate-500 ml-1">({elapsed}s)</span>
        )}
        {t.message && (
          <p className="text-slate-500 dark:text-slate-400 mt-0.5 truncate">{t.message}</p>
        )}
      </div>
      {t.status !== "running" && (
        <button
          onClick={onDismiss}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 shrink-0"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Analysis step row (with dispatch button)
// ---------------------------------------------------------------------------

interface AnalysisStepRowProps {
  title: string;
  step: PipelineStep;
  actionLabel?: string;
  onRun?: () => void;
  running?: boolean;
  disabled?: boolean;
}

function AnalysisStepRow({
  title,
  step,
  actionLabel,
  onRun,
  running,
  disabled,
}: AnalysisStepRowProps) {
  const isNa = step.status === "na";
  const canRun = !!onRun && !isNa;

  return (
    <div className="flex items-start gap-3 py-3 border-b border-slate-100 dark:border-slate-800 last:border-0">
      {statusDot(step.status)}
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{title}</span>
          {statusLabel(step.status)}
          {step.last_run && (
            <span className="text-xs text-slate-400 dark:text-slate-500">{formatTs(step.last_run)}</span>
          )}
        </div>
        {step.details && (
          <p className="text-xs text-slate-500 dark:text-slate-400">{step.details}</p>
        )}
      </div>
      {canRun && actionLabel && (
        <button
          onClick={onRun}
          disabled={disabled || running}
          className="shrink-0 text-xs px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
        >
          {running ? "Starting…" : actionLabel}
        </button>
      )}
      {isNa && (
        <span className="shrink-0 text-xs text-slate-400 dark:text-slate-600 italic">not applicable</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Curation step row (read-only)
// ---------------------------------------------------------------------------

function CurationStepRow({ title, step }: { title: string; step: PipelineStep }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-slate-100 dark:border-slate-800 last:border-0">
      {statusDot(step.status)}
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{title}</span>
          {statusLabel(step.status)}
          {step.last_run && (
            <span className="text-xs text-slate-400 dark:text-slate-500">{formatTs(step.last_run)}</span>
          )}
        </div>
        {step.details && (
          <p className="text-xs text-slate-500 dark:text-slate-400">{step.details}</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section heading
// ---------------------------------------------------------------------------

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1">
      {children}
    </h2>
  );
}

// ---------------------------------------------------------------------------
// GEEQ section
// ---------------------------------------------------------------------------

function GeeqSection({
  experimentId,
  onDispatch,
  anyRunning,
}: {
  experimentId: number | string;
  onDispatch: (task: AsyncTask) => void;
  anyRunning: boolean;
}) {
  const geeq = useGeeq(experimentId);
  const recalc = useRecalculateGeeq(experimentId);

  const q = geeq.data?.quality;
  const s = geeq.data?.suitability;

  function pct(v: number | null) {
    if (v == null) return "—";
    return `${Math.round(((v + 1) / 2) * 100)}%`;
  }

  function scoreColor(v: number | null) {
    if (v == null) return "text-slate-400 dark:text-slate-500";
    const p = ((v + 1) / 2) * 100;
    if (p >= 70) return "text-emerald-600 dark:text-emerald-400";
    if (p >= 40) return "text-amber-600 dark:text-amber-400";
    return "text-red-600 dark:text-red-400";
  }

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-500 dark:text-slate-400">Quality</span>
        <span className={`text-sm font-semibold tabular-nums ${scoreColor(q ?? null)}`}>{pct(q ?? null)}</span>
        <span className="text-xs text-slate-300 dark:text-slate-600">·</span>
        <span className="text-xs text-slate-500 dark:text-slate-400">Suitability</span>
        <span className={`text-sm font-semibold tabular-nums ${scoreColor(s ?? null)}`}>{pct(s ?? null)}</span>
      </div>
      <button
        onClick={() =>
          recalc.mutate(undefined, {
            onSuccess: (task) => onDispatch(task),
          })
        }
        disabled={anyRunning || recalc.isPending}
        className="text-xs px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
      >
        {recalc.isPending ? "Starting…" : "Recalculate GEEQ"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Visibility section
// ---------------------------------------------------------------------------

function VisibilitySection({
  experimentId,
  isPublic,
  anyRunning,
}: {
  experimentId: number | string;
  isPublic: boolean;
  anyRunning: boolean;
}) {
  const setVisibility = useSetVisibility(experimentId);
  const [confirmMakePublic, setConfirmMakePublic] = useState(false);

  if (confirmMakePublic) {
    return (
      <div className="flex items-center gap-3 text-xs">
        <span className="text-slate-600 dark:text-slate-300">
          Make this experiment public? This exposes it to all Gemma users.
        </span>
        <button
          onClick={() => {
            setVisibility.mutate(true);
            setConfirmMakePublic(false);
          }}
          disabled={setVisibility.isPending}
          className="px-3 py-1.5 rounded bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-50 transition-colors"
        >
          {setVisibility.isPending ? "Saving…" : "Confirm publish"}
        </button>
        <button
          onClick={() => setConfirmMakePublic(false)}
          className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${
            isPublic ? "bg-sky-500" : "bg-slate-300 dark:bg-slate-600"
          }`}
        />
        <span className="text-sm text-slate-700 dark:text-slate-200">
          {isPublic ? "Public" : "Private"}
        </span>
      </div>
      {isPublic ? (
        <button
          onClick={() => setVisibility.mutate(false)}
          disabled={anyRunning || setVisibility.isPending}
          className="text-xs px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
        >
          {setVisibility.isPending ? "Saving…" : "Make private"}
        </button>
      ) : (
        <button
          onClick={() => setConfirmMakePublic(true)}
          disabled={anyRunning || setVisibility.isPending}
          className="text-xs px-3 py-1.5 rounded border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-900/30 disabled:opacity-50 transition-colors"
        >
          Make public
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PipelinePanel({ experimentId }: { experimentId: number | string }) {
  const { data: pipelineStatus, isLoading } = usePipelineStatus(experimentId);
  const [activeTask, setActiveTask] = useState<AsyncTask | null>(null);

  const runPreprocess   = useRunPreprocess(experimentId);
  const fetchBatchInfo  = useFetchBatchInfo(experimentId);
  const runDea          = useRunDea(experimentId);
  const runDiagnostics  = useRunDiagnostics(experimentId);

  // Any step currently starting (mutation pending or task running).
  const anyMutationPending =
    runPreprocess.isPending ||
    fetchBatchInfo.isPending ||
    runDea.isPending ||
    runDiagnostics.isPending;

  const taskIsRunning = activeTask?.status === "running";
  const anyRunning = anyMutationPending || taskIsRunning;

  function dispatch(
    mutate: (
      vars: undefined,
      opts: { onSuccess: (t: AsyncTask) => void },
    ) => void,
  ) {
    mutate(undefined, { onSuccess: (t) => setActiveTask(t) });
  }

  if (isLoading) {
    return (
      <div className="px-4 py-8 text-xs text-slate-400 dark:text-slate-600 text-center">
        Loading pipeline status…
      </div>
    );
  }

  const analysis: AnalysisTrack | undefined = pipelineStatus?.analysis;
  const curation: CurationTrack | undefined = pipelineStatus?.curation;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-8">

      {/* Active task banner */}
      {activeTask && (
        <TaskBanner
          task={activeTask}
          onDismiss={() => setActiveTask(null)}
        />
      )}

      {/* Analysis pipeline */}
      <section>
        <SectionHeading>Analysis pipeline</SectionHeading>
        <div className="card px-4 divide-y divide-slate-100 dark:divide-slate-800">
          {analysis ? (
            <>
              <AnalysisStepRow
                title="Missing value analysis"
                step={analysis.missing_value_analysis}
                actionLabel={analysis.missing_value_analysis.status === "not_run" ? "Run" : "Re-run"}
                onRun={() => dispatch((_, opts) => runPreprocess.mutate(undefined, opts))}
                running={runPreprocess.isPending}
                disabled={anyRunning}
              />
              <AnalysisStepRow
                title="Batch information"
                step={analysis.batch_info}
                actionLabel={analysis.batch_info.status === "not_run" ? "Fetch batch info" : "Re-fetch batch info"}
                onRun={() => dispatch((_, opts) => fetchBatchInfo.mutate(undefined, opts))}
                running={fetchBatchInfo.isPending}
                disabled={anyRunning}
              />
              <AnalysisStepRow
                title="Preprocessing"
                step={analysis.preprocessing}
                actionLabel={analysis.preprocessing.status === "not_run" ? "Run preprocessing" : "Re-run preprocessing"}
                onRun={() => dispatch((_, opts) => runPreprocess.mutate(undefined, opts))}
                running={runPreprocess.isPending}
                disabled={anyRunning}
              />
              <AnalysisStepRow
                title="Differential expression analysis"
                step={analysis.dea}
                actionLabel={analysis.dea.status === "not_run" ? "Run DEA" : "Re-run DEA"}
                onRun={() => dispatch((_, opts) => runDea.mutate(undefined, opts))}
                running={runDea.isPending}
                disabled={anyRunning}
              />
              <AnalysisStepRow
                title="Diagnostics (PCA / GEEQ)"
                step={analysis.diagnostics}
                actionLabel={analysis.diagnostics.status === "not_run" ? "Run diagnostics" : "Re-run diagnostics"}
                onRun={() => dispatch((_, opts) => runDiagnostics.mutate(undefined, opts))}
                running={runDiagnostics.isPending}
                disabled={anyRunning}
              />
            </>
          ) : (
            <p className="py-4 text-xs text-slate-400 dark:text-slate-600 text-center">
              No pipeline status available.
            </p>
          )}
        </div>
      </section>

      {/* Curation pipeline (read-only) */}
      <section>
        <SectionHeading>Curation status</SectionHeading>
        <div className="card px-4 divide-y divide-slate-100 dark:divide-slate-800">
          {curation ? (
            <>
              <CurationStepRow title="Experimental design"  step={curation.design} />
              <CurationStepRow title="Tags"                 step={curation.tags} />
              <CurationStepRow title="Outlier review"       step={curation.outlier_review} />
              <CurationStepRow title="Batch decision"       step={curation.batch_decision} />
              <CurationStepRow title="Audit"                step={curation.audit} />
            </>
          ) : (
            <p className="py-4 text-xs text-slate-400 dark:text-slate-600 text-center">
              No curation status available.
            </p>
          )}
        </div>
      </section>

      {/* GEEQ + Visibility */}
      <section>
        <SectionHeading>Scores &amp; visibility</SectionHeading>
        <div className="card px-4 py-4 space-y-4">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">GEEQ</p>
            <GeeqSection
              experimentId={experimentId}
              onDispatch={setActiveTask}
              anyRunning={anyRunning}
            />
          </div>
          <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">Visibility</p>
            <VisibilitySection
              experimentId={experimentId}
              isPublic={pipelineStatus?.is_public ?? false}
              anyRunning={anyRunning}
            />
          </div>
        </div>
      </section>

    </div>
  );
}
