import { describe, expect, it } from "vitest";
import { augmentInferredFromFactors } from "./augmentFactorTags";
import type { Factor, Tag } from "@/features/experiment/types";

/**
 * Tests for the factor→inferred-tag projection. It should:
 *   1. Synth one chip per CATEGORICAL factor, distinct FV labels
 *      comma-joined + sorted.
 *   2. De-duplicate FV labels (a treatment factor with several DMSO
 *      arms must not repeat the "DMSO" chip once per arm).
 *   3. SKIP continuous factors entirely — their per-sample numeric
 *      measurements don't belong in the tag row (design review 2026-07-21).
 *   4. Pass direct tags through untouched.
 */

function factor(overrides: Partial<Factor>): Factor {
  return {
    id: 1,
    name: "f",
    category: { label: "treatment", uri: "http://x/EFO_0000727" },
    type: "categorical",
    factor_values: [],
    ...overrides,
  } as Factor;
}

const fv = (free_text_label: string) =>
  ({ id: 0, free_text_label, biomaterial_short_names: [], statements: [] }) as any;

describe("augmentInferredFromFactors", () => {
  it("de-duplicates repeated FV labels into a single chip value", () => {
    const f = factor({
      factor_values: [fv("DMSO"), fv("DMSO"), fv("DMSO"), fv("TCDD"), fv("TCDD")],
    });
    const out = augmentInferredFromFactors([], [f]);
    expect(out).toHaveLength(1);
    // sorted, unique
    expect(out[0].value.label).toBe("DMSO, TCDD");
    expect(out[0].inferred).toBe(true);
    expect(out[0].inferred_source).toBe("FactorValue");
  });

  it("skips continuous factors entirely (no numeric-measurement chips)", () => {
    const cont = factor({
      category: { label: "expression level", uri: null },
      type: "continuous",
      factor_values: [fv("1.691"), fv("1.973"), fv("2.198"), fv("2.428")],
    });
    const out = augmentInferredFromFactors([], [cont]);
    expect(out).toHaveLength(0);
  });

  it("keeps categorical factors while dropping continuous ones in the same design", () => {
    const cat = factor({ factor_values: [fv("DMSO"), fv("TCDD")] });
    const cont = factor({
      id: 2,
      category: { label: "age", uri: null },
      type: "continuous",
      factor_values: [fv("3.4"), fv("5.1")],
    });
    const out = augmentInferredFromFactors([], [cat, cont]);
    expect(out).toHaveLength(1);
    expect(out[0].category.label).toBe("treatment");
  });

  it("passes direct tags through untouched", () => {
    const direct: Tag = {
      id: 9,
      category: { label: "genotype", uri: null },
      value: { label: "Trp53", uri: null },
    };
    const out = augmentInferredFromFactors([direct], []);
    expect(out).toEqual([direct]);
  });
});
