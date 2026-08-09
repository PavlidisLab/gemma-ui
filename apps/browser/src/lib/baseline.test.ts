import { describe, expect, it } from "vitest";
import { isBaselineFactorValue, isBaselineTerm } from "./baseline";

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

// Parity with Gemma's own detector — backend commit be7b55b8fe,
// handoff CAB_BASELINE_DETECTION_2026_08_08.md.
describe("parity with Gemma's BaselineSelection", () => {
  it("matches the singular 'normal littermate' Gemma also carries", () => {
    expect(isBaselineTerm("normal littermate")).toBe(true);
    expect(isBaselineTerm("normal littermates")).toBe(true);
  });

  it("reads underscores as spaces, as Gemma does", () => {
    expect(isBaselineTerm("Normal_Control_Group")).toBe(true);
    expect(isBaselineTerm("negative_control_role")).toBe(true);
  });

  it("recognises baseline participant role by URI — OBI is loaded", () => {
    expect(
      isBaselineTerm("some label", "http://purl.obolibrary.org/obo/OBI_0000143"),
    ).toBe(true);
  });

  // Gemma's controlGroupUris also lists birnlex / MSIO / SIO / NCIT
  // terms, but none of those ontologies are loaded, so such a URI can't
  // legitimately reach our data. Matching it would be dead weight with
  // false-positive surface. The LABELS still match as free text, which
  // is how these actually arrive.
  it("does NOT match URIs from ontologies Gemma doesn't load", () => {
    for (const u of [
      "http://purl.obolibrary.org/obo/MSIO_0000007",
      "http://semanticscience.org/resource/SIO_010431",
      "http://semanticscience.org/resource/SIO_001068",
      "http://purl.obolibrary.org/obo/NCIT_C28143",
      "http://ontology.neuinfo.org/NIF/Backend/BIRNLex-OBO-UBO.owl#birnlex_2201",
      "http://ontology.neuinfo.org/NIF/Backend/BIRNLex-OBO-UBO.owl#birnlex_2001",
    ]) {
      expect(isBaselineTerm("some label", u)).toBe(false);
    }
  });

  it("but their LABELS still match, which is how they actually arrive", () => {
    expect(isBaselineTerm("negative control role")).toBe(true);
    expect(isBaselineTerm("control role")).toBe(true);
    expect(isBaselineTerm("normal control group")).toBe(true);
  });

  it("still doesn't swallow real values after widening", () => {
    expect(isBaselineTerm("normal_diet")).toBe(false);
    expect(isBaselineTerm("female", "http://purl.obolibrary.org/obo/PATO_0000383")).toBe(false);
  });
});

describe("isBaselineFactorValue — the flag decides in BOTH directions", () => {
  it("an explicit true wins even with no baseline term", () => {
    expect(isBaselineFactorValue(true, false)).toBe(true);
  });

  // The half a plain `!!flag || terms` misses: a value the curator
  // deliberately un-marked must not render as the baseline just because
  // its label reads like a control.
  it("an explicit false EXCLUDES even when the label is a control term", () => {
    expect(isBaselineFactorValue(false, true)).toBe(false);
  });

  it("absent falls back to the terms — the common case on the wire", () => {
    expect(isBaselineFactorValue(null, true)).toBe(true);
    expect(isBaselineFactorValue(undefined, true)).toBe(true);
    expect(isBaselineFactorValue(null, false)).toBe(false);
  });
});
