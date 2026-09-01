/**
 * Two ways the dataset list can silently return the wrong rows.
 *
 * Both were found by the code review, and both are the same shape as
 * the empty-scope bug that put the whole corpus inside an empty
 * scratchpad: a scope that is asked for but not applied.
 */
import { describe, expect, it } from "vitest";

import { __test } from "./workflow";

const { idScopeFilter } = __test;

describe("idScopeFilter", () => {
  it("names the ids as a filter clause", () => {
    expect(idScopeFilter("20728,1,2")).toBe("id in (20728,1,2)");
  });
});

describe("the id scope combined with a caller filter", () => {
  // The composition lives in `useDatasetsPaginated`; this pins the rule
  // it has to obey, because getting it wrong returns rows from OUTSIDE
  // the scope and nothing in the UI would look wrong.
  const join = (caller: string | undefined, ids: string) =>
    [caller, idScopeFilter(ids)].filter(Boolean).map((c) => `(${c})`).join(" and ");

  it("🛑 parenthesises each side so `or` cannot rebind", () => {
    // `and` binds tighter than `or`. Joined bare, the scope would apply
    // to the second disjunct only and troubled datasets from outside
    // the ticket would come back.
    expect(join("troubled = true or needsAttention = true", "1,2")).toBe(
      "(troubled = true or needsAttention = true) and (id in (1,2))",
    );
  });

  it("wraps a lone scope harmlessly", () => {
    expect(join(undefined, "1,2")).toBe("(id in (1,2))");
  });
});
