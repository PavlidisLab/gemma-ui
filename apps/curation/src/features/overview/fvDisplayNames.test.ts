/**
 * Collision-disambiguated FV names for the Overview crosstab.
 *
 * GSE16435 (2026-08-19): ``developmental stage`` holds two 12-sample
 * levels, both labelled "infant stage", distinguished only by the
 * statement modifier (``has developmental stage · P10`` vs ``P20``).
 * Keyed on the bare label, the crosstab showed one level across all
 * 24 samples. The rule: names change ONLY on collision, and only by
 * appending the statements' object labels.
 */
import { describe, expect, it } from "vitest";
import type { Factor, FactorValue } from "@/features/experiment/types";
import { fvDisplayNames, isUnspecifiedFv } from "./DesignSummary";

function fv(
  label: string,
  objects: Array<{ label: string; uri?: string | null }> = [],
): FactorValue {
  return {
    id: Math.random(),
    free_text_label: label,
    is_baseline: false,
    biomaterial_short_names: [],
    statements: objects.map((o) => ({
      category: { label: "developmental stage", uri: null },
      subject: { label, uri: null },
      predicate: { label: "has developmental stage", uri: null },
      object: { label: o.label, uri: o.uri ?? null },
    })),
  } as unknown as FactorValue;
}

function factor(values: FactorValue[]): Factor {
  return {
    id: 1,
    name: "developmental stage",
    category: { label: "developmental stage", uri: null },
    type: "categorical",
    factor_values: values,
  } as unknown as Factor;
}

describe("fvDisplayNames", () => {
  it("the GSE16435 shape: colliding labels get their modifier suffix", () => {
    const p10 = fv("infant stage", [{ label: "P10" }]);
    const p20 = fv("infant stage", [{ label: "P20" }]);
    const names = fvDisplayNames(factor([p10, p20]));
    expect(names.get(p10)).toBe("infant stage · P10");
    expect(names.get(p20)).toBe("infant stage · P20");
  });

  it("non-colliding labels are untouched, even with modifiers", () => {
    const a = fv("infant stage", [{ label: "P10" }]);
    const b = fv("adult stage", [{ label: "P90" }]);
    const names = fvDisplayNames(factor([a, b]));
    expect(names.get(a)).toBe("infant stage");
    expect(names.get(b)).toBe("adult stage");
  });

  it("a colliding FV with no modifier keeps its base name", () => {
    const bare = fv("infant stage");
    const modified = fv("infant stage", [{ label: "P20" }]);
    const names = fvDisplayNames(factor([bare, modified]));
    expect(names.get(bare)).toBe("infant stage");
    expect(names.get(modified)).toBe("infant stage · P20");
  });

  it("gene objects render as the symbol, matching the gene-chip rule", () => {
    const uri = "http://purl.org/commons/record/ncbi_gene/18516";
    const a = fv("mutant", [
      { label: "Pank1 [mouse] pantothenate kinase 1", uri },
    ]);
    const b = fv("mutant", [{ label: "P20" }]);
    const names = fvDisplayNames(factor([a, b]));
    expect(names.get(a)).toBe("mutant · Pank1");
  });
});

describe("isUnspecifiedFv", () => {
  it("keys on the TGEMO_00122 subject URI, whatever the label says", () => {
    const v = fv("some odd label");
    v.statements![0] = {
      ...v.statements![0],
      subject: {
        label: "some odd label",
        uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00122",
      },
    };
    expect(isUnspecifiedFv(v)).toBe(true);
  });

  it("falls back to the exact label for free-text rows", () => {
    expect(isUnspecifiedFv(fv("Unspecified factor value"))).toBe(true);
    expect(isUnspecifiedFv(fv("unspecified factor value "))).toBe(true);
  });

  it("a real level is not unspecified", () => {
    const v = fv("infant stage", [{ label: "P10" }]);
    expect(isUnspecifiedFv(v)).toBe(false);
  });
});
