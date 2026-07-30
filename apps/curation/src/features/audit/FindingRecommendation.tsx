/**
 * The curator headline for a post-proposal-evaluation finding — the one
 * canonical "what should I do" line, read off the finding's
 * ``recommendation`` (derived deterministically agent-side from the
 * collapsed verdict). Renders as: the action verb (+ the ``adopt_value``
 * to fold in, for merge / adopt), a confidence chip, and the
 * ``one_line_reason`` as a subtitle. Everything else the audit layer
 * emits — the issue_code slug, the rationale stack, defender verdicts,
 * the three-phase reasoning — demotes below / into the expandable detail;
 * this is the primary signal.
 *
 * Renders nothing meaningful when ``recommendation`` is null (older
 * reports / no verdict attached) — the card falls back to its legacy
 * header there.
 */
import type { Recommendation, RecommendationAction } from "@/api/auditTypes";
import { cn } from "@/lib/cn";

/** Per-action verb + palette: keep=grey, adopt/add=green, merge=blue, drop=amber,
 *  flag=purple. Unknown / forward-compat actions fall back to the
 *  "your call" purple so a new action never renders unstyled. */
const ACTION_META: Record<
  RecommendationAction & string,
  { verb: string; text: string; frame: string }
> = {
  keep_current: {
    verb: "Keep current",
    text: "text-slate-700 dark:text-slate-200",
    frame:
      "border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800/50",
  },
  adopt_proposal: {
    verb: "Adopt proposal",
    text: "text-emerald-800 dark:text-emerald-300",
    frame:
      "border-emerald-300 bg-emerald-50 dark:border-emerald-700/60 dark:bg-emerald-950/20",
  },
  merge: {
    verb: "Merge in",
    text: "text-blue-800 dark:text-blue-300",
    frame:
      "border-blue-300 bg-blue-50 dark:border-blue-700/60 dark:bg-blue-950/20",
  },
  drop: {
    verb: "Drop",
    text: "text-amber-800 dark:text-amber-300",
    frame:
      "border-amber-300 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/20",
  },
  add_missing: {
    verb: "Add missing",
    text: "text-emerald-800 dark:text-emerald-300",
    frame:
      "border-emerald-300 bg-emerald-50 dark:border-emerald-700/60 dark:bg-emerald-950/20",
  },
  flag_for_curator: {
    verb: "Your call",
    text: "text-purple-800 dark:text-purple-300",
    frame:
      "border-purple-300 bg-purple-50 dark:border-purple-700/60 dark:bg-purple-950/20",
  },
};

/** Confidence chip palette — high reads confident (emerald), low reads
 *  tentative (amber), medium neutral. */
function confidenceChipCls(confidence: string): string {
  switch (confidence) {
    case "high":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200";
    case "low":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
    default:
      return "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200";
  }
}

export function FindingRecommendation({
  recommendation,
}: {
  recommendation: Recommendation;
}) {
  const meta =
    ACTION_META[recommendation.action] ?? ACTION_META.flag_for_curator;
  // The concrete value reads inline on the actions that carry one — the
  // thing to fold in (merge), apply (adopt_proposal), or add
  // (add_missing, e.g. "disease: Huntington disease"). keep_current /
  // drop / flag_for_curator ship an empty value.
  const adoptValue = recommendation.adopt_value?.trim() || "";
  const showValue =
    !!adoptValue &&
    (recommendation.action === "merge" ||
      recommendation.action === "adopt_proposal" ||
      recommendation.action === "add_missing");

  return (
    <div
      data-testid="finding-recommendation"
      className={cn("rounded border px-2.5 py-1.5 space-y-0.5", meta.frame)}
    >
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="text-[9px] uppercase tracking-wide font-semibold text-slate-400 dark:text-slate-500">
          recommendation
        </span>
        <span className={cn("text-[12px] font-semibold", meta.text)}>
          {meta.verb}
          {showValue ? (
            <>
              :{" "}
              <span className="font-mono font-normal break-words">
                {adoptValue}
              </span>
            </>
          ) : null}
        </span>
        {recommendation.confidence ? (
          <span
            className={cn(
              "ml-auto rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide",
              confidenceChipCls(recommendation.confidence),
            )}
            title="how confident the evaluation is in this recommendation"
          >
            {recommendation.confidence}
          </span>
        ) : null}
      </div>
      {recommendation.one_line_reason ? (
        <div className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug">
          {recommendation.one_line_reason}
        </div>
      ) : null}
    </div>
  );
}
