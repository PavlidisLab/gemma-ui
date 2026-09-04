/**
 * The dashboard's two ordering-and-scoping rules, pinned as pure
 * functions because both of them are easy to get subtly wrong in a way
 * no render test would notice.
 *
 * 🛑 `ticketIsMine` answers by ID or not at all, and the "not at all"
 * case is the one that matters: on a host where the session's contact id
 * can't be established it must answer `false` for EVERYTHING, so the
 * caller disables the filter instead of showing a curator an empty queue
 * and letting them read it as "I have no tickets".
 *
 * 🛑 `hoistPinned` runs BEFORE `pinScratchpadFirst`, so the scratchpad
 * ends up above the pins — Paul, 2026-09-03: pinned tickets stay at the
 * top "(after the scratchpad)". The composition is what the test checks,
 * because either function alone looks right.
 */
import { describe, expect, it } from "vitest";

import { hoistPinned, pinScratchpadFirst, ticketIsMine } from "./tickets";
import type { Ticket } from "./tickets";

/** Only the fields these two functions read. */
function t(
  id: number,
  extra: Partial<Pick<Ticket, "type" | "assignee_id" | "reporter_id">> = {},
): Ticket {
  return {
    id,
    type: "GENERIC",
    assignee_id: null,
    reporter_id: null,
    ...extra,
  } as Ticket;
}

const ids = (rows: Ticket[]) => rows.map((r) => r.id);

describe("ticketIsMine", () => {
  const ME = 52731;

  it("claims a ticket assigned to me", () => {
    expect(ticketIsMine({ assignee_id: ME, reporter_id: 99 }, ME)).toBe(true);
  });

  it("does not claim one assigned to somebody else, even if I filed it", () => {
    expect(ticketIsMine({ assignee_id: 99, reporter_id: ME }, ME)).toBe(false);
  });

  it("claims an unassigned ticket I filed", () => {
    expect(ticketIsMine({ assignee_id: null, reporter_id: ME }, ME)).toBe(true);
  });

  it("does not claim an unassigned ticket somebody else filed", () => {
    expect(ticketIsMine({ assignee_id: null, reporter_id: 99 }, ME)).toBe(
      false,
    );
  });

  // The whole reason the caller has a `canFilterByOwner` gate.
  it("claims NOTHING when my id could not be established", () => {
    for (const myId of [null, undefined]) {
      expect(
        ticketIsMine({ assignee_id: myId ?? 1, reporter_id: ME }, myId),
      ).toBe(false);
      expect(ticketIsMine({ assignee_id: null, reporter_id: ME }, myId)).toBe(
        false,
      );
    }
  });

  it("does not claim a ticket whose reporter the wire left null", () => {
    expect(ticketIsMine({ assignee_id: null, reporter_id: null }, ME)).toBe(
      false,
    );
  });
});

describe("hoistPinned", () => {
  it("moves pinned tickets to the front", () => {
    const rows = [t(1), t(2), t(3), t(4)];
    expect(ids(hoistPinned(rows, new Set([3])))).toEqual([3, 1, 2, 4]);
  });

  it("keeps the sort's relative order inside each group", () => {
    const rows = [t(1), t(2), t(3), t(4)];
    expect(ids(hoistPinned(rows, new Set([4, 2])))).toEqual([2, 4, 1, 3]);
  });

  it("is a no-op with no pins, and ignores pins for tickets not shown", () => {
    const rows = [t(1), t(2)];
    expect(hoistPinned(rows, new Set())).toBe(rows);
    expect(hoistPinned(rows, new Set([99]))).toBe(rows);
  });
});

describe("hoistPinned composed with pinScratchpadFirst", () => {
  it("puts the scratchpad above the pins", () => {
    const rows = [t(1), t(2), t(3, { type: "SCRATCHPAD" }), t(4)];
    const out = pinScratchpadFirst(hoistPinned(rows, new Set([4])), null);
    expect(ids(out)).toEqual([3, 4, 1, 2]);
  });

  it("does not double a scratchpad that is also pinned", () => {
    const rows = [t(1), t(2, { type: "SCRATCHPAD" })];
    const out = pinScratchpadFirst(hoistPinned(rows, new Set([2])), null);
    expect(ids(out)).toEqual([2, 1]);
  });
});
