import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FactorComparisonGrid } from "./FactorComparisonGrid";
import { termRenderer } from "@/components/ui/Term";

/**
 * Wiring test: a category mismatch in the comparison-grid header must
 * tone the category chips amber (the ``Term`` ``diff`` palette, class
 * ``term diff``), so a near-match factor whose category drifted reads
 * as a diff instead of two quietly-different green chips. Same
 * categories must stay un-toned. Uses the real curation ``termRenderer``
 * so the ``diff`` flag actually threads through to ``Term``'s class.
 */
function render(
  left: { label: string | null; uri: string | null },
  right: { label: string | null; uri: string | null },
) {
  return renderToStaticMarkup(
    <FactorComparisonGrid
      leftHeader={{ label: "Current", category: left }}
      rightHeader={{ label: "Agent proposal", category: right }}
      pairs={[]}
      termRenderer={termRenderer}
    />,
  );
}

describe("FactorComparisonGrid — category-diff header toning", () => {
  it("tones the category chips amber when the two sides' categories differ", () => {
    const html = render(
      { label: "disease", uri: "EFO:0000408" },
      { label: "disease model", uri: "TGEMO:00101" },
    );
    // Term applies the `diff` class (amber palette) on top of `term`.
    expect(html).toContain("term diff");
  });

  it("does NOT tone the category chips when the categories match", () => {
    const html = render(
      { label: "treatment", uri: "EFO:0000727" },
      { label: "treatment", uri: "EFO:0000727" },
    );
    // Chips still render (term), but never with the diff modifier.
    expect(html).toContain("term");
    expect(html).not.toContain("term diff");
  });
});
