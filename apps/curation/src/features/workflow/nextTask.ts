/**
 * Per-experiment "what's the next thing to do here?" derivation for
 * the workflow queue rows.
 *
 * Two sources, in priority order (per design review 2026-05-25):
 *
 *   1. **Assigned ticket** — if the curator has an open / in-progress
 *      ticket targeting this experiment, the ticket's intent is the
 *      next task. The ticket title gets surfaced as the chip label;
 *      its priority / state colour the chip.
 *   2. **First not-OK pipeline step** — walk curation track first
 *      (Design → Tags → Outliers → Batch decision → Audit), then
 *      analysis (MV → Batch → Proc → DEA → Diag). The first step
 *      whose status isn't ``ok`` / ``na`` becomes the next task.
 *
 * Returns null when nothing's pending — curator can scan past
 * "done" rows without the chip claiming there's work.
 */
import type {
  ExperimentPipelineStatus,
  GroupTaskKind,
  GroupType,
  StepStatus,
} from "@/api/workflowTypes";
import type { Ticket } from "@/api/tickets";

export interface NextTask {
  /** Short label for the chip (verb-leading, ≤24 chars ideally). */
  label: string;
  /** Tooltip — fuller context. */
  tooltip: string;
  /** Visual tone — drives chip colour. */
  tone: "urgent" | "attention" | "active" | "todo";
  /** Where the task came from. ``"ticket"`` rows get a slightly
   *  different chip shape so the curator can tell a curator-
   *  authored ticket apart from a pipeline-derived next step. */
  source: "ticket" | "pipeline";
}

/** Map a TicketType to a one-word verb. Falls back to first words
 *  of the title when the type is GENERIC. */
function ticketVerb(t: Ticket): string {
  switch (t.type) {
    case "BATCH_INFO_NEEDED":
      return "Batch info";
    case "REALIGNMENT_NEEDED":
      return "Realign";
    case "QUALITY_REVIEW":
      return "Review";
    case "PRELOAD":
      return "Preload";
    case "GENERIC":
    default: {
      // Strip parenthetical / dashed qualifiers, take first ~3 words.
      const stem = (t.title || "Task").split(/[—–\-(]/u)[0].trim();
      return stem.split(/\s+/).slice(0, 3).join(" ") || "Task";
    }
  }
}

/** Ticket → chip tone. URGENT priority wins; in-progress reads as
 *  active; everything else is todo. */
function ticketTone(t: Ticket): NextTask["tone"] {
  if (t.priority === "URGENT") return "urgent";
  if (t.priority === "HIGH") return "attention";
  if (t.state === "IN_PROGRESS") return "active";
  return "todo";
}

/** Curation steps in canonical order. Earlier = higher priority
 *  ("Design first, review last" is the canonical curation funnel).
 *  Labels are nouns; the verb prefix is added by ``stepVerb`` based
 *  on the step's current status. The ``audit`` step's noun is
 *  picked at runtime — ``proposal`` for review-kind groups,
 *  ``audit`` for pipeline-kind groups, generic ``review`` when the
 *  group type isn't known. */
const CURATION_ORDER: { key: string; label: string }[] = [
  { key: "design", label: "Design" },
  { key: "tags", label: "Tags" },
  { key: "outlier_review", label: "Outliers" },
  { key: "batch_decision", label: "Batch decision" },
  { key: "audit", label: "review" }, // overridden by ``reviewNoun()``
];

const ANALYSIS_ORDER: { key: string; label: string }[] = [
  { key: "missing_value_analysis", label: "MV analysis" },
  { key: "batch_info", label: "Batch info" },
  { key: "preprocessing", label: "Preprocess" },
  { key: "dea", label: "DEA" },
  { key: "diagnostics", label: "Diagnostics" },
];

/** Pick the human label for the curation-review step.
 *
 *  Priority: prefer ``group.task_kind`` when set — it's the
 *  explicit curator-intent classifier set at group-creation time.
 *  Fall back to deriving from
 *  ``group.type`` when absent (older Groups predating the field).
 *  Unknown ``task_kind`` slugs degrade to the generic ``review``
 *  noun rather than rendering the raw slug. */
function reviewNoun(
  groupType: GroupType | undefined,
  taskKind: GroupTaskKind | null | undefined,
): string {
  if (taskKind === "review_proposal") return "proposal";
  if (taskKind === "audit_existing") return "audit";
  if (taskKind === "curate_from_scratch") return "curation";
  if (taskKind === "screening") return "candidate";
  // task_kind absent / unknown → fall back to group.type heuristic.
  if (groupType === "review") return "proposal";
  if (groupType === "pipeline") return "audit";
  return "review";
}

/** Pipeline step → chip tone by status. */
function stepTone(status: StepStatus): NextTask["tone"] {
  switch (status) {
    case "failed":
      return "urgent";
    case "needs_attention":
      return "attention";
    default:
      return "todo";
  }
}

/** Verb prefix that pairs with the step noun. Keeps the chip
 *  reading like an imperative — "Review proposal", "Fix Batch
 *  info" — not the awkward "Look at Set design" the prior pass
 *  produced. Audit / review steps get "Review", everything else
 *  gets the status-appropriate verb. */
function stepVerb(status: StepStatus, label: string, isReviewStep: boolean): string {
  if (isReviewStep) {
    // "Review proposal" / "Review audit" / "Review" — same verb
    // regardless of status, since "Fix proposal" / "Continue
    // audit" read weirdly. The chip's tone colour carries the
    // urgency axis instead.
    return `Review ${label}`;
  }
  switch (status) {
    case "failed":
      return `Fix ${label}`;
    case "needs_attention":
      // "Look at Outliers" read awkwardly; bare noun + tone-color
      // already says "this needs attention." Per design review 2026-05-25.
      return label;
    case "not_run":
    default:
      return label;
  }
}

/** Derive the next task for one experiment row.
 *
 *  ``experimentId`` is matched against ticket targets (numeric id
 *  on ``EXPRESSION_EXPERIMENT`` targets) and used in the tooltip.
 *  ``tickets`` is the curator's ticket list (typically from
 *  ``useMyTickets()``) — passing null skips the ticket lookup. */
export function deriveNextTask(
  experimentId: number,
  status: ExperimentPipelineStatus | undefined,
  tickets: Ticket[] | null | undefined,
  groupType: GroupType | undefined = undefined,
  groupTaskKind: GroupTaskKind | null | undefined = undefined,
): NextTask | null {
  // 1. Assigned ticket wins, if any — BUT only when this
  //     experiment's target on the ticket isn't already DONE. A
  //     DONE target means the curator (or a runner) has resolved
  //     that target's work; surfacing the chip past that point is
  //     misleading ("Preload" badge on already-preloaded rows).
  const ticketHit = (tickets ?? []).find(
    (t) =>
      (t.state === "OPEN" || t.state === "IN_PROGRESS") &&
      t.targets.some(
        (tg) =>
          tg.target_type === "EXPRESSION_EXPERIMENT" &&
          tg.target_id === experimentId &&
          tg.status !== "DONE",
      ),
  );
  if (ticketHit) {
    return {
      label: ticketVerb(ticketHit),
      tooltip: `Ticket: ${ticketHit.title}${ticketHit.priority !== "NORMAL" ? ` (${ticketHit.priority.toLowerCase()})` : ""}`,
      tone: ticketTone(ticketHit),
      source: "ticket",
    };
  }

  // 2. First not-OK pipeline step. Walk curation first, then analysis.
  if (status) {
    for (const { key, label } of CURATION_ORDER) {
      const step = (status.curation as unknown as Record<string, { status: StepStatus } | undefined>)[key];
      if (!step) continue;
      if (step.status === "ok" || step.status === "na") continue;
      const isReviewStep = key === "audit";
      const noun = isReviewStep ? reviewNoun(groupType, groupTaskKind) : label;
      return {
        label: stepVerb(step.status, noun, isReviewStep),
        tooltip: `Curation step: ${isReviewStep ? noun : label} (${step.status})`,
        tone: stepTone(step.status),
        source: "pipeline",
      };
    }
    for (const { key, label } of ANALYSIS_ORDER) {
      const step = (status.analysis as unknown as Record<string, { status: StepStatus } | undefined>)[key];
      if (!step) continue;
      if (step.status === "ok" || step.status === "na") continue;
      return {
        label: stepVerb(step.status, label, false),
        tooltip: `Analysis step: ${label} (${step.status})`,
        tone: stepTone(step.status),
        source: "pipeline",
      };
    }
  }

  return null;
}

/** Human label for the set-header task-kind chip. Sentence-case so
 *  it reads as a heading ("Review Proposals · 15/28 done") rather
 *  than a slug. Unknown kinds render the slug verbatim — keeps
 *  forward-compat with task kinds the agent ships before the UI
 *  knows about them. */
export function taskKindHeaderLabel(
  taskKind: GroupTaskKind | null | undefined,
  groupType: GroupType | undefined,
): string {
  if (taskKind === "review_proposal") return "Review proposals";
  if (taskKind === "audit_existing") return "Audit existing curation";
  if (taskKind === "curate_from_scratch") return "Curate from scratch";
  if (taskKind === "screening") return "Screen candidates";
  if (typeof taskKind === "string" && taskKind.length > 0) {
    // Unknown task_kind slug — render as words ("review_proposal" →
    // "Review proposal") with a sentence-case capitalisation.
    const s = taskKind.replace(/_/g, " ");
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  // No task_kind set — fall back to a group-type-shaped label.
  if (groupType === "review") return "Review";
  if (groupType === "pipeline") return "Pipeline";
  if (groupType === "screening") return "Screening";
  return "Set";
}

/** Tailwind palette per chip tone. Kept here so the consumer
 *  (PipelineStatusRow) doesn't re-hardcode the class strings. */
export function nextTaskToneCls(tone: NextTask["tone"]): string {
  switch (tone) {
    case "urgent":
      return "bg-rose-100 text-rose-800 ring-rose-300 dark:bg-rose-900/40 dark:text-rose-200 dark:ring-rose-700";
    case "attention":
      return "bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:ring-amber-700";
    case "active":
      return "bg-blue-100 text-blue-800 ring-blue-300 dark:bg-blue-900/40 dark:text-blue-200 dark:ring-blue-700";
    case "todo":
    default:
      return "bg-slate-100 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600";
  }
}
