/**
 * Pure helper for the Finalize → ticket-target-status-flip side effect
 * that runs in ``SidebarHeader.handleClose``. Extracted so we can test
 * the decision in isolation (no react / no react-query / no DOM).
 *
 * Contract: given the route's ticket context + the experiment id this
 * panel was mounted with, return the patch payload to send to
 * ``PATCH /rest/v2/tickets/{ticketId}/targets/EXPRESSION_EXPERIMENT/{target_id}``
 * after finalize succeeds — or ``null`` when no patch should fire.
 *
 * The function is total over all string-shaped inputs we see in the
 * wild:
 *   - ``ticketContext`` undefined / empty / non-numeric → null
 *     (no ticket in the URL, nothing to update)
 *   - ``experimentId`` non-numeric / NaN → null (defensive — we'd
 *     hit this only if the caller mis-routed)
 *
 * 🛑 **This is NOT made redundant by Gemma's commit-advances-the-ticket
 * behaviour** (gemma2 `c25d7cc125`, 2026-08-29), which flips a
 * CURATION/SCREENING ticket's target to DONE when
 * `PUT /datasets/{id}/curation` succeeds. Two reasons, both checked:
 *
 * 1. **The UI never calls that route.** The commit chain client
 *    (`api/curationCommit.ts`) posts to the AGENT's own prefixes —
 *    `/curation-commit/{id}`, `/curation-preflight/{id}`,
 *    `/curation-sign/{id}` — per the agent-writes architecture. And it
 *    has **zero callers**; grep it. So no UI action triggers the
 *    advance today.
 * 2. **Finalizing a review is not committing curation.** A curator can
 *    finish reviewing an experiment on a ticket without a design commit
 *    ever happening, and that is the case this patch exists for.
 *
 * If the two ever do both fire, the double-advance is harmless —
 * Gemma's `updateTargetStatus` is a documented no-op when the target is
 * already at the requested status.
 *
 * History: a 2026-06-11 regression had the ticket-patch block sitting
 * in a sub-component (``SidebarHeader``) that didn't have
 * ``experimentId`` in scope, throwing
 * ``ReferenceError: experimentId is not defined`` and surfacing as
 * ``Couldn't close proposal: experimentId is not defined`` in the
 * close-review toast. The tests below pin that contract — the helper
 * fails LOUDLY in the tests if the inputs are wrong, instead of
 * silently letting a ReferenceError leak to a curator-facing toast.
 */

export interface FinalizeTicketPatch {
  /** Ticket whose target to patch — passed into
   *  ``usePatchTicketTarget(ticketId)``. */
  ticketId: number;
  target_type: "EXPRESSION_EXPERIMENT";
  /** Numeric experiment id (the route accepts numeric strings + bare
   *  numerics; we normalise to numeric here so the caller can pass it
   *  straight into ``mutateAsync``). */
  target_id: number;
  /** Status to flip to. Today always ``"DONE"`` — Finalize is the
   *  only caller. Kept on the payload so the call site reads
   *  declaratively. */
  status: "DONE";
}

export function ticketTargetPatchForFinalize(args: {
  experimentId: number | string;
  ticketContext: string | undefined | null;
}): FinalizeTicketPatch | null {
  const { experimentId, ticketContext } = args;
  if (!ticketContext) return null;
  const ticketId = Number.parseInt(ticketContext, 10);
  if (!Number.isFinite(ticketId) || ticketId <= 0) return null;
  const expIdNum =
    typeof experimentId === "number"
      ? experimentId
      : Number.parseInt(String(experimentId), 10);
  if (!Number.isFinite(expIdNum) || expIdNum <= 0) return null;
  return {
    ticketId,
    target_type: "EXPRESSION_EXPERIMENT",
    target_id: expIdNum,
    status: "DONE",
  };
}
