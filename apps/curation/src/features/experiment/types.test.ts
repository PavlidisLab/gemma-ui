import { describe, expect, it } from "vitest";
import {
  factorBaselineBlocksCommit,
  factorRequiresBaseline,
  isProtectedTagCategory,
  validateDesign,
  type Design,
  type Factor,
  type FactorValue,
} from "./types";

/**
 * Validator + baseline-required tests, focused on the continuous-
 * factor escape hatch (#12: continuous factors carry per-sample
 * measurements, not discrete FVs, so "exactly one baseline" and
 * "every sample assigned" don't apply).
 */

function categoricalFactor(
  id: number,
  category: string,
  fvs: FactorValue[] = [],
): Factor {
  return {
    id,
    name: category,
    category: { label: category, uri: null },
    description: "",
    type: "categorical",
    factor_values: fvs,
  };
}

function continuousFactor(id: number, category: string, fvs: FactorValue[] = []): Factor {
  return {
    id,
    name: category,
    category: { label: category, uri: null },
    description: "",
    type: "continuous",
    factor_values: fvs,
  };
}

function fv(
  id: number,
  label: string,
  bms: string[],
  baseline = false,
): FactorValue {
  return {
    id,
    free_text_label: label,
    is_baseline: baseline,
    biomaterial_short_names: bms,
    statements: [],
  };
}

function emptyDesign(overrides: Partial<Design> = {}): Design {
  return {
    experiment_id: 1,
    experiment_short_name: "GSE1",
    factors: [],
    biomaterials: [],
    tags: [],
    ...overrides,
  };
}

describe("factorRequiresBaseline", () => {
  it("returns false for block / batch / organism part / cell type categories", () => {
    expect(factorRequiresBaseline({ label: "block" })).toBe(false);
    expect(factorRequiresBaseline({ label: "batch" })).toBe(false);
    expect(factorRequiresBaseline({ label: "organism part" })).toBe(false);
    expect(factorRequiresBaseline({ label: "cell type" })).toBe(false);
  });

  it("returns true for typical experimental categories", () => {
    expect(factorRequiresBaseline({ label: "treatment" })).toBe(true);
    expect(factorRequiresBaseline({ label: "genotype" })).toBe(true);
    expect(factorRequiresBaseline({ label: "disease" })).toBe(true);
  });

  it("returns false for continuous factors regardless of category", () => {
    // A continuous "age" factor would naively hit the categorical
    // path and demand a baseline. Pass the whole Factor so the
    // type-aware overload kicks in.
    expect(factorRequiresBaseline(continuousFactor(1, "age"))).toBe(false);
    expect(factorRequiresBaseline(continuousFactor(1, "weight"))).toBe(false);
  });

  it("still requires baseline for categorical factors with non-exempt category", () => {
    expect(factorRequiresBaseline(categoricalFactor(1, "treatment"))).toBe(true);
  });

  it("treats null / undefined as 'requires baseline' (safe default)", () => {
    expect(factorRequiresBaseline(null)).toBe(true);
    expect(factorRequiresBaseline(undefined)).toBe(true);
  });

  it("is case-insensitive on category labels", () => {
    expect(factorRequiresBaseline({ label: "Cell Type" })).toBe(false);
    expect(factorRequiresBaseline({ label: "ORGANISM PART" })).toBe(false);
  });
});

describe("cell line is a no-baseline category", () => {
  it("does not require a baseline (no warning, no block)", () => {
    expect(factorRequiresBaseline(categoricalFactor(1, "cell line"))).toBe(false);
    expect(factorRequiresBaseline(categoricalFactor(1, "cell_line"))).toBe(false);
    expect(factorBaselineBlocksCommit(categoricalFactor(1, "cell line"))).toBe(false);
    expect(factorBaselineBlocksCommit(categoricalFactor(1, "cell_line"))).toBe(false);
  });
});

describe("baseline_relevance per-factor agent hint", () => {
  it("not_applicable suppresses both warning and block, regardless of category", () => {
    const f = categoricalFactor(1, "treatment");
    f.baseline_relevance = "not_applicable";
    f.baseline_relevance_reason = "subset axis";
    expect(factorRequiresBaseline(f)).toBe(false);
    expect(factorBaselineBlocksCommit(f)).toBe(false);
    const v = validateDesign(emptyDesign({ factors: [f] }));
    expect(v.factors[0].baseline_uncertain).toBe(false);
  });

  it("uncertain suppresses the loud warning + block but flags soft", () => {
    const f = categoricalFactor(1, "treatment");
    f.baseline_relevance = "uncertain";
    f.baseline_relevance_reason = "no canonical reference found";
    expect(factorRequiresBaseline(f)).toBe(false);
    expect(factorBaselineBlocksCommit(f)).toBe(false);
    const v = validateDesign(emptyDesign({ factors: [f] }));
    expect(v.factors[0].baseline_uncertain).toBe(true);
    expect(v.factors[0].baseline_uncertain_reason).toBe(
      "no canonical reference found",
    );
  });

  it("uncertain stops flagging once the curator picks a baseline", () => {
    const f = categoricalFactor(1, "treatment", [
      fv(1, "wt", ["s1"], true),
      fv(2, "drug", ["s2"]),
    ]);
    f.baseline_relevance = "uncertain";
    const v = validateDesign(emptyDesign({ factors: [f] }));
    expect(v.factors[0].baseline_uncertain).toBe(false);
  });

  it("required preserves existing behaviour", () => {
    const f = categoricalFactor(1, "treatment");
    f.baseline_relevance = "required";
    expect(factorRequiresBaseline(f)).toBe(true);
    expect(factorBaselineBlocksCommit(f)).toBe(true);
  });

  it("undefined relevance falls back to the category list", () => {
    const f = categoricalFactor(1, "cell line");
    expect(f.baseline_relevance).toBeUndefined();
    expect(factorRequiresBaseline(f)).toBe(false); // cell line in NO_BASELINE
    expect(factorBaselineBlocksCommit(f)).toBe(false);
  });
});

describe("isProtectedTagCategory — load-time invariants", () => {
  it("returns true for assay + technology type variants", () => {
    expect(isProtectedTagCategory("assay")).toBe(true);
    expect(isProtectedTagCategory("Assay")).toBe(true);
    expect(isProtectedTagCategory("ASSAY")).toBe(true);
    expect(isProtectedTagCategory("technology type")).toBe(true);
    expect(isProtectedTagCategory("Technology Type")).toBe(true);
    expect(isProtectedTagCategory("technology_type")).toBe(true);
    expect(isProtectedTagCategory("  assay  ")).toBe(true);
  });

  it("returns false for any other category label", () => {
    expect(isProtectedTagCategory("disease")).toBe(false);
    expect(isProtectedTagCategory("strain")).toBe(false);
    expect(isProtectedTagCategory("cell type")).toBe(false);
    expect(isProtectedTagCategory("organism part")).toBe(false);
  });

  it("treats null / undefined / empty as not protected", () => {
    expect(isProtectedTagCategory(null)).toBe(false);
    expect(isProtectedTagCategory(undefined)).toBe(false);
    expect(isProtectedTagCategory("")).toBe(false);
  });
});

describe("factorBaselineBlocksCommit — basic cases", () => {
  it("returns false for hard no-baseline categories", () => {
    expect(factorBaselineBlocksCommit(categoricalFactor(1, "block"))).toBe(false);
    expect(factorBaselineBlocksCommit(categoricalFactor(1, "batch"))).toBe(false);
    expect(factorBaselineBlocksCommit(categoricalFactor(1, "cell type"))).toBe(false);
    expect(factorBaselineBlocksCommit(categoricalFactor(1, "organism part"))).toBe(false);
  });

  it("returns true for normal categories — commit blocks on missing baseline", () => {
    expect(factorBaselineBlocksCommit(categoricalFactor(1, "treatment"))).toBe(true);
    expect(factorBaselineBlocksCommit(categoricalFactor(1, "genotype"))).toBe(true);
  });

  it("returns false for continuous factors", () => {
    expect(factorBaselineBlocksCommit(continuousFactor(1, "age"))).toBe(false);
  });
});

describe("validateDesign — continuous factor escape hatch", () => {
  it("skips unassigned_biomaterials check on continuous factors", () => {
    const f = continuousFactor(10, "age", [fv(1, "23.5", ["s1"])]);
    const design = emptyDesign({
      factors: [f],
      biomaterials: [
        { short_name: "s1", name: "s1", characteristics: {} },
        { short_name: "s2", name: "s2", characteristics: {} },
        { short_name: "s3", name: "s3", characteristics: {} },
      ],
    });
    const v = validateDesign(design);
    const state = v.factors.find((s) => s.factor_id === 10);
    // Categorical factor with only one sample assigned out of three
    // would flag s2 + s3 as unassigned. Continuous skips the check.
    expect(state?.unassigned_biomaterials).toEqual([]);
  });

  it("skips baseline_required on continuous factors", () => {
    const f = continuousFactor(10, "age", [fv(1, "23.5", ["s1"])]);
    const design = emptyDesign({ factors: [f] });
    const v = validateDesign(design);
    expect(v.factors[0].baseline_required).toBe(false);
  });

  it("still flags unassigned on a sibling categorical factor", () => {
    const cont = continuousFactor(10, "age", [fv(1, "23.5", ["s1"])]);
    const cat = categoricalFactor(11, "treatment", [
      fv(2, "drug", ["s1"]),
    ]);
    const design = emptyDesign({
      factors: [cont, cat],
      biomaterials: [
        { short_name: "s1", name: "s1", characteristics: {} },
        { short_name: "s2", name: "s2", characteristics: {} },
      ],
    });
    const v = validateDesign(design);
    const contState = v.factors.find((s) => s.factor_id === 10);
    const catState = v.factors.find((s) => s.factor_id === 11);
    expect(contState?.unassigned_biomaterials).toEqual([]);
    // s2 is still unassigned in the categorical "treatment" factor.
    expect(catState?.unassigned_biomaterials).toEqual(["s2"]);
  });

  it("a single continuous factor with partial coverage doesn't fail the design", () => {
    // Without the escape hatch this design would be invalid (s2 / s3
    // unassigned). With it, the only factor is fine.
    const cont = continuousFactor(10, "age", [fv(1, "23.5", ["s1"])]);
    const design = emptyDesign({
      factors: [cont],
      biomaterials: [
        { short_name: "s1", name: "s1", characteristics: {} },
        { short_name: "s2", name: "s2", characteristics: {} },
      ],
    });
    expect(validateDesign(design).ok).toBe(true);
  });
});
