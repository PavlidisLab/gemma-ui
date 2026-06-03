/**
 * Ticket detail page — the canonical work-item view.
 *
 * URL: ``#/tickets/{ticketId}``
 *
 * Renders the ticket header (title + progress) and reuses the
 * existing ``ExperimentQueue`` to list the ticket's targets in the
 * SAME row shape as the workflow page's experiment list. The only
 * tweak is a leading task-type badge on each row (``Audit`` for an
 * AUDIT ticket, etc.). No parallel apparatus.
 */
import { useState } from "react";

import { AppHeader } from "@/components/ui/AppHeader";
import { navigate } from "@/routes";
import {
  useCreateTicket,
  usePatchTicket,
  useRunTicketAction,
  useTicket,
} from "@/api/tickets";
import type { Ticket, TicketMode, TicketType } from "@/api/tickets";
import { Spinner } from "@gemma/ui";
import { ExperimentQueue } from "@/features/workflow/ExperimentQueue";
import type { BadgeTone } from "@/features/workflow/PipelineStatusRow";
import { TriageView } from "@/features/triage/TriageView";

export function TicketDetailPage({
  ticketId,
  reviewer,
}: {
  ticketId: number;
  reviewer: string;
}) {
  // Poll the ticket while any target is UNDERWAY — that's the
  // signal that an async action (today: PRELOAD runner) is still
  // moving rows. Stops polling as soon as no targets are UNDERWAY
  // any more (React Query treats ``false`` as "don't reschedule").
  const { data: ticket, isLoading, error } = useTicket(ticketId, {
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const anyUnderway = data.targets.some((t) => t.status === "UNDERWAY");
      return anyUnderway ? 2000 : false;
    },
  });
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <AppHeader reviewer={reviewer} />
      <main className="mx-auto w-full max-w-[1400px] px-4 py-6 flex-1 space-y-6">
        <nav className="text-xs text-slate-500 dark:text-slate-400 flex items-baseline gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => navigate("#/")}
            className="hover:underline"
          >
            Dashboard
          </button>
          <span aria-hidden>/</span>
          <span>Tickets</span>
          <span aria-hidden>/</span>
          <span className="font-mono text-slate-700 dark:text-slate-300">
            #{ticketId}
          </span>
        </nav>
        {isLoading ? (
          <div className="card p-6 text-sm text-slate-500 italic">
            loading ticket…
          </div>
        ) : error || !ticket ? (
          <div className="card p-6 text-sm text-rose-700 dark:text-rose-400">
            Ticket {ticketId} not found.
          </div>
        ) : (
          <TicketDetailBody ticket={ticket} ticketId={ticketId} />
        )}
      </main>
    </div>
  );
}

const TASK_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  AUDIT: { label: "Audit", tone: "audit" },
  PIPELINE_RUN: { label: "Pipeline", tone: "pipeline" },
  SCREENING: { label: "Screen", tone: "screen" },
  QUALITY_REVIEW: { label: "Quality", tone: "quality" },
  BATCH_INFO_NEEDED: { label: "Batch info", tone: "info" },
  REALIGNMENT_NEEDED: { label: "Realign", tone: "pipeline" },
  PRELOAD: { label: "Preload", tone: "info" },
  GENERIC: { label: "Task", tone: "neutral" },
  WORKFLOW: { label: "Task", tone: "neutral" },
};

function TicketDetailBody({
  ticket,
  ticketId,
}: {
  ticket: Ticket;
  ticketId: number;
}) {
  const n = ticket.targets.length;
  const nDone = ticket.targets.filter((t) => t.status === "DONE").length;
  const nUnderway = ticket.targets.filter(
    (t) => t.status === "UNDERWAY",
  ).length;
  const nNotDone = n - nDone - nUnderway;
  const pctDone = n === 0 ? 0 : Math.round((nDone / n) * 100);
  const pctUnderway = n === 0 ? 0 : Math.round((nUnderway / n) * 100);
  const expIds = ticket.targets
    .filter((t) => t.target_type === "EXPRESSION_EXPERIMENT")
    .map((t) => t.target_id);
  const taskBadge = TASK_BADGE[ticket.type] ?? { label: "Task", tone: "neutral" };
  // SCREENING tickets are GEO-accession triage — different body
  // surface (TriageView), no NextActionBar (triage's own Finalize
  // button drives the next stage via run_triage_followup.py).
  const isTriage = ticket.type === "SCREENING";
  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-baseline gap-2 flex-wrap text-xs text-slate-500 dark:text-slate-400">
          <span className="px-1.5 py-0.5 rounded font-mono text-[11px] bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
            Ticket #{ticketId}
          </span>
          <span className="uppercase tracking-wide font-semibold">
            {ticket.type}
          </span>
          <span>·</span>
          <span className="uppercase tracking-wide font-semibold">
            {ticket.state}
          </span>
          <span>·</span>
          <span>{ticket.priority}</span>
          {ticket.due_date ? (
            <>
              <span>·</span>
              <span>due {ticket.due_date}</span>
            </>
          ) : null}
        </div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
          {ticket.title}
        </h1>
        {ticket.body ? (
          <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-line max-w-3xl">
            {ticket.body}
          </p>
        ) : null}
        <div
          className="h-2 w-full max-w-md rounded bg-slate-200 dark:bg-slate-700 overflow-hidden flex"
          title={`${pctDone}% done · ${pctUnderway}% underway`}
        >
          <div
            className="bg-emerald-500 dark:bg-emerald-400 h-full"
            style={{ width: `${pctDone}%` }}
          />
          <div
            className="bg-amber-400 dark:bg-amber-300 h-full"
            style={{ width: `${pctUnderway}%` }}
          />
        </div>
        <div className="flex items-baseline gap-3 text-xs text-slate-600 dark:text-slate-300">
          <span className="font-medium">
            {nDone}/{n} done
          </span>
          {nUnderway > 0 ? <span>· {nUnderway} underway</span> : null}
          {nNotDone > 0 ? <span>· {nNotDone} not started</span> : null}
        </div>
        <div className="flex items-center gap-3 flex-wrap text-xs text-slate-500 dark:text-slate-400">
          {ticket.assignee_name ? (
            <span>assigned to {ticket.assignee_name}</span>
          ) : null}
          <ModeToggle ticketId={ticketId} mode={ticket.mode} />
        </div>
        {isTriage ? null : (
          <NextActionBar
            ticketId={ticketId}
            ticket={ticket}
            anyUnderway={nUnderway > 0}
            anyNotDone={nNotDone > 0}
          />
        )}
      </header>

      <section>
        {isTriage ? (
          <TriageView ticket={ticket} />
        ) : (
          <ExperimentQueue
            experimentIds={expIds}
            leadingBadge={taskBadge}
            ticketId={ticketId}
          />
        )}
      </section>
    </article>
  );
}

/** Manual ↔ Auto mode toggle. Patches ``ticket.mode`` server-side
 *  via ``PATCH /rest/v2/tickets/{id}``.
 *
 *  - MANUAL (default): each next action waits for a curator click.
 *  - AUTO: when a runner completes (all targets DONE, no failures),
 *    the server auto-schedules the next defined action. Today only
 *    ``preload → propose`` is wired; AUTO is a no-op past preload
 *    until the propose runner lands. */
function ModeToggle({
  ticketId,
  mode,
}: {
  ticketId: number;
  mode: TicketMode;
}) {
  const patch = usePatchTicket(ticketId);
  const next: TicketMode = mode === "MANUAL" ? "AUTO" : "MANUAL";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wide font-semibold">
        Mode
      </span>
      <button
        type="button"
        onClick={() => patch.mutate({ mode: next })}
        disabled={patch.isPending}
        title={
          mode === "MANUAL"
            ? "Manual — you click the next action button each stage. Click to flip to Auto."
            : "Auto — the server schedules the next action when the current one finishes. Click to flip to Manual."
        }
        className={
          mode === "AUTO"
            ? "px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-wide font-semibold border-emerald-400 bg-emerald-100 text-emerald-900 hover:bg-emerald-200 dark:border-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-100 cursor-pointer"
            : "px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-wide font-semibold border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
        }
      >
        {mode === "AUTO" ? "Auto" : "Manual"}
      </button>
      {patch.isError ? (
        <span
          className="text-[10px] text-rose-700"
          title={(patch.error as Error).message}
        >
          patch failed
        </span>
      ) : null}
    </span>
  );
}

/** Definition of an action the curator can fire on a ticket via the
 *  generic ``POST /rest/v2/tickets/{id}/actions`` endpoint. The
 *  action ``id`` is what the server dispatches on; ``readyLabel`` is
 *  the button text, ``busyLabel`` is what it reads while the runner
 *  is in flight, and ``doneNote`` is the small line the bar shows
 *  when every target reached DONE for that action's outputs.
 *
 *  Today only ``preload`` has a runner; ``propose`` is stubbed for
 *  the layout but the button stays disabled until the runner lands. */
interface NextAction {
  id: string;
  readyLabel: string;
  busyLabel: string;
  schedulingLabel: string;
  readyTitle: string;
  busyTitle: string;
  doneNote: string;
  /** When ``true`` the picker shows the action greyed-out with a
   *  "runner not built yet" tooltip — useful for the AUTO-mode
   *  preview of the next stage. */
  unavailable?: boolean;
  /** Optional follow-up ticket the close-confirm dialog offers to
   *  spawn. PRELOAD → CURATION is the canonical case: the preload
   *  finished, the curator now needs to walk the targets and
   *  curate them. The new ticket inherits the same EE targets in
   *  ``NOT_DONE`` state so the curator can pick up where preload
   *  left off. Future stages slot in via the resolver. */
  nextStage?: {
    type: TicketType;
    title: (current: Ticket) => string;
    body: string;
    actionLabel: string;
  };
}

/** Resolve the next action the curator can fire on this ticket.
 *
 *  Today's mapping:
 *   - ``PRELOAD`` → fire ``preload``; once all targets are DONE the
 *     bar flips to the "close ticket" state.
 *   - other ticket types → no action available; the bar hides.
 *
 *  When a real second runner (``propose``, …) lands, add a branch
 *  here. Keep the resolver pure + local so the dispatch + the
 *  display stay aligned. */
function nextActionFor(ticket: Ticket): NextAction | null {
  if (ticket.type === "PRELOAD") {
    return {
      id: "preload",
      readyLabel: "Load from GEO",
      busyLabel: "preloading…",
      schedulingLabel: "scheduling…",
      readyTitle: "Fetch GEO metadata for every target in this ticket",
      busyTitle: "A preload run is in progress — watch the progress bar above.",
      doneNote: "All targets preloaded. Ready for curator screening.",
      nextStage: {
        type: "CURATION",
        title: (t) =>
          `Curate: ${t.title.replace(/^Preload\s*[—:-]\s*/i, "").trim() || `ticket #${t.id}`}`,
        body:
          "Auto-spawned from the PRELOAD close flow. Targets carry over " +
          "from the preload ticket and are ready for curator review.",
        actionLabel: "Close & start curation",
      },
    };
  }
  return null;
}

/** Generic next-action picker for the ticket detail header. Reads
 *  the ticket type + completion state to decide which action button
 *  to render. Replaces the previous ``PreloadActionBar`` — the
 *  PRELOAD wiring lives in ``nextActionFor``, and the picker stays
 *  ticket-type-agnostic so adding a second action is one resolver
 *  branch and zero UI change.
 *
 *  Three states:
 *   - ``anyNotDone`` (a target hasn't started) — show the action
 *     button. Disabled while a run is in flight.
 *   - ``anyUnderway`` (runner is mid-flight) — busy state on the
 *     same button.
 *   - all DONE — flip to the "close ticket" state with a one-line
 *     summary of what completed.
 *
 *  AUTO mode: in AUTO mode the server auto-chains subsequent actions
 *  once the current one completes; the FIRST action still needs the
 *  curator's click. The button label is unchanged; tooltip hints at
 *  the auto-advance. */
function NextActionBar({
  ticketId,
  ticket,
  anyUnderway,
  anyNotDone,
}: {
  ticketId: number;
  ticket: Ticket;
  anyUnderway: boolean;
  anyNotDone: boolean;
}) {
  const run = useRunTicketAction(ticketId);
  const patch = usePatchTicket(ticketId);
  const create = useCreateTicket();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const action = nextActionFor(ticket);
  // No action defined for this ticket type — nothing to render. The
  // header still shows targets + progress; the curator drives work
  // from the row-level pipeline chips.
  if (action == null) return null;

  // "All done" state: action complete; offer close. The done-note
  // text comes from the action def so the wording matches what
  // happened (preload → "ready for curator screening", future
  // propose → "proposals queued for review", etc.).
  if (!anyNotDone && !anyUnderway) {
    return (
      <>
        <div className="flex items-center gap-3 flex-wrap pt-2">
          <div className="text-xs text-emerald-700 dark:text-emerald-400">
            {action.doneNote}
          </div>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={patch.isPending || create.isPending}
            className="btn text-xs"
            title="Resolve this ticket. The targets stay in the system; only the ticket closes."
          >
            {patch.isPending || create.isPending
              ? "closing…"
              : "Close ticket"}
          </button>
          {patch.isError ? (
            <span
              className="text-xs text-rose-700"
              title={(patch.error as Error).message}
            >
              close failed: {(patch.error as Error).message}
            </span>
          ) : null}
          {create.isError ? (
            <span
              className="text-xs text-rose-700"
              title={(create.error as Error).message}
            >
              next-stage failed: {(create.error as Error).message}
            </span>
          ) : null}
        </div>
        <CloseTicketConfirm
          open={confirmOpen}
          ticket={ticket}
          action={action}
          busy={patch.isPending || create.isPending}
          onCancel={() => setConfirmOpen(false)}
          onCloseOnly={async () => {
            try {
              await patch.mutateAsync({ state: "RESOLVED" });
              setConfirmOpen(false);
              navigate("#/");
            } catch {
              // Error surfaces via patch.isError; leave modal open.
            }
          }}
          onCloseAndNext={async () => {
            if (!action.nextStage) return;
            try {
              const newTicket = await create.mutateAsync({
                type: action.nextStage.type,
                title: action.nextStage.title(ticket),
                body: action.nextStage.body,
                priority: ticket.priority,
                mode: "MANUAL",
                targets: ticket.targets
                  .filter(
                    (t) => t.target_type === "EXPRESSION_EXPERIMENT",
                  )
                  .map((t) => ({
                    target_type: t.target_type,
                    target_id: t.target_id,
                    status: "NOT_DONE" as const,
                  })),
              });
              await patch.mutateAsync({ state: "RESOLVED" });
              setConfirmOpen(false);
              navigate(`#/tickets/${newTicket.id}`);
            } catch {
              // Error chips render above; leave modal open so the
              // curator can retry / cancel.
            }
          }}
        />
      </>
    );
  }

  const busy = run.isPending || anyUnderway;
  const autoHint =
    ticket.mode === "AUTO"
      ? " (Auto — subsequent actions chain automatically.)"
      : "";
  return (
    <div className="flex items-center gap-2 pt-2">
      <button
        type="button"
        onClick={() => run.mutate(action.id)}
        disabled={busy || action.unavailable}
        className="btn primary text-xs"
        title={
          action.unavailable
            ? "Runner not built yet."
            : (anyUnderway ? action.busyTitle : action.readyTitle) + autoHint
        }
      >
        {busy ? <Spinner /> : null}
        <span>
          {anyUnderway
            ? action.busyLabel
            : run.isPending
              ? action.schedulingLabel
              : action.readyLabel}
        </span>
      </button>
      {run.isError ? (
        <span
          className="text-xs text-rose-700"
          title={(run.error as Error).message}
        >
          run failed: {(run.error as Error).message}
        </span>
      ) : null}
    </div>
  );
}

/** Close-ticket confirmation. Three buttons:
 *
 *   - **Cancel** — dismiss, no state change.
 *   - **Close only** — PATCH state=RESOLVED, navigate to dashboard.
 *   - **Close & start next** — POST a follow-up ticket (carrying
 *     the same EE targets), then PATCH the current to RESOLVED,
 *     then navigate to the new ticket. Only rendered when the
 *     resolver supplies a ``nextStage``.
 *
 *  Inline modal (not the shared ``ConfirmModal``) because that helper
 *  only models two-button destroy/cancel. The semantics here are
 *  closer to a wizard step than a destructive confirm. */
function CloseTicketConfirm({
  open,
  ticket,
  action,
  busy,
  onCancel,
  onCloseOnly,
  onCloseAndNext,
}: {
  open: boolean;
  ticket: Ticket;
  action: NextAction;
  busy: boolean;
  onCancel: () => void;
  onCloseOnly: () => void;
  onCloseAndNext: () => void;
}) {
  if (!open) return null;
  const hasNext = !!action.nextStage;
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 dark:bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={busy ? undefined : onCancel}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-ticket-title"
        className="card max-w-md w-full shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <h2
            id="close-ticket-title"
            className="text-sm font-semibold text-slate-900 dark:text-slate-100"
          >
            Close ticket #{ticket.id}?
          </h2>
        </div>
        <div className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300 space-y-2">
          <p>{action.doneNote}</p>
          {hasNext ? (
            <p className="text-slate-600 dark:text-slate-400">
              The same {ticket.targets.length} target
              {ticket.targets.length === 1 ? "" : "s"} can carry over
              into a follow-up <span className="font-semibold">curation</span>{" "}
              ticket so the work stays on your dashboard. Or close
              without one and these targets drop off the queue.
            </p>
          ) : null}
        </div>
        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2 flex-wrap">
          <button
            type="button"
            className="btn ghost text-xs"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn text-xs"
            onClick={onCloseOnly}
            disabled={busy}
            title="Resolve this ticket and return to the dashboard. No follow-up created."
          >
            Close only
          </button>
          {hasNext ? (
            <button
              type="button"
              className="btn primary text-xs"
              onClick={onCloseAndNext}
              disabled={busy}
              title="Resolve this ticket and open a follow-up curation ticket carrying the same targets."
            >
              {busy ? "Working…" : action.nextStage!.actionLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
