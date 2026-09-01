/**
 * The scratchpad is pinned first on the curator's dashboard.
 *
 * gembro makes it findable; the ordering is ours (Paul, 2026-08-31).
 * It is applied AFTER the curator's chosen sort rather than folded into
 * the comparator — sorting by priority must still put the scratchpad
 * first, because the pin is a property of the dashboard, not of the
 * sort.
 *
 * A scratchpad is a ticket kept open indefinitely where finishing means
 * removing the dataset, so it is never "done" and never leaves the top.
 */
import { describe, expect, it } from "vitest";

import { pinScratchpadFirst, type Ticket, type TicketType } from "./tickets";

function ticket(id: number, type: TicketType = "CURATION"): Ticket {
  return {
    id,
    title: `ticket ${id}`,
    type,
    state: "OPEN",
    priority: "NORMAL",
    due_date: null,
    reporter_id: null,
    reporter_name: null,
    assignee_id: null,
    assignee_name: null,
    created_at: "2026-08-31T00:00:00Z",
    updated_at: "2026-08-31T00:00:00Z",
    external_issue_url: null,
    targets: [],
  } as unknown as Ticket;
}

describe("pinScratchpadFirst", () => {
  it("hoists the fetched scratchpad above everything else", () => {
    const out = pinScratchpadFirst([ticket(1), ticket(2)], ticket(9, "SCRATCHPAD"));
    expect(out.map((t) => t.id)).toEqual([9, 1, 2]);
  });

  it("🛑 does not duplicate one that is already in the list", () => {
    // The scratchpad is assigned to the curator, so `useMyTickets`
    // returns it too. Hoisting must move it, not clone it.
    const sp = ticket(9, "SCRATCHPAD");
    const out = pinScratchpadFirst([ticket(1), sp, ticket(2)], sp);
    expect(out.map((t) => t.id)).toEqual([9, 1, 2]);
  });

  it("pins by TYPE even when the route returned nothing", () => {
    // `GET /tickets/scratchpad` is not deployed yet. A scratchpad that
    // arrives through the ordinary list must still pin, which is what
    // makes this work before the route lands.
    const out = pinScratchpadFirst([ticket(1), ticket(9, "SCRATCHPAD")], null);
    expect(out.map((t) => t.id)).toEqual([9, 1]);
  });

  it("preserves the caller's order below the pin", () => {
    // The curator's chosen sort is already applied; this must not
    // reshuffle it.
    const out = pinScratchpadFirst(
      [ticket(3), ticket(1), ticket(2)],
      ticket(9, "SCRATCHPAD"),
    );
    expect(out.map((t) => t.id)).toEqual([9, 3, 1, 2]);
  });

  it("returns the list untouched when there is no scratchpad", () => {
    const list = [ticket(1), ticket(2)];
    expect(pinScratchpadFirst(list, null)).toBe(list);
    expect(pinScratchpadFirst(list, undefined)).toBe(list);
  });

  it("an empty dashboard plus a scratchpad is just the scratchpad", () => {
    // A brand-new curator: the route provisions one on first access and
    // it is the only thing they have.
    expect(
      pinScratchpadFirst([], ticket(9, "SCRATCHPAD")).map((t) => t.id),
    ).toEqual([9]);
  });

  it("pins more than one, in list order, if a curator somehow has two", () => {
    const out = pinScratchpadFirst(
      [ticket(1), ticket(8, "SCRATCHPAD"), ticket(9, "SCRATCHPAD")],
      null,
    );
    expect(out.map((t) => t.id)).toEqual([8, 9, 1]);
  });
});
