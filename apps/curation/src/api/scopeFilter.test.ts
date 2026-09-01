/**
 * Two ways the dataset list can silently return the wrong rows.
 *
 * Both were found by the code review, and both are the same shape as
 * the empty-scope bug that put the whole corpus inside an empty
 * scratchpad: a scope that is asked for but not applied.
 */
import { describe, expect, it } from "vitest";

import { __test } from "./workflow";

const { idScopeFilter, composeDatasetFilter } = __test;

describe("idScopeFilter", () => {
  it("names the ids as a filter clause", () => {
    expect(idScopeFilter("20728,1,2")).toBe("id in (20728,1,2)");
  });
});

describe("the id scope combined with a caller filter", () => {
  // 🛑 This used to build the composition a second time inside the
  // test, so it pinned a rule the shipped code did not have to obey.
  // It now calls `composeDatasetFilter`, which is what
  // `useDatasetsPaginated` calls.
  const join = (caller: string | undefined, ids: string) =>
    composeDatasetFilter(caller, idScopeFilter(ids));

  it("🛑 emits no parenthesis — Gemma's grammar rejects them", () => {
    // Measured on gemma2 `16dfb28512ce`: `filter=(inCuration = true)`
    // is a 400, parenthesis and all. The previous version of this test
    // asserted the parenthesised form, so the suite was green on a
    // filter the server refuses.
    const out = join("troubled = true or needsAttention = true", "1,2");
    expect(out).not.toContain("(troubled");
    expect(out).toBe("troubled = true or needsAttention = true and id in (1,2)");
  });

  it("🛑 a bare join does not let the scope slip off a disjunction", () => {
    // The reason the parentheses were added was backwards. In Gemma
    // `or` binds TIGHTER than `and`, so the caller's disjunction is
    // already one group and the scope applies to all of it. Measured:
    // `id in (4071,4080,4738,25717) and inCuration = true or isPublic = false`
    // counts 2 — the scope holding over both disjuncts — where the
    // assumed precedence would have given 2147.
    expect(join("a = 1 or b = 2", "1,2")).toBe("a = 1 or b = 2 and id in (1,2)");
  });

  it("passes a lone scope through unwrapped", () => {
    expect(join(undefined, "1,2")).toBe("id in (1,2)");
  });

  it("passes a lone caller filter through unwrapped", () => {
    expect(composeDatasetFilter("isPublic = false", null)).toBe("isPublic = false");
  });

  it("is empty when neither side asks for anything", () => {
    expect(composeDatasetFilter(undefined, null)).toBe("");
  });
});
