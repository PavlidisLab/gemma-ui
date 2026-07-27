/**
 * Compact horizontal strip of pipeline step badges for one track
 * (analysis or curation). Each badge shows step status via color +
 * icon; hovering reveals last-run timestamp and failure details.
 *
 * Used inside PipelineStatusRow to render both tracks side-by-side.
 */
import type { AnalysisTrack, CurationTrack, PipelineStep, StepStatus } from "@/api/workflowTypes";
import { cn } from "@/lib/cn";

// ---------------------------------------------------------------------------
// Step descriptors
// ---------------------------------------------------------------------------

interface StepDescriptor {
  key: string;
  label: string;
  title: string;
}

const ANALYSIS_STEPS: StepDescriptor[] = [
  { key: "missing_value_analysis", label: "MV",    title: "Missing value analysis" },
  { key: "batch_info",             label: "Batch",  title: "Batch information fetch" },
  { key: "preprocessing",          label: "Proc",   title: "Preprocessing" },
  { key: "dea",                    label: "DEA",    title: "Differential expression analysis" },
  { key: "diagnostics",            label: "Diag",   title: "Diagnostics (PCA / GEEQ)" },
];

const CURATION_STEPS: StepDescriptor[] = [
  { key: "design",         label: "Design",   title: "Experimental design" },
  { key: "tags",           label: "Tags",     title: "Experiment tags" },
  { key: "outlier_review", label: "Outliers", title: "Outlier review" },
  { key: "batch_decision", label: "Batch ✓",  title: "Batch decision" },
  // Step covers both proposal- and audit-kind reviews on the same
  // curation_review table. "Review" is the kind-agnostic verb; the
  // next-task chip on PipelineStatusRow narrows it to "Review
  // proposal" / "Review audit" using group type. Per design review 2026-05-25.
  { key: "audit",          label: "Review",   title: "Curation review (proposal or audit)" },
];

// ---------------------------------------------------------------------------
// Status → visual style
// ---------------------------------------------------------------------------

function badgeClass(status: StepStatus): string {
  switch (status) {
    case "ok":              return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-800";
    case "failed":          return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 ring-red-200 dark:ring-red-800";
    case "in_progress":     return "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 ring-blue-200 dark:ring-blue-800 animate-pulse";
    case "needs_attention": return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 ring-amber-200 dark:ring-amber-800";
    case "na":              return "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-600 ring-slate-200 dark:ring-slate-700 opacity-50";
    case "not_run":
    default:                return "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 ring-slate-200 dark:ring-slate-700";
  }
}

function statusSymbol(status: StepStatus): string {
  switch (status) {
    case "ok":              return "✓";
    case "failed":          return "✕";
    case "in_progress":     return "…";
    case "needs_attention": return "!";
    case "na":              return "–";
    case "not_run":
    default:                return "○";
  }
}

function formatTs(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Single badge
// ---------------------------------------------------------------------------

function StepBadge({
  descriptor,
  step,
  compact = false,
}: {
  descriptor: StepDescriptor;
  step: PipelineStep;
  /** Tighter padding + smaller text for list-view rows that pack
   *  many badges in a single horizontal lane. Per design review 2026-05-25
   *  ("the workflow badges are good overall, it can just be more
   *  compact per-row"). Default off so the legacy callers that
   *  expected the chunkier render keep working unchanged. */
  compact?: boolean;
}) {
  const tooltip = [
    descriptor.title,
    `Status: ${step.status}`,
    step.last_run ? `Last run: ${formatTs(step.last_run)}` : "Never run",
    step.details ? `Note: ${step.details}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-0.5 ${compact ? "px-1 py-0 text-[9px]" : "px-1.5 py-0.5 text-[10px]"} rounded font-medium ring-1 ring-inset cursor-default select-none whitespace-nowrap ${badgeClass(step.status)}`}
    >
      <span className="opacity-70">{statusSymbol(step.status)}</span>
      {descriptor.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export function AnalysisTrackStrip({
  track,
  compact = false,
}: {
  track: AnalysisTrack;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex items-center flex-wrap", compact ? "gap-0.5" : "gap-1")}>
      <span
        className={cn(
          "font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide shrink-0",
          compact ? "text-[9px] w-12" : "text-[10px] w-14",
        )}
      >
        Analysis
      </span>
      {ANALYSIS_STEPS.map((d) => {
        const step = track?.[d.key as keyof AnalysisTrack];
        if (!step) return null;
        return <StepBadge key={d.key} descriptor={d} step={step} compact={compact} />;
      })}
    </div>
  );
}

export function CurationTrackStrip({
  track,
  compact = false,
}: {
  track: CurationTrack;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex items-center flex-wrap", compact ? "gap-0.5" : "gap-1")}>
      <span
        className={cn(
          "font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide shrink-0",
          compact ? "text-[9px] w-12" : "text-[10px] w-14",
        )}
      >
        Curation
      </span>
      {CURATION_STEPS.map((d) => {
        const step = track?.[d.key as keyof CurationTrack];
        if (!step) return null;
        return <StepBadge key={d.key} descriptor={d} step={step} compact={compact} />;
      })}
    </div>
  );
}
