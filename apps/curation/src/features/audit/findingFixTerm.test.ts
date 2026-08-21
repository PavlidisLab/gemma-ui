import { describe, expect, it } from "vitest";
import type { AuditFinding } from "@/api/auditTypes";
import { findingFixTerm } from "./findingHelpers";

/**
 * Lifting the term a `suggested_fix` names, so the header can chip it
 * instead of cutting the sentence at 50 characters.
 *
 * The cut is what Paul saw: "· Replace with `cell type: CD11b-positive
 * cell` or…" and "· Add a second statement: subject=protein…" — text
 * broken mid-thought, in place of the one thing the curator wanted.
 */
function f(suggested_fix: string): AuditFinding {
  return { suggested_fix } as unknown as AuditFinding;
}

describe("findingFixTerm", () => {
  it("lifts a category: value replacement", () => {
    // GSE104324's live wire.
    const t = findingFixTerm(
      f(
        "Replace with `cell type: CD11b-positive cell` or remove the " +
          "cell-type tag if a more general myeloid marker tag is preferred; " +
          "verify against CL ontology for the appropriate term for CD11b+ APCs.",
      ),
    );
    expect(t).toEqual({
      verb: "Replace with",
      category: "cell type",
      value: "CD11b-positive cell",
    });
  });

  it("lifts a bare term with no category", () => {
    expect(findingFixTerm(f("Add tag `male`."))).toEqual({
      verb: "Add tag",
      category: null,
      value: "male",
    });
  });

  it("🛑 declines when the fix names TWO terms", () => {
    // "Split into two factors: (1) `treatment` … (2) `timepoint` …" —
    // chipping the first would assert the fix is about `treatment`
    // alone, which is a claim the agent did not make.
    expect(
      findingFixTerm(
        f(
          "Split into two factors: (1) `treatment` with FVs [ATO, JQ1]; " +
            "(2) `timepoint` with FVs [0h, 6h].",
        ),
      ),
    ).toBeNull();
  });

  it("🛑 declines when the backtick is an aside, not the object", () => {
    expect(
      findingFixTerm(
        f(
          "Consider whether the submitter's own wording is better here " +
            "before using `cell type: neuron`.",
        ),
      ),
    ).toBeNull();
  });

  it("declines when the fix names no term at all", () => {
    // The FV case: "subject=protein (CHEBI:36080) + predicate=…" has no
    // backticks, so there is nothing to chip and the prose caption
    // stays.
    expect(
      findingFixTerm(
        f(
          "Add a second statement: subject=protein (CHEBI:36080) + " +
            "predicate=delivered at dose + object=10 nM.",
        ),
      ),
    ).toBeNull();
    expect(findingFixTerm(f(""))).toBeNull();
  });

  it("strips trailing punctuation off the verb", () => {
    expect(findingFixTerm(f("Use instead: `sex: male`"))?.verb).toBe(
      "Use instead",
    );
  });
});
