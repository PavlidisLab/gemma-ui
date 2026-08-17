import { describe, expect, it } from "vitest";

import type { Factor, FactorValue } from "@/features/experiment/types";

import { resolveValueCategory } from "./factorCategory";

const STRAIN = { label: "strain", uri: "http://www.ebi.ac.uk/efo/EFO_0005135" };

const fv = (
  label: string,
  statements: FactorValue["statements"] = [],
): FactorValue => ({
  id: 1,
  free_text_label: label,
  is_baseline: false,
  biomaterial_short_names: [],
  statements,
});

// A factor imported from a promoted characteristic carries no
// category at all, which is the case the fallback exists for.
const factor = (over: Partial<Factor> = {}): Factor =>
  ({
    id: 3,
    name: "strain",
    description: "",
    type: "categorical",
    factor_values: [],
    ...over,
  }) as Factor;

describe("resolveValueCategory", () => {
  it("uses the factor's own category when it has one", () => {
    const f = factor({
      category: STRAIN,
      factor_values: [
        fv("129/Ola", [{ category: { label: "genotype", uri: null }, subject: { label: "129/Ola" } }]),
      ],
    });
    // The factor's own field is the authority — a statement carrying
    // something else does not overrule it.
    expect(resolveValueCategory(f)?.label).toBe("strain");
  });

  // Promotion from the sample-details table names the factor after
  // the characteristic key and leaves the category null, so this is
  // the shape the fallback exists for.
  it("falls back to the category the grounded values agree on", () => {
    const f = factor({
      factor_values: [
        fv("129/Sv", [{ category: STRAIN, subject: { label: "129/Sv", uri: "x" } }]),
        fv("B5/GFP"),
      ],
    });
    expect(resolveValueCategory(f)?.uri).toBe(STRAIN.uri);
  });

  it("treats a label difference in case as agreement", () => {
    const f = factor({
      factor_values: [
        fv("a", [{ category: { label: "Strain", uri: null }, subject: { label: "a" } }]),
        fv("b", [{ category: { label: "strain", uri: null }, subject: { label: "b" } }]),
      ],
    });
    expect(resolveValueCategory(f)?.label).toBe("Strain");
  });

  // 🛑 A confident wrong chip on every ungrounded value is worse than
  // no chip. Disagreement has no single answer.
  it("says nothing when the grounded values disagree", () => {
    const f = factor({
      factor_values: [
        fv("a", [{ category: STRAIN, subject: { label: "a" } }]),
        fv("b", [{ category: { label: "genotype", uri: "http://x/GENO" }, subject: { label: "b" } }]),
      ],
    });
    expect(resolveValueCategory(f)).toBeNull();
  });

  it("returns null for a factor with nothing to go on", () => {
    expect(resolveValueCategory(factor({ factor_values: [fv("a"), fv("b")] }))).toBeNull();
    expect(resolveValueCategory(factor())).toBeNull();
  });

  it("ignores statements whose category is blank", () => {
    const f = factor({
      factor_values: [
        fv("a", [{ category: { label: "  ", uri: null }, subject: { label: "a" } }]),
        fv("b", [{ category: STRAIN, subject: { label: "b" } }]),
      ],
    });
    expect(resolveValueCategory(f)?.label).toBe("strain");
  });
});
