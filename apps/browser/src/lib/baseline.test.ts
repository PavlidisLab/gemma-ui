import { describe, expect, it } from "vitest";
import { isBaselineTerm } from "./baseline";

describe("isBaselineTerm", () => {
  it("matches the five canonical baseline terms by label", () => {
    for (const l of [
      "control",
      "wild type genotype",
      "reference subject role",
      "reference substance role",
      "initial time point",
    ]) {
      expect(isBaselineTerm(l)).toBe(true);
    }
  });

  // 2026-08-08: detection is deliberately wider than the guideline
  // prescribes — these older wordings still mark the control level, and
  // Gemma's DEA auto-assigns them, so a browsing reader should see
  // "baseline" on a legacy design just as on a fresh one.
  it("also matches the non-canonical wordings the guideline steers away from", () => {
    for (const l of [
      "Baseline participant role",
      "Control group",
      "Control role",
      "Normal control group",
      "Negative control role",
      "Normal littermates",
    ]) {
      expect(isBaselineTerm(l)).toBe(true);
    }
  });

  it("matches by URI regardless of label", () => {
    expect(isBaselineTerm("DMSO", "http://purl.obolibrary.org/obo/OBI_0000025")).toBe(
      true,
    );
  });

  it("does NOT match real biological values — sex terms stay visible", () => {
    expect(isBaselineTerm("female", "http://purl.obolibrary.org/obo/PATO_0000383")).toBe(
      false,
    );
    expect(isBaselineTerm("normal")).toBe(false);
    expect(isBaselineTerm("control diet")).toBe(false);
    expect(isBaselineTerm("")).toBe(false);
    expect(isBaselineTerm(null, null)).toBe(false);
  });
});
