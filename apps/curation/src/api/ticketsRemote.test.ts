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

import {
  asTicketList,
  gemmaCreateBody,
  targetRowId,
  type Ticket,
} from "./tickets";

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

/**
 * The two ticket services address a target differently, and the
 * fixtures below are both verbatim off the wire on 2026-08-29 —
 * gemma2 `GET /rest/v2/tickets/5` and the store's
 * `GET /curation/v1/tickets?limit=2`, post-`snakeify`.
 *
 * The store row genuinely has no `id`. That is the whole reason
 * `targetRowId` exists, so the fixture must not be given one to make
 * the test pass.
 */
const GEMMA_TICKET_5 = {
  id: 5,
  title: "GSE1829 (eid 861): GEO retired the series",
  targets: [
    {
      id: 5,
      target_type: "EXPRESSION_EXPERIMENT",
      target_id: 861,
      status: "NOT_DONE",
    },
  ],
} as unknown as Ticket;

const STORE_TICKET_206 = {
  id: 206,
  title: "The polished gold 500 — view (no proposals)",
  targets: [
    {
      target_type: "EXPRESSION_EXPERIMENT",
      target_id: 1181,
      status: "NOT_DONE",
      triage_disposition: null,
      display_label: "GSE10061",
    },
  ],
} as unknown as Ticket;

describe("targetRowId", () => {
  it("reads Gemma's target ROW id, not the id of the thing targeted", () => {
    // 5 vs 861 on purpose: the row id and the experiment id are
    // different numbers, and picking the wrong one patches whatever
    // target happens to sit at row 861.
    expect(targetRowId(GEMMA_TICKET_5, "EXPRESSION_EXPERIMENT", 861)).toBe(5);
  });

  it("🛑 finds nothing on a store ticket — those rows carry no row id", () => {
    expect(targetRowId(STORE_TICKET_206, "EXPRESSION_EXPERIMENT", 1181)).toBe(
      null,
    );
  });

  it("returns null for a target this ticket does not have", () => {
    expect(targetRowId(GEMMA_TICKET_5, "EXPRESSION_EXPERIMENT", 862)).toBe(null);
    expect(targetRowId(GEMMA_TICKET_5, "ARRAY_DESIGN", 861)).toBe(null);
    expect(targetRowId(null, "EXPRESSION_EXPERIMENT", 861)).toBe(null);
  });
});

describe("gemmaCreateBody", () => {
  it("🛑 rewrites the target keys — client.ts sends bodies verbatim", () => {
    // Left as `target_type` these reach Jackson as unknown properties,
    // `targetType` stays null, and the handler answers "Each target
    // requires targetType and targetId".
    const out = gemmaCreateBody({
      type: "CURATION",
      title: "Fix the design",
      targets: [{ target_type: "EXPRESSION_EXPERIMENT", target_id: 861 }],
    });
    expect(out.targets).toEqual([
      { targetType: "EXPRESSION_EXPERIMENT", targetId: 861 },
    ]);
  });

  it("carries the optional metadata Gemma's create seeds", () => {
    const out = gemmaCreateBody({
      type: "QUALITY_REVIEW",
      title: "t",
      priority: "HIGH",
      mode: "AUTO",
      body: "why",
      targets: [{ target_type: "ARRAY_DESIGN", target_id: 4, status: "DONE" }],
    });
    expect(out.priority).toBe("HIGH");
    expect(out.mode).toBe("AUTO");
    expect(out.body).toBe("why");
    expect(out.targets).toEqual([
      { targetType: "ARRAY_DESIGN", targetId: 4, status: "DONE" },
    ]);
  });

  it("drops `assignee` rather than guessing an assigneeId", () => {
    // The store takes a username, Gemma takes a numeric id and 400s on
    // one it cannot load. An unassigned ticket is recoverable; a failed
    // create is not.
    const out = gemmaCreateBody({
      type: "GENERIC",
      title: "t",
      assignee: "paul",
      targets: [{ target_type: "EXPRESSION_EXPERIMENT", target_id: 1 }],
    });
    expect(out).not.toHaveProperty("assignee");
    expect(out).not.toHaveProperty("assigneeId");
  });

  it("🛑 refuses REVIEW — Gemma's enum does not have it", () => {
    // The store's most common type, and what `from-accession` defaults
    // to. Named in the message so the curator is not left with a 400.
    expect(() =>
      gemmaCreateBody({
        type: "REVIEW",
        title: "t",
        targets: [{ target_type: "EXPRESSION_EXPERIMENT", target_id: 1 }],
      }),
    ).toThrow(/REVIEW/);
    expect(() =>
      gemmaCreateBody({
        type: "SCREENING",
        title: "t",
        targets: [{ target_type: "EXPRESSION_EXPERIMENT", target_id: 1 }],
      }),
    ).toThrow(/SCREENING/);
  });

  it("refuses a GEO_ACCESSION target — the store's synthetic triage row", () => {
    expect(() =>
      gemmaCreateBody({
        type: "CURATION",
        title: "t",
        targets: [{ target_type: "GEO_ACCESSION", target_id: 7 }],
      }),
    ).toThrow(/GEO_ACCESSION/);
  });

  it("passes every type the two enums share", () => {
    for (const type of [
      "BATCH_INFO_NEEDED",
      "REALIGNMENT_NEEDED",
      "QUALITY_REVIEW",
      "PRELOAD",
      "CURATION",
      "GENERIC",
    ] as const) {
      expect(
        gemmaCreateBody({
          type,
          title: "t",
          targets: [{ target_type: "EXPRESSION_EXPERIMENT", target_id: 1 }],
        }).type,
      ).toBe(type);
    }
  });
});
