/**
 * The queue reads Gemma's tickets in remote mode — and Gemma's list is
 * paginated, so it arrives wrapped where the store's arrives bare.
 *
 * Both shapes are pinned verbatim off the wire (2026-08-29): the store
 * at `/curation/v1/tickets` returns `Ticket[]`; gemma2 at
 * `/rest/v2/tickets` returns `{data, totalElements, offset, limit,
 * sort, groupBy}`, which `unwrapGemmaEnvelope` leaves wrapped on
 * purpose because a paginated view needs the siblings.
 */
import { describe, expect, it } from "vitest";

import { asTicketList } from "./tickets";

describe("asTicketList", () => {
  it("takes the store's bare array", () => {
    expect(asTicketList([{ id: 206 }, { id: 207 }])).toHaveLength(2);
  });

  it("🛑 unwraps Gemma's paginated envelope", () => {
    // The exact shape off gemma2 — ticket 5 is the GSE1829 retired-series
    // one that was invisible in this queue until tonight.
    const wire = {
      data: [{ id: 5, title: "GSE1829 (eid 861): GEO retired the series" }],
      totalElements: 5,
      offset: 0,
      limit: 20,
      sort: null,
      groupBy: null,
    };
    expect(asTicketList(wire)).toHaveLength(1);
    expect(asTicketList(wire)[0].id).toBe(5);
  });

  it("never throws on a shape it does not know", () => {
    // A wrong-backend answer is an empty queue, not a crashed page.
    expect(asTicketList(null)).toEqual([]);
    expect(asTicketList({ data: null })).toEqual([]);
    expect(asTicketList("nope")).toEqual([]);
  });
});
