/**
 * The order a ticket's members were LISTED in, handed from the queue
 * that listed them to the ``‹ N/M ›`` walker on the experiment page.
 *
 * Why this exists: the two surfaces were reading different orders. The
 * ticket page lists members through ``ExperimentQueue``, which fetches
 * ``/rest/v2/datasets?ids=…&sort=-lastUpdated`` — a SERVER ordering,
 * most-recently-updated first, and re-sortable by the curator. The
 * chip's prev/next walked ``ticket.targets`` in whatever order the
 * store returned them, which is roughly insertion order. On ticket
 * #196 those two are near-exact reverses of each other: clicking the
 * second row of an 18-member ticket opened the experiment page reading
 * "18/18", and ‹ walked backwards through the list the curator had
 * just been looking at (Paul, 2026-08-20 — "seems to start at 15/15
 * rather than 1/15").
 *
 * So the queue records what it showed, and the chip walks that. The
 * counter then means what a curator reads it to mean: position in the
 * list they clicked from.
 *
 * **sessionStorage, deliberately.** This is a per-tab handoff between
 * two views of one navigation, not a preference — it should not
 * outlive the tab, and it must not follow the curator into a second
 * window listing the same ticket under a different sort. Same reason
 * ``useSessionState`` exists for the samples-table column order.
 *
 * Absent / stale entries are normal, not errors: a curator who lands
 * on an experiment from a bookmark or the dashboard never passed
 * through the queue. Every reader falls back to the ticket's own
 * target order.
 */

const KEY_PREFIX = "gca:ticketOrder:";

function keyFor(ticketId: number): string {
  return `${KEY_PREFIX}${ticketId}`;
}

/**
 * Record the experiment ids a ticket's members were listed in, in
 * display order. Call with the rows actually on screen — filtered and
 * paged as the curator sees them.
 */
export function rememberTicketMemberOrder(
  ticketId: number,
  orderedIds: number[],
): void {
  try {
    const next = JSON.stringify(orderedIds);
    // Re-listing the same page on every render / refetch would
    // otherwise write on every pass.
    if (sessionStorage.getItem(keyFor(ticketId)) === next) return;
    sessionStorage.setItem(keyFor(ticketId), next);
  } catch {
    // sessionStorage disabled / full — the walker falls back to the
    // ticket's own order, which is what it did before this existed.
  }
}

/** The stored order, or null when nothing was recorded for this ticket. */
export function readTicketMemberOrder(ticketId: number): number[] | null {
  try {
    const raw = sessionStorage.getItem(keyFor(ticketId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const ids = parsed.filter((n): n is number => typeof n === "number");
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
}

/**
 * Re-order a ticket's targets to match the list the curator saw.
 *
 * Targets the stored order doesn't mention — members on another page,
 * or ones a quick-filter hid — keep their original relative order and
 * follow at the end. They stay REACHABLE by ‹ ›, which matters more
 * than their exact position: a walker that could only reach the
 * current page would dead-end the curator halfway through a ticket.
 *
 * Returns a new array; the caller's list (and the query cache behind
 * it) is never sorted in place.
 */
export function orderTicketTargetsAsListed<T extends { target_id: number }>(
  ticketId: number,
  targets: T[],
): T[] {
  const order = readTicketMemberOrder(ticketId);
  if (!order) return targets;
  const rank = new Map<number, number>();
  order.forEach((id, i) => {
    if (!rank.has(id)) rank.set(id, i);
  });
  const listed: T[] = [];
  const rest: T[] = [];
  for (const t of targets) {
    if (rank.has(t.target_id)) listed.push(t);
    else rest.push(t);
  }
  listed.sort((a, b) => rank.get(a.target_id)! - rank.get(b.target_id)!);
  return [...listed, ...rest];
}
