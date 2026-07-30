/**
 * One experiment row in the workflow queue.
 *
 * Compact two-row layout:
 *
 *   ●  GSE271616.1  STAT5B-driven mouse model of hepatosplenic γδ T...    [private] [troubled?] [Q 80%]
 *      ▶ Review proposal   |   a: ✓MV ✓Batch ✓Proc ✓DEA ✓Diag   c: ✓Design ✓Tags ○Outliers ✓Batch ✓Audit
 *
 * - **StatusDisc** mirrors the set-navigator dot (untouched / draft /
 *   uncommitted / done), composed from `audit_status` + the
 *   curator's localStorage draft cache.
 * - **Next-task chip** (left of pipeline strips) surfaces the
 *   immediate work — an assigned ticket wins, otherwise the first
 *   not-OK pipeline step (curation before analysis). Tone-coded:
 *   rose = failed/urgent, amber = needs attention, blue = active,
 *   slate = todo. See ``nextTask.ts``.
 * - **Workflow strips** keep the badge text the reviewer liked but tighter
 *   (compact prop on PipelineTrackStrip).
 * - **Right-side flags** — troubled / needs-attention / public-or-
 *   private / GEEQ pills — surface per-row signals without
 *   competing with the next-task chip for the eye.
 *
 * Clicking the row navigates to the experiment.
 */
import type {
  ExperimentPipelineStatus,
  GroupTaskKind,
  GroupType,
  WorkflowDatasetRow,
} from "@/api/workflowTypes";
import type { Ticket } from "@/api/tickets";
import { experimentRoute, navigate } from "@/routes";
import { cn } from "@/lib/cn";
import { AnalysisTrackStrip, CurationTrackStrip } from "./PipelineTrackStrip";
import { StatusDisc, type StatusDiscTone } from "@/components/ui/StatusDisc";
import { deriveNextTask, nextTaskToneCls } from "./nextTask";

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

/** Compose the row-level StatusDisc tone.
 *
 *  Same semantics as the progress bar (per design review 2026-05-25):
 *  - done       = review closed AND no uncommitted local draft
 *  - uncommitted = curator has touched but not finished —
 *                  local draft is the only client-side signal
 *                  for "started" until the agents side lands has_curator_
 *                  activity on the server
 *  - draft      = unused at the row level for now; the
 *                 "draft" tone is reserved for "started but no
 *                 local edits yet" which we can't detect today
 *  - untouched  = no curator activity, regardless of whether
 *                 the agent has created a proposal row */
function rowDiscTone(
  status: ExperimentPipelineStatus | undefined,
  hasLocalDraft: boolean,
): StatusDiscTone {
  const auditStatus = status?.curation?.audit?.status;
  // Closed + draft = uncommitted leftover work (yellow).
  if (auditStatus === "ok" && !hasLocalDraft) return "done";
  if (hasLocalDraft) return "uncommitted";
  // No local draft, not closed → curator hasn't touched yet.
  return "untouched";
}

function rowDiscTitle(
  status: ExperimentPipelineStatus | undefined,
  hasLocalDraft: boolean,
): string {
  const auditStatus = status?.curation?.audit?.status;
  if (auditStatus === "ok" && !hasLocalDraft) return "review closed";
  if (auditStatus === "ok" && hasLocalDraft) {
    return "review closed but uncommitted local changes remain";
  }
  if (hasLocalDraft) return "uncommitted local changes";
  if (auditStatus === "in_progress") {
    return "proposal exists but not yet touched";
  }
  if (auditStatus === "needs_attention" || auditStatus === "failed") {
    return "review needs attention";
  }
  return "untouched — no review yet";
}

export function PipelineStatusRow({
  dataset,
  status,
  groupContext,
  ticketContext,
  navId,
  hasLocalDraft = false,
  tickets,
  groupType,
  groupTaskKind,
  leadingBadge,
}: {
  dataset: WorkflowDatasetRow;
  status: ExperimentPipelineStatus | undefined;
  groupContext?: string;
  /** Ticket id (as string) threaded through to the experiment URL
   *  as ``?ticket=<id>`` so the experiment page's
   *  ``TicketContextChip`` renders the back-to-ticket + prev/next
   *  navigator. Mirrors ``groupContext`` for sets. */
  ticketContext?: string;
  navId?: string;
  /** Curator-side "uncommitted draft in localStorage" signal —
   *  passed in from the parent so we don't re-scan localStorage
   *  per row. See ``readDirtyExperimentIds`` in
   *  ``features/design/draftCache.ts``. */
  hasLocalDraft?: boolean;
  /** Curator's open / in-progress tickets. Used to derive the
   *  next-task chip when a ticket targets this experiment. */
  tickets?: Ticket[] | null;
  /** The set's group type. Coarse fallback for next-task chip
   *  labeling when ``groupTaskKind`` isn't set. */
  groupType?: GroupType;
  /** The set's fine-grained task classifier, set at group-creation
   *  time. Preferred over ``groupType``
   *  when present — ``review_proposal`` → "Review proposal",
   *  ``audit_existing`` → "Review audit", etc. */
  groupTaskKind?: GroupTaskKind | null;
  /** Optional badge rendered at the FRONT of the row (before the
   *  status disc + accession). Used by the ticket detail page to
   *  surface the ticket task ("Audit") on every target row.
   *  ``tone`` keys into the palette below; pick one that matches the
   *  semantic of the work — ``audit`` (violet), ``pipeline`` (sky),
   *  ``screen`` (fuchsia), ``quality`` (emerald), ``info`` (amber). */
  leadingBadge?: { label: string; tone: BadgeTone };
}) {
  const accession = dataset.short_name || String(dataset.id);
  const title = dataset.name;
  // Has the row been through Gemma's loadGeoData? Use sample count
  // as the proxy: shells imported as bare accessions show 0
  // biomaterials. The analysis + curation chip strips below are
  // suppressed for these rows because every step's default
  // ``ok``/``na`` state reads as "all green" and misleads the
  // curator into thinking a row is fully processed.
  const hasBio = (dataset.number_of_bio_assays ?? 0) > 0;
  const goTo = () =>
    navigate(
      experimentRoute(
        navId ?? String(dataset.id),
        undefined,
        groupContext,
        ticketContext,
      ),
    );

  const discTone = rowDiscTone(status, hasLocalDraft);
  const discTitle = rowDiscTitle(status, hasLocalDraft);
  const nextTask = deriveNextTask(
    dataset.id,
    status,
    tickets,
    groupType,
    groupTaskKind,
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={goTo}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") goTo();
      }}
      className="group px-4 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 transition-colors"
    >
      {/* Header row: disc + leadingBadge + accession + title + flag badges */}
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="self-center">
          <StatusDisc tone={discTone} title={discTitle} />
        </span>
        {leadingBadge ? (
          <LeadingBadge
            label={leadingBadge.label}
            tone={
              // Per-row tone override: when this row is targeted by
              // the active ticket (``ticketContext``) AND that
              // target's status is DONE, flip the badge to
              // ``quality`` (emerald) so curators can see at a
              // glance which rows have finished the ticket's
              // current action. Falls back to the static badge tone
              // otherwise.
              ticketContext &&
              (tickets ?? []).some((t) => {
                if (String(t.id) !== ticketContext) return false;
                return t.targets.some(
                  (tg) =>
                    tg.target_type === "EXPRESSION_EXPERIMENT" &&
                    tg.target_id === dataset.id &&
                    tg.status === "DONE",
                );
              })
                ? "quality"
                : leadingBadge.tone
            }
          />
        ) : null}
        <span className="font-mono text-xs font-semibold text-slate-600 dark:text-slate-300 shrink-0">
          {accession}
        </span>
        <span className="text-sm text-slate-700 dark:text-slate-200 truncate flex-1">
          {title}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {dataset.troubled && (
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 ring-1 ring-inset ring-red-200 dark:ring-red-800"
              title="known data issue with this experiment"
            >
              troubled
            </span>
          )}
          {dataset.needs_attention && (
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 ring-1 ring-inset ring-amber-200 dark:ring-amber-800"
              title="a curator should look at this"
            >
              attention
            </span>
          )}
          {/* Visibility chip — always show, whether public or
              private, so curators can spot the public ones in a
              private-mostly list at a glance. Per design review
              2026-05-25 ("the public/private status should be
              shown as a badge for each experiment"). */}
          {dataset.is_public ? (
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400 ring-1 ring-inset ring-sky-200 dark:ring-sky-800"
              title="public — visible to all Gemma users"
            >
              public
            </span>
          ) : (
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 ring-1 ring-inset ring-slate-200 dark:ring-slate-700"
              title="private — only visible to curators"
            >
              private
            </span>
          )}
          <GeeqPill score={dataset.geeq_public_quality_score} label="Q" />
          <GeeqPill score={dataset.geeq_public_suitability_score} label="S" />
        </span>
      </div>

      {/* Detail row: next-task chip + pipeline strips. The next-task
       *  chip itself is hidden when (a) it's pipeline-derived (e.g.
       *  "Design", "Tags") AND (b) the row has no biomaterials —
       *  those "next step" labels are wrong for shells that haven't
       *  been through Gemma's loadGeoData (no factors / no
       *  biomaterials means "Design" isn't actually pending, it's
       *  just the default not-OK state of an empty design). Ticket-
       *  sourced chips stay visible always (they're explicit
       *  curator work, not derived state). */}
      {status && status.analysis && status.curation ? (
        <div className="flex items-center gap-2 flex-wrap mt-1 pl-5">
          {nextTask && (hasBio || nextTask.source === "ticket") ? (
            <span
              title={nextTask.tooltip}
              className={cn(
                "inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ring-1 ring-inset whitespace-nowrap",
                nextTaskToneCls(nextTask.tone),
              )}
            >
              <span aria-hidden>▶</span>
              {nextTask.label}
              {nextTask.source === "ticket" ? (
                <span className="opacity-70 font-normal">· ticket</span>
              ) : null}
            </span>
          ) : null}
          {nextTask && hasBio ? (
            <span className="text-slate-300 dark:text-slate-700" aria-hidden>
              |
            </span>
          ) : null}
          {hasBio ? (
            <AnalysisTrackStrip track={status.analysis} compact />
          ) : null}
          {hasBio ? (
            <CurationTrackStrip track={status.curation} compact />
          ) : null}
        </div>
      ) : status ? (
        <div className="text-[10px] text-slate-400 dark:text-slate-500 italic pl-5 mt-0.5">
          pipeline status unavailable
        </div>
      ) : (
        <div className="h-6 rounded bg-slate-100 dark:bg-slate-800 animate-pulse mt-1 ml-5" />
      )}

      {/* Curation note if present */}
      {status?.curation_note && (
        <p className="text-[10px] text-slate-500 dark:text-slate-400 italic truncate pl-5 mt-0.5">
          {status.curation_note}
        </p>
      )}
    </div>
  );
}

export type BadgeTone = "audit" | "pipeline" | "screen" | "quality" | "info" | "neutral";

function LeadingBadge({ label, tone }: { label: string; tone: BadgeTone }) {
  const palette: Record<BadgeTone, string> = {
    audit:
      "bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-900/40 dark:text-violet-200 dark:border-violet-700",
    pipeline:
      "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-900/40 dark:text-sky-200 dark:border-sky-700",
    screen:
      "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300 dark:bg-fuchsia-900/40 dark:text-fuchsia-200 dark:border-fuchsia-700",
    quality:
      "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-700",
    info:
      "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700",
    neutral:
      "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600",
  };
  return (
    <span
      className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border shrink-0 ${palette[tone]}`}
    >
      {label}
    </span>
  );
}
