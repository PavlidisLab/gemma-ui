/**
 * @vitest-environment jsdom
 *
 * The ``‹ N/M ›`` walker on the experiment page must count in the order
 * the curator saw the ticket's members listed.
 *
 * The regression this guards: the ticket page lists members through
 * ``ExperimentQueue``, which fetches them under a SERVER sort
 * (``-lastUpdated``); the chip walked ``ticket.targets``, which is
 * roughly insertion order. On ticket #196 those are near-exact
 * reverses, so clicking the second row of an 18-member ticket opened a
 * page reading "18/18".
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  orderTicketTargetsAsListed,
  readTicketMemberOrder,
  rememberTicketMemberOrder,
} from "./ticketMemberOrder";

type T = { target_id: number };
const targets = (...ids: number[]): T[] => ids.map((target_id) => ({ target_id }));
const idsOf = (rows: T[]) => rows.map((t) => t.target_id);

describe("ticketMemberOrder", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("round-trips a recorded order", () => {
    rememberTicketMemberOrder(196, [57838, 978, 879]);
    expect(readTicketMemberOrder(196)).toEqual([57838, 978, 879]);
  });

  it("scopes by ticket — one ticket's order never answers for another", () => {
    rememberTicketMemberOrder(196, [1, 2, 3]);
    expect(readTicketMemberOrder(181)).toBeNull();
  });

  it("re-orders targets into the listed order", () => {
    // Store order (insertion) vs listed order (-lastUpdated): the real
    // ticket #196 shape, reversed with one row hoisted to the top.
    rememberTicketMemberOrder(196, [57838, 978, 879, 657]);
    const stored = targets(657, 879, 978, 57838);
    expect(idsOf(orderTicketTargetsAsListed(196, stored))).toEqual([
      57838, 978, 879, 657,
    ]);
  });

  it("leaves the order alone when nothing was recorded", () => {
    // A curator who arrived from a bookmark never passed through the
    // queue — the old behaviour is the fallback, not an error.
    const stored = targets(657, 879, 978);
    expect(idsOf(orderTicketTargetsAsListed(196, stored))).toEqual([
      657, 879, 978,
    ]);
  });

  it("keeps unlisted targets reachable, after the ones that were listed", () => {
    // Page 2 of the ticket, or members a quick-filter hid. Dropping
    // them would dead-end ‹ › halfway through the ticket.
    rememberTicketMemberOrder(196, [30, 10]);
    const stored = targets(10, 20, 30, 40);
    expect(idsOf(orderTicketTargetsAsListed(196, stored))).toEqual([
      30, 10, 20, 40,
    ]);
  });

  it("does not sort the caller's array in place", () => {
    // The list comes off the react-query cache; mutating it would
    // reorder the ticket for every other reader.
    rememberTicketMemberOrder(196, [3, 2, 1]);
    const stored = targets(1, 2, 3);
    orderTicketTargetsAsListed(196, stored);
    expect(idsOf(stored)).toEqual([1, 2, 3]);
  });

  it("ignores a corrupt stored value rather than throwing", () => {
    sessionStorage.setItem("gca:ticketOrder:196", "{not json");
    expect(readTicketMemberOrder(196)).toBeNull();
    expect(idsOf(orderTicketTargetsAsListed(196, targets(1, 2)))).toEqual([
      1, 2,
    ]);
  });
});
