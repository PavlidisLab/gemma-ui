import { describe, expect, it } from "vitest";

import { middleEllipsis } from "./middleEllipsis";

// The real pair from GSE239820's treatment factor — two levels of one
// factor whose labels differ only in the last two words.
const SEVEN = "dextran sulfate sodium delivered for duration 7 days";
const FIVE = "dextran sulfate sodium delivered for duration 5 days";

describe("middleEllipsis", () => {
  it("leaves a label that already fits alone", () => {
    expect(middleEllipsis("male", 44)).toBe("male");
    expect(middleEllipsis(SEVEN, 200)).toBe(SEVEN);
  });

  it("keeps the tail, so sibling levels stay distinguishable", () => {
    const a = middleEllipsis(SEVEN, 40);
    const b = middleEllipsis(FIVE, 40);
    expect(a).not.toBe(b);
    expect(a.endsWith("7 days")).toBe(true);
    expect(b.endsWith("5 days")).toBe(true);
  });

  it("stays within the budget", () => {
    expect(middleEllipsis(SEVEN, 40).length).toBeLessThanOrEqual(40);
    expect(middleEllipsis(SEVEN, 12).length).toBeLessThanOrEqual(12);
  });

  it("degrades to a plain cut when there is no room for a tail", () => {
    expect(middleEllipsis(SEVEN, 2)).toBe("d…");
    expect(middleEllipsis(SEVEN, 1)).toBe(SEVEN);
  });

  it("handles empty and whitespace input", () => {
    expect(middleEllipsis("", 10)).toBe("");
    expect(middleEllipsis("   ", 10)).toBe("");
  });
});
