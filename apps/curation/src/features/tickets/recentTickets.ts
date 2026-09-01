/**
 * localStorage MRU backing "recent tickets" in the banner's ticket
 * menu. Same shape as `design/recentTerms.ts`, for the same reason:
 * global rather than experiment-scoped, because a curator moving
 * between experiments wants the list to follow them and there is no
 * natural reset event.
 *
 * 🛑 **Ids only. The title is NOT stored.** Paul asked that recent
 * tickets stick in the menu; a stored title goes stale the moment
 * someone renames or closes a ticket, and a menu confidently offering
 * something that no longer exists is worse than an empty menu. The ids
 * are resolved against the server each time the menu opens and anything
 * that no longer comes back is dropped — the same validate-on-read rule
 * the draft storage follows.
 *
 * 🛑 **Deliberately not an endpoint.** "Recent" means this curator, on
 * this machine, just now. The server does not know that and should not
 * have to store it. If it ever needs to follow someone between
 * machines, that is `GET /tickets/mine` plus `updatedSince`, not a new
 * concept. (Spec §5,
 * `handoffs/UIB_TO_GEMBRO_2026_08_31_TICKET_MANAGEMENT_ENDPOINT_SPEC.md`.)
 */

const KEY = "gca:recent-tickets:v1";

/** Long enough to hold a scratchpad plus the tickets in flight, short
 *  enough that the menu stays scannable without a scrollbar. A
 *  scratchpad is by definition the ticket just used, so it sits at the
 *  top of this list and never needs the search box. */
const MAX = 6;

export function getRecentTicketIds(): number[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<number>();
    const out: number[] = [];
    for (const v of parsed) {
      // Written as numbers, but a hand-edited or older entry could be
      // anything. A non-finite id would be requested as
      // `/tickets/NaN`, so it is dropped rather than passed on.
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue;
      seen.add(n);
      out.push(n);
      if (out.length >= MAX) break;
    }
    return out;
  } catch {
    // A private window, cleared site data, or storage disabled. The
    // menu simply has no recents — never an error.
    return [];
  }
}

/** Record a visit. Re-visiting moves the ticket to the front rather
 *  than duplicating it, so the list stays ordered by recency. */
export function pushRecentTicketId(id: number | string): number[] {
  const n = typeof id === "number" ? id : Number(id);
  if (!Number.isFinite(n) || n <= 0) return getRecentTicketIds();
  try {
    const next = [n, ...getRecentTicketIds().filter((x) => x !== n)].slice(
      0,
      MAX,
    );
    window.localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  } catch {
    return getRecentTicketIds();
  }
}

/** Drop one id — for a ticket the server no longer resolves.
 *
 *  Called on a failed resolution rather than on a delete the UI
 *  performs, because the common way an entry goes bad is someone else
 *  closing or deleting the ticket. */
export function forgetRecentTicketId(id: number): number[] {
  try {
    const next = getRecentTicketIds().filter((x) => x !== id);
    window.localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  } catch {
    return getRecentTicketIds();
  }
}

/** The recents worth showing: ids that still resolve, minus any the
 *  caller is already listing elsewhere.
 *
 *  🛑 `resolved` is what the SERVER returned. An id missing from it has
 *  been closed, deleted, or is not visible to this curator, and all
 *  three mean the same thing to the menu: do not offer it. Passing an
 *  empty `resolved` therefore yields nothing — "we could not resolve
 *  any" must not read as "show them all". */
export function visibleRecentTickets<T extends { id: number }>(
  ids: number[],
  resolved: T[],
  excludeIds: Iterable<number> = [],
): T[] {
  const byId = new Map(resolved.map((t) => [t.id, t]));
  const exclude = new Set(excludeIds);
  const out: T[] = [];
  for (const id of ids) {
    if (exclude.has(id)) continue;
    const t = byId.get(id);
    if (t) out.push(t);
  }
  return out;
}
