import { describe, expect, it } from "vitest";
import { deriveTitle } from "./CreateScreeningTicketModal";

/**
 * deriveTitle() backs the "New screening ticket" form: when the curator
 * leaves the title blank, the ticket title is generated from the
 * plain-language instruction. It must produce a compact, single-line,
 * bounded string so the ticket card + detail header stay readable.
 */
describe("deriveTitle", () => {
  it("takes the first sentence of a single line", () => {
    expect(
      deriveTitle("Find GEO datasets like GSE123456. Mouse brain only."),
    ).toBe("Find GEO datasets like GSE123456.");
  });

  it("takes only the first line of a multi-line instruction", () => {
    expect(
      deriveTitle("Screen single-cell studies\nthat still need cell-type curation"),
    ).toBe("Screen single-cell studies");
  });

  it("returns the whole thing when there's no sentence/line break", () => {
    expect(deriveTitle("datasets in Gemma needing cell-type curation")).toBe(
      "datasets in Gemma needing cell-type curation",
    );
  });

  it("truncates a long first sentence to 77 chars + ellipsis (<= 80 total)", () => {
    const long =
      "Find every mouse brain single-cell perturbation dataset in GEO from the last two years that we might plausibly want to curate for the atlas";
    const out = deriveTitle(long);
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith("…")).toBe(true);
    expect(out.slice(0, 20)).toBe(long.slice(0, 20));
  });

  it("does not truncate a first sentence at exactly the boundary", () => {
    // A short sentence stays whole (no ellipsis).
    const s = "Short screening task.";
    expect(deriveTitle(s)).toBe(s);
    expect(deriveTitle(s).endsWith("…")).toBe(false);
  });

  it("falls back to 'Screening' for empty / whitespace-only input", () => {
    expect(deriveTitle("")).toBe("Screening");
    expect(deriveTitle("   \n  ")).toBe("Screening");
  });

  it("trims surrounding whitespace", () => {
    expect(deriveTitle("   trim me   ")).toBe("trim me");
  });
});
