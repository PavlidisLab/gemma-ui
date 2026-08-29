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
  gemmaScreeningResult,
  reasonToSend,
  toWirePatch,
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

  it("🛑 translates REVIEW to CURATION rather than sending it", () => {
    // Paul's call, 2026-08-29. The store's own comment is the argument:
    // the type "classifies the ticket as curation work, not the
    // underlying mode. The flow field drives the edit-vs-review
    // affordance." Gemma's CURATION is already that category, so the
    // name is dropped at the boundary and `flow` still carries the
    // distinction the UI renders. Asking Gemma for a REVIEW value was
    // considered and declined — two names for one category is how
    // vocabularies drift.
    expect(
      gemmaCreateBody({
        type: "REVIEW",
        title: "t",
        targets: [{ target_type: "EXPRESSION_EXPERIMENT", target_id: 1 }],
      }).type,
    ).toBe("CURATION");
  });

  it("refuses SCREENING only until the host carries it", () => {
    // Added verbatim on Gemma's side (a97999db15) but not deployed to
    // gemma2 yet. When it lands, this refusal comes out — the test
    // should then assert SCREENING passes through unchanged.
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

/**
 * The store's four screening states into Gemma's three values plus null.
 *
 * Live on gemma2 `211a518836` — the target VO carries `screeningResult`
 * and `screeningResultReason`, verified on ticket 5, and a body with
 * neither `status` nor `screeningResult` answers
 * `400 "Request body with `status` and/or `screeningResult` is required."`
 * verbatim.
 */
describe("gemmaScreeningResult", () => {
  it("maps the three decided states", () => {
    expect(gemmaScreeningResult("include")).toBe("INCLUDE");
    // 🛑 `exclude` is `REJECT`, not `EXCLUDE` — the names differ.
    expect(gemmaScreeningResult("exclude")).toBe("REJECT");
    expect(gemmaScreeningResult("unsure")).toBe("UNDECIDED");
  });

  it("🛑 keeps `unsure` and `undecided` apart", () => {
    // Mapping both onto UNDECIDED merges reviewed-but-unresolved with
    // nobody-has-looked-yet. The rows that disappear are the ones a
    // curator most needs to find again, and that split is the entire
    // reason `unsure` exists as a value.
    expect(gemmaScreeningResult("unsure")).toBe("UNDECIDED");
    expect(gemmaScreeningResult(null)).toBe(null);
    expect(gemmaScreeningResult("unsure")).not.toBe(gemmaScreeningResult(null));
  });

  it("clears on an explicit null", () => {
    // Gemma spells "clear" as null where the store spells it "" — see
    // toWirePatch. Neither accepts the other's spelling.
    expect(gemmaScreeningResult(null)).toBe(null);
    expect(toWirePatch({ triage_disposition: null }).triage_disposition).toBe("");
  });
});

/**
 * Gemma clears `screeningResultReason` on ANY patch carrying
 * `screeningResult` without it — re-sending the SAME value included.
 * Measured on sandbox `25e175f83d`, 2026-08-29.
 *
 * The store clears the reason only when the decision CHANGES, and our
 * callers are written to that contract: `TriageView` sends the reason
 * key only when it has a new reason, and the bulk action never does. So
 * an unchanged decision has to carry its reason forward here or a
 * curator's note disappears the second time they touch the row.
 */
describe("reasonToSend", () => {
  // Post-snakeify shape, as the target arrives in `Ticket.targets`.
  const target = {
    id: 1,
    target_type: "EXPRESSION_EXPERIMENT",
    target_id: 9001,
    screening_result: "UNDECIDED",
    screening_result_reason: "needs the paper",
  } as unknown as Parameters<typeof reasonToSend>[0];

  it("🛑 carries the reason forward when the decision is unchanged", () => {
    // Without this the second click on an already-`unsure` row wipes
    // the note the curator wrote on the first.
    expect(reasonToSend(target, "UNDECIDED")).toBe("needs the paper");
  });

  it("clears when the decision changes — what the store does too", () => {
    // A stale reason must not outlive the `unsure` it belonged to and
    // reattach to a later `include`.
    expect(reasonToSend(target, "INCLUDE")).toBe(null);
    expect(reasonToSend(target, "REJECT")).toBe(null);
  });

  it("clears when the decision is being cleared", () => {
    expect(reasonToSend(target, null)).toBe(null);
  });

  it("has nothing to carry when the target is unknown or bare", () => {
    expect(reasonToSend(undefined, "UNDECIDED")).toBe(null);
    expect(
      reasonToSend(
        { id: 1 } as unknown as Parameters<typeof reasonToSend>[0],
        "UNDECIDED",
      ),
    ).toBe(null);
  });
});

/**
 * After gemma2 `8926e8d170` the server honours "omit the reason key =
 * leave it alone", so the carry-forward is belt-and-braces rather than
 * the mechanism. What is NOT optional is clearing on a decision change:
 * Gemma deliberately leaves the old note in place there, so the store's
 * clear-on-change contract is this client's job. Verified live on the
 * sandbox — `UNDECIDED` → `REJECT` with no reason key kept the note.
 */
describe("reasonToSend after the server-side fix", () => {
  const target = {
    screening_result: "UNDECIDED",
    screening_result_reason: "needs the paper",
  } as unknown as Parameters<typeof reasonToSend>[0];

  it("🛑 still clears on a change — the server will not do it for us", () => {
    expect(reasonToSend(target, "REJECT")).toBe(null);
  });

  it("sending the reason back unchanged is a no-op on a fixed server", () => {
    // Equal to what is already stored, so the PATCH changes nothing
    // whether the server preserves it or overwrites it with the same
    // value. That is what makes the branch safe to keep on both builds.
    expect(reasonToSend(target, "UNDECIDED")).toBe("needs the paper");
  });
});
