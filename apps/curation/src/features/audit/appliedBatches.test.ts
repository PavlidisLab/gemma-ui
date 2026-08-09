/**
 * Tests for the Apply-All undo registry.
 *
 * The registry is module-global and outlives route changes, which is
 * deliberate (the undo button lives in a card that remounts) but makes
 * two failure modes possible. Both are regression-guarded here:
 *
 *   1. ``target_id`` slugs recur across experiments, so an unscoped key
 *      let an undo on one experiment restore another's whole Design.
 *   2. Snapshots are PRE-commit drafts, so they must be dropped when the
 *      draft is committed / discarded / re-imported — otherwise undo
 *      rewinds past work that already landed.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAppliedBatches,
  registerAppliedBatch,
  undoBatched,
} from "./appliedBatches";
import type { Design } from "@/features/experiment/types";

function makeDesign(shortName: string, factorLabels: string[] = []): Design {
  return {
    experiment_id: 1,
    experiment_short_name: shortName,
    factors: factorLabels.map((label, i) => ({
      id: i + 1,
      category: { label, uri: null },
      values: [],
      statements: [],
    })),
    biomaterials: [],
    tags: [],
  } as unknown as Design;
}

/** Mutator that appends a marker factor, so we can read back exactly
 *  which mutations were replayed. */
function addFactor(label: string) {
  return (d: Design): Design =>
    ({
      ...d,
      factors: [
        ...d.factors,
        { id: d.factors.length + 100, category: { label, uri: null }, values: [], statements: [] },
      ],
    }) as unknown as Design;
}

function labels(d: Design): string[] {
  return d.factors.map((f) => f.category.label);
}

beforeEach(() => {
  clearAppliedBatches();
});

describe("registerAppliedBatch / undoBatched", () => {
  it("returns null for a target that was never part of a batch", () => {
    expect(undoBatched(1, "factor:disease")).toBeNull();
  });

  it("ignores an empty batch", () => {
    registerAppliedBatch(1, makeDesign("GSE1"), []);
    expect(undoBatched(1, "factor:disease")).toBeNull();
  });

  it("rebuilds the draft from the snapshot minus the undone finding", () => {
    const snapshot = makeDesign("GSE1", ["base"]);
    registerAppliedBatch(1, snapshot, [
      { targetId: "factor:disease", mutate: addFactor("disease") },
      { targetId: "factor:sex", mutate: addFactor("sex") },
    ]);

    const undo = undoBatched(1, "factor:disease");
    expect(undo).not.toBeNull();
    // Sibling's mutation is replayed; the undone one is left out.
    expect(labels(undo!(makeDesign("ignored")))).toEqual(["base", "sex"]);
  });

  it("drops the undone target so siblings do not replay it", () => {
    const snapshot = makeDesign("GSE1", ["base"]);
    registerAppliedBatch(1, snapshot, [
      { targetId: "factor:disease", mutate: addFactor("disease") },
      { targetId: "factor:sex", mutate: addFactor("sex") },
    ]);

    undoBatched(1, "factor:disease");
    // Undoing the sibling now replays neither.
    const second = undoBatched(1, "factor:sex");
    expect(second).not.toBeNull();
    expect(labels(second!(makeDesign("ignored")))).toEqual(["base"]);
  });

  it("is not re-entrant for the same target", () => {
    registerAppliedBatch(1, makeDesign("GSE1"), [
      { targetId: "factor:disease", mutate: addFactor("disease") },
    ]);
    expect(undoBatched(1, "factor:disease")).not.toBeNull();
    expect(undoBatched(1, "factor:disease")).toBeNull();
  });
});

describe("experiment scoping", () => {
  it("does not let one experiment's undo find another's batch", () => {
    // Same target_id slug on both — the collision that made an undo on
    // GSE2 restore GSE1's entire Design.
    registerAppliedBatch(1, makeDesign("GSE1", ["gse1-only"]), [
      { targetId: "factor:disease", mutate: addFactor("disease") },
    ]);

    expect(undoBatched(2, "factor:disease")).toBeNull();
  });

  it("keeps same-slug batches on different experiments independent", () => {
    registerAppliedBatch(1, makeDesign("GSE1", ["one"]), [
      { targetId: "factor:disease", mutate: addFactor("a") },
    ]);
    registerAppliedBatch(2, makeDesign("GSE2", ["two"]), [
      { targetId: "factor:disease", mutate: addFactor("b") },
    ]);

    expect(labels(undoBatched(1, "factor:disease")!(makeDesign("x")))).toEqual([
      "one",
    ]);
    expect(labels(undoBatched(2, "factor:disease")!(makeDesign("x")))).toEqual([
      "two",
    ]);
  });

  it("treats numeric and string experiment ids as the same experiment", () => {
    // Call sites pass ``number | string`` interchangeably (route params
    // arrive as strings).
    registerAppliedBatch(7, makeDesign("GSE7"), [
      { targetId: "factor:disease", mutate: addFactor("a") },
    ]);
    expect(undoBatched("7", "factor:disease")).not.toBeNull();
  });
});

describe("clearAppliedBatches", () => {
  it("drops the tracked batch so a stale snapshot cannot be replayed", () => {
    registerAppliedBatch(1, makeDesign("GSE1"), [
      { targetId: "factor:disease", mutate: addFactor("disease") },
    ]);

    clearAppliedBatches(1);

    expect(undoBatched(1, "factor:disease")).toBeNull();
  });

  it("clears only the named experiment", () => {
    registerAppliedBatch(1, makeDesign("GSE1"), [
      { targetId: "factor:disease", mutate: addFactor("a") },
    ]);
    registerAppliedBatch(2, makeDesign("GSE2"), [
      { targetId: "factor:disease", mutate: addFactor("b") },
    ]);

    clearAppliedBatches(1);

    expect(undoBatched(1, "factor:disease")).toBeNull();
    expect(undoBatched(2, "factor:disease")).not.toBeNull();
  });

  it("clears every experiment when called with no argument", () => {
    registerAppliedBatch(1, makeDesign("GSE1"), [
      { targetId: "factor:disease", mutate: addFactor("a") },
    ]);
    registerAppliedBatch(2, makeDesign("GSE2"), [
      { targetId: "factor:sex", mutate: addFactor("b") },
    ]);

    clearAppliedBatches();

    expect(undoBatched(1, "factor:disease")).toBeNull();
    expect(undoBatched(2, "factor:sex")).toBeNull();
  });

  it("does not clear experiment 12 when clearing experiment 1", () => {
    // Guards the prefix match — ``1::`` must not match ``12::``.
    registerAppliedBatch(12, makeDesign("GSE12"), [
      { targetId: "factor:disease", mutate: addFactor("a") },
    ]);

    clearAppliedBatches(1);

    expect(undoBatched(12, "factor:disease")).not.toBeNull();
  });
});
