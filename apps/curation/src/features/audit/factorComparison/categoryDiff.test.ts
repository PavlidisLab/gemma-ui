import { describe, expect, it } from "vitest";
import { categoriesDiffer } from "./categoryDiff";

describe("categoriesDiffer", () => {
  it("flags a near-match whose category drifted (disease vs disease model)", () => {
    expect(
      categoriesDiffer(
        { label: "disease", uri: "http://purl.obolibrary.org/obo/EFO_0000408" },
        { label: "disease model", uri: "http://example.org/TGEMO_00101" },
      ),
    ).toBe(true);
  });

  it("flags same label but two present-and-different URIs (same name, different concept)", () => {
    expect(
      categoriesDiffer(
        { label: "disease", uri: "EFO:0000408" },
        { label: "disease", uri: "MONDO:0000001" },
      ),
    ).toBe(true);
  });

  it("does NOT flag identical label + identical URI", () => {
    expect(
      categoriesDiffer(
        { label: "treatment", uri: "EFO:0000727" },
        { label: "treatment", uri: "EFO:0000727" },
      ),
    ).toBe(false);
  });

  it("is case/space-insensitive on the label", () => {
    expect(
      categoriesDiffer(
        { label: "Cell Type", uri: null },
        { label: "cell type", uri: null },
      ),
    ).toBe(false);
  });

  it("does NOT flag when only one side has a URI (resolution noise, not a mismatch)", () => {
    expect(
      categoriesDiffer(
        { label: "disease", uri: "EFO:0000408" },
        { label: "disease", uri: null },
      ),
    ).toBe(false);
  });

  it("does NOT flag a one-sided category (add / remove — nothing to compare)", () => {
    expect(categoriesDiffer({ label: "disease", uri: null }, { label: null, uri: null })).toBe(
      false,
    );
    expect(categoriesDiffer({ label: null, uri: null }, { label: "disease", uri: null })).toBe(
      false,
    );
    expect(categoriesDiffer(null, null)).toBe(false);
  });
});
