/**
 * Where a ticket's work goes when the ticket closes.
 *
 * **Two close flows spawn a follow-up ticket, and they had drifted.**
 * `TicketDetailPage`'s close-confirm spawns PRELOAD → CURATION with
 * every EE target; `TriageView`'s close dialog spawns SCREENING →
 * SCREENING with just the `unsure` rows plus an optional assignee.
 * Same act, two hand-rolled `TicketCreateBody` literals — and they
 * disagreed: the triage one dropped `priority`, so the leftovers of an
 * URGENT screen came back as a NORMAL ticket.
 *
 * So the destination is a resolver (`nextStageFor`) and the payload is
 * one builder (`followUpTicketBody`). What differs between the two
 * flows is genuinely the TARGET SUBSET, which the caller computes
 * because only the caller knows it: the detail page carries every EE,
 * triage carries the rows the curator could not resolve. Everything
 * else — type, title, body wording, inherited priority, MANUAL mode —
 * lives here, so changing where unsure rows land is one branch rather
 * than a hunt through two components.
 *
 * `nextStageFor` is deliberately separate from `nextActionFor` (the
 * RUNNER resolver in `TicketDetailPage`). A SCREENING ticket has a
 * destination but no runner to fire, and folding the two would mean
 * inventing a fake action to hang the destination off.
 */

import type { Ticket, TicketCreateBody, TicketTargetType, TicketType } from "@/api/tickets";

/** The follow-up ticket a close flow can offer to spawn. */
export interface NextStage {
  /** Ticket type the follow-up is created as. */
  type: TicketType;
  title: (current: Ticket) => string;
  /** `carried` is how many targets travel into the follow-up, so the
   *  body can say it — a curator reading the new ticket cold needs to
   *  know it holds a SUBSET and which one. */
  body: (current: Ticket, carried: number) => string;
  /** Text of the button that spawns it. */
  actionLabel: string;
}

/**
 * Resolve where this ticket's remaining work goes on close.
 *
 *  - `PRELOAD` → a `CURATION` ticket: the metadata is in, the curator
 *    now walks the targets and curates them.
 *  - `SCREENING` → another `SCREENING` ticket: rows the curator
 *    reviewed but could not resolve. Naming an assignee at the call
 *    site is what makes it an escalation rather than a re-queue.
 *  - anything else → `null`; the close flow offers close-only.
 */
export function nextStageFor(ticket: Ticket): NextStage | null {
  if (ticket.type === "PRELOAD") {
    return {
      type: "CURATION",
      title: (t) =>
        `Curate: ${t.title.replace(/^Preload\s*[—:-]\s*/i, "").trim() || `ticket #${t.id}`}`,
      body: () =>
        "Auto-spawned from the PRELOAD close flow. Targets carry over " +
        "from the preload ticket and are ready for curator review.",
      actionLabel: "Close & start curation",
    };
  }
  if (ticket.type === "SCREENING") {
    return {
      type: "SCREENING",
      title: (t) => `Unresolved from: ${t.title}`,
      body: (t, carried) =>
        `Carried forward from ticket #${t.id} — ${carried} candidate(s) ` +
        `the curator reviewed but could not resolve. Reasons travel ` +
        `with each row.`,
      actionLabel: "Carry unresolved forward",
    };
  }
  return null;
}

/**
 * Build the `POST /rest/v2/tickets` body for a follow-up.
 *
 * Inherits `priority` from the parent — leftovers of an urgent ticket
 * are still urgent, and the triage flow was silently dropping this.
 * `mode` is always `MANUAL`: a follow-up exists because a human has
 * to look, so it must not auto-chain out from under them.
 */
export function followUpTicketBody(
  stage: NextStage,
  current: Ticket,
  targets: Array<{ target_type: TicketTargetType; target_id: number }>,
  opts: { assignee?: string } = {},
): TicketCreateBody {
  const assignee = opts.assignee?.trim();
  return {
    type: stage.type,
    title: stage.title(current),
    body: stage.body(current, targets.length),
    priority: current.priority,
    mode: "MANUAL",
    ...(assignee ? { assignee } : {}),
    targets: targets.map((t) => ({
      target_type: t.target_type,
      target_id: t.target_id,
      status: "NOT_DONE" as const,
    })),
  };
}
