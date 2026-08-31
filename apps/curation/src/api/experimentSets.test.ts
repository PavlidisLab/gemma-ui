/**
 * Which Gemma experiment sets contain this dataset.
 *
 * Gemma has no reverse lookup, so the whole list is read and filtered
 * here — which makes the filter the only thing standing between a
 * curator and a silent "this dataset is in no sets". That failure is
 * indistinguishable from the common case (most datasets really are in
 * none), so it gets pinned rather than eyeballed.
 *
 * Shapes are verbatim from gemma2 `e8ccbfaae0`, post-`snakeify`.
 */
import { describe, expect, it } from "vitest";

import { setsContaining, type ExperimentSet } from "./experimentSets";

const SETS: ExperimentSet[] = [
  {
    id: 6351,
    name: "331cancer",
    size: 3,
    taxon_name: "human",
    expression_experiment_ids: [1658, 27103, 38390],
  },
  {
    id: 2698,
    name: "Brain GPL570",
    size: 2,
    taxon_name: "human",
    expression_experiment_ids: [38390, 91442],
  },
  // Member ids absent — what a page fetched WITHOUT includeMembers
  // looks like. It must never read as "contains everything".
  { id: 6390, name: "Case_Study", size: 4, taxon_name: "human" },
];

describe("setsContaining", () => {
  it("finds every set holding the experiment", () => {
    expect(setsContaining(SETS, 38390).map((s) => s.name)).toEqual([
      "331cancer",
      "Brain GPL570",
    ]);
  });

  it("🛑 matches a string id — the route's ids are numbers", () => {
    // The experiment id reaches the banner as either. A mismatch here
    // returns no sets, which looks exactly like the common case and so
    // would never be reported as a bug.
    expect(setsContaining(SETS, "38390")).toHaveLength(2);
  });

  it("returns nothing for a dataset in no set — the usual answer", () => {
    expect(setsContaining(SETS, 99999)).toEqual([]);
  });

  it("a set with no member list matches nothing", () => {
    expect(setsContaining([SETS[2]], 38390)).toEqual([]);
  });

  it("a non-numeric or missing id is not a membership query", () => {
    expect(setsContaining(SETS, null)).toEqual([]);
    expect(setsContaining(SETS, undefined)).toEqual([]);
    expect(setsContaining(SETS, "")).toEqual([]);
    expect(setsContaining(SETS, "GSE256180")).toEqual([]);
  });
});
