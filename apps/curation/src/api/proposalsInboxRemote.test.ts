/**
 * The proposals inbox in remote mode.
 *
 * Pins the three things gembro and cab each warned would fail
 * silently — a filter that does not filter, a count that lies, and an
 * envelope that reads empty. None of them throws; all three render a
 * confident wrong answer.
 *
 * ⚠️ Built against gembro's contract while it was committed but NOT
 * deployed. These fix the SHAPE we send and how we read it; they
 * cannot prove Gemma answers that way. Re-verify on deploy.
 */
import { describe, expect, it } from "vitest";

import { snakeify } from "./client";
import { asAnnotationSetRows } from "./annotationSetReviews";
import { proposalSetToProposal } from "./proposals";

/** The thin row as Gemma's collection route serves it — camelCase,
 *  wrapped in the paginated envelope. */
const ENVELOPE = {
  data: [
    {
      id: 1587,
      datasetId: 40414,
      datasetShortName: "GSE270825",
      kind: "proposal",
      status: "pending",
      createdBy: "cab",
      ranAt: "2026-09-01T12:00:00Z",
      factorCount: 3,
      tagCount: 5,
    },
    {
      // A row whose payload Gemma could not read: counts are null.
      id: 4,
      datasetId: 27438,
      datasetShortName: "GSE12345",
      kind: "proposal",
      status: "pending",
      createdBy: "design_proposer",
      ranAt: "2026-07-22T09:00:00Z",
      factorCount: null,
      tagCount: null,
    },
  ],
  totalElements: 2,
  offset: 0,
  limit: 100,
};

describe("reading the paginated envelope", () => {
  it("🛑 finds the rows inside it — a bare .data read is how this goes empty", () => {
    // The per-dataset route answers a BARE ARRAY and the collection
    // route answers this. `asAnnotationSetRows` knows both; an
    // Array.isArray test on the envelope is false and reads as "no
    // proposals", with no error anywhere.
    const rows = asAnnotationSetRows(snakeify(ENVELOPE));
    expect(rows).toHaveLength(2);
  });
});

describe("mapping a row to the card", () => {
  const rows = asAnnotationSetRows(snakeify(ENVELOPE)) as never[];
  const items = rows.map(proposalSetToProposal);

  it("carries the fields the inbox groups and labels by", () => {
    expect(items[0]).toMatchObject({
      proposal_id: "1587",
      experiment_id: 40414,
      experiment_short_name: "GSE270825",
      submitted_by: "cab",
      status: "pending",
      factor_count: 3,
      tag_count: 5,
    });
  });

  it("🛑 leaves factors/tags UNDEFINED rather than empty", () => {
    // `[]` would mean "this proposal changes nothing" to ShapeSummary.
    // The list response simply does not carry the payload.
    expect(items[0].factors).toBeUndefined();
    expect(items[0].tags).toBeUndefined();
  });

  it("🛑 keeps an unreadable payload's counts NULL, never 0", () => {
    // gembro: null means UNKNOWN. Coercing to 0 renders "(empty)" —
    // plausible, and wrong about a proposal that may change plenty.
    expect(items[1].factor_count).toBeNull();
    expect(items[1].tag_count).toBeNull();
    expect(items[1].factor_count).not.toBe(0);
  });

  it("tolerates a status outside the four in use", () => {
    // The column is a free string by Paul's ruling; a fifth value is
    // stored and returned rather than 400'd, so it must survive the
    // mapper too.
    const odd = proposalSetToProposal({
      id: 9,
      dataset_id: 1,
      status: "escalated",
    } as never);
    expect(odd.status).toBe("escalated");
  });

  it("defaults a missing status to pending, not to null", () => {
    // 🛑 gembro: `null` means "not a kind that gets reviewed" (draft,
    // snapshot, commit) — but every row we ask for is kind=proposal,
    // so an absent status here is nobody-has-ruled.
    const bare = proposalSetToProposal({ id: 9, dataset_id: 1 } as never);
    expect(bare.status).toBe("pending");
  });
});
