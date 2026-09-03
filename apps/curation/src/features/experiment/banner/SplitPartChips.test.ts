import { describe, expect, it } from "vitest";

import { splitPartDistinguisher } from "./SplitPartChips";

/**
 * A split part's short name says nothing about WHICH part it is —
 * `Rexach-2024.1` and `.2` differ only inside their titles. Real titles
 * from `GET /datasets/79038` (2026-09-03).
 */
describe("splitPartDistinguisher", () => {
  it("pulls the factor clause out of a real split-part title", () => {
    expect(
      splitPartDistinguisher(
        "Split part 1 of: Cross-disorder and disease-specific pathways in " +
          "dementia revealed by single-cell genomics [organism part = insula]",
      ),
    ).toBe("organism part = insula");
  });

  it("distinguishes two siblings that share everything but the clause", () => {
    const a = "Split part 1 of: Study X [organism part = insula]";
    const b = "Split part 2 of: Study X [organism part = visual cortex]";
    expect(splitPartDistinguisher(a)).not.toBe(splitPartDistinguisher(b));
  });

  it("falls back to the whole title when there is no clause to pull", () => {
    // Better an over-long tooltip than an empty one — an unparsed title
    // still tells the curator which sibling this is.
    expect(splitPartDistinguisher("Some study with no clause")).toBe(
      "Some study with no clause",
    );
  });

  it("returns empty for a missing title rather than the string 'null'", () => {
    expect(splitPartDistinguisher(null)).toBe("");
    expect(splitPartDistinguisher(undefined)).toBe("");
    expect(splitPartDistinguisher("   ")).toBe("");
  });

  it("takes the LAST clause when the title has more than one", () => {
    expect(
      splitPartDistinguisher("Study [GEO] about things [organism part = liver]"),
    ).toBe("organism part = liver");
  });
});
