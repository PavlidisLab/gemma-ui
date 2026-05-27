/**
 * Leave-guard for an EE page with in-flight curator launches.
 *
 * Background: ``useProposeStream`` / ``useAuditStream`` register a
 * job with the module-level in-flight registry while their request
 * is running. If the curator tries to navigate away while a job is
 * still going AND no open ticket already covers this EE, this guard
 * intercepts the navigation and asks them whether to wrap the work
 * in a ticket so it can be tracked from the dashboard.
 *
 * Three choices, mirrored from the conversation that designed this:
 *
 *   - Create ticket & leave — POST /rest/v2/tickets (single-EE
 *     CURATION ticket, UNDERWAY) then proceed to ``pendingTarget``.
 *   - Stay — cancel the navigation, modal closes.
 *   - Leave anyway — proceed without a ticket. The "things fall
 *     through the cracks" escape hatch Paul explicitly accepted
 *     (2026-05-27).
 *
 * Skips the prompt when an open ticket already targets the EE with
 * a non-DONE target — the running job is implicitly attributable to
 * that ticket. Same logic when the registry is empty for the EE.
 *
 * Mount once per EE shell; it un-registers on unmount. Multiple
 * guards stack via ``registerNavigationBlocker`` — the outer one
 * (the EE shell) gets the last word.
 *
 * Dev-side reminder: tickets are owned by gemma-rest (Java) in
 * production. The wire contract here is what survives the swap.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  useCreateTicket,
  useMyTickets,
  type Ticket,
} from "@/api/tickets";
import { registerNavigationBlocker } from "@/routes";
import { getJobsForEE, type InFlightJob } from "@/state/inFlightJobs";

interface PendingNav {
  target: string;
  resolve: (proceed: boolean) => void;
  /** Snapshot of jobs at the moment the navigation was intercepted.
   *  Re-reading the live registry inside the modal would race with
   *  the very streams whose finish should NOT auto-dismiss the
   *  prompt (the curator already chose to leave; respect that). */
  jobs: InFlightJob[];
}

function eeIsOnOpenTicket(
  eeId: number | string,
  tickets: Ticket[] | null | undefined,
): boolean {
  if (!tickets) return false;
  const k = String(eeId);
  return tickets.some(
    (t) =>
      (t.state === "OPEN" || t.state === "IN_PROGRESS") &&
      t.targets.some(
        (tg) =>
          tg.target_type === "EXPRESSION_EXPERIMENT" &&
          String(tg.target_id) === k &&
          tg.status !== "DONE",
      ),
  );
}

export function LeaveJobGuard({
  eeId,
  accession,
}: {
  /** Numeric experiment_id used to scope the registry + the
   *  ticket-coverage check. */
  eeId: number | string;
  /** Short display label ("GSE315959") for the modal copy + the
   *  auto-generated ticket title. Falls back to the numeric eeId
   *  when missing. */
  accession?: string;
}) {
  const [pending, setPending] = useState<PendingNav | null>(null);
  const { data: tickets } = useMyTickets();
  const createTicket = useCreateTicket();
  // ``tickets`` lands asynchronously; keep a ref so the blocker can
  // read the freshest value without re-registering on every refetch.
  const ticketsRef = useRef<Ticket[] | null>(null);
  ticketsRef.current = tickets ?? null;

  useEffect(() => {
    const unregister = registerNavigationBlocker((target) => {
      const jobs = getJobsForEE(eeId);
      if (jobs.length === 0) return true;
      if (eeIsOnOpenTicket(eeId, ticketsRef.current)) return true;
      // Hand control to the modal — return a promise that resolves
      // when the curator picks one of the three buttons.
      return new Promise<boolean>((resolve) => {
        setPending({ target, resolve, jobs });
      });
    });
    return () => {
      unregister();
    };
  }, [eeId]);

  const close = useCallback(
    (proceed: boolean) => {
      pending?.resolve(proceed);
      setPending(null);
    },
    [pending],
  );

  const onCreateAndLeave = useCallback(async () => {
    if (!pending) return;
    const labels = pending.jobs.map((j) => j.label ?? j.kind);
    const title = `Curation: ${accession ?? eeId}`;
    try {
      await createTicket.mutateAsync({
        type: "CURATION",
        title,
        priority: "NORMAL",
        mode: "MANUAL",
        body: `Auto-created on leave with in-flight: ${labels.join(", ")}`,
        targets: [
          {
            target_type: "EXPRESSION_EXPERIMENT",
            target_id: Number(eeId),
            status: "UNDERWAY",
          },
        ],
      });
      close(true);
    } catch (e) {
      // Surface the error inline; don't auto-close so the curator
      // can decide whether to retry / leave anyway / stay.
      console.error("[LeaveJobGuard] create ticket failed", e);
    }
  }, [pending, accession, eeId, createTicket, close]);

  if (!pending) return null;

  const labels = pending.jobs.map((j) => j.label ?? j.kind);
  const oneWord = labels.length === 1 ? labels[0] : `${labels.length} jobs`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 dark:bg-slate-950/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="card max-w-md mx-4 p-5 space-y-4 shadow-xl">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Leave with running work?
        </h2>
        <p className="text-sm text-slate-700 dark:text-slate-300">
          {oneWord} is still running for{" "}
          <span className="font-mono">{accession ?? eeId}</span>. Leave the
          page without a ticket and you'll lose track of when it finishes.
        </p>
        {createTicket.isError ? (
          <p className="text-xs text-rose-700 dark:text-rose-400">
            ticket create failed: {(createTicket.error as Error).message}
          </p>
        ) : null}
        <div className="flex items-center justify-end gap-2 flex-wrap pt-1">
          <button
            type="button"
            onClick={() => close(false)}
            className="btn text-xs"
            disabled={createTicket.isPending}
          >
            Stay
          </button>
          <button
            type="button"
            onClick={() => close(true)}
            className="btn text-xs"
            disabled={createTicket.isPending}
            title="Proceed without a ticket. The job still runs server-side; you just won't see it surfaced on the dashboard."
          >
            Leave anyway
          </button>
          <button
            type="button"
            onClick={onCreateAndLeave}
            className="btn primary text-xs"
            disabled={createTicket.isPending}
          >
            {createTicket.isPending ? "Creating…" : "Create ticket & leave"}
          </button>
        </div>
      </div>
    </div>
  );
}
