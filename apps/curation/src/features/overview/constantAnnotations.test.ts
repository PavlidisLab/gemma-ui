import { describe, expect, it } from "vitest";
import {
  buildConstancyIndex,
  constantCharacteristicCategories,
  constantFactorCategories,
  isVariableInferredTag,
} from "./constantAnnotations";
import type { Biomaterial, Factor, Tag } from "@/features/experiment/types";

/**
 * GSE41840 is the case that prompted this: 132 samples, and of the
 * inherited annotations only `labelling: biotin` and `molecular
 * entity: total RNA` are true of the experiment. Six radiation doses,
 * six timepoints and twelve individuals are the design.
 */
const bm = (n: number, chars: Record<string, string>): Biomaterial =>
  ({ short_name: `S${n}`, name: `Sample ${n}`, characteristics: chars }) as Biomaterial;

const COHORT: Biomaterial[] = [
  bm(1, { labelling: "biotin", treatment: "0 Gy", individual: "20" }),
  bm(2, { labelling: "biotin", treatment: "10 Gy", individual: "20" }),
  bm(3, { labelling: "biotin", treatment: "2 Gy", individual: "21" }),
];

const tag = (
  cat: string,
  val: string,
  inferred: boolean,
  source = "BioMaterial",
): Tag =>
  ({
    id: 1,
    category: { label: cat, uri: null },
    value: { label: val, uri: null },
    inferred,
    inferred_source: source,
  }) as Tag;

describe("constantCharacteristicCategories", () => {
  it("keeps the category every sample carries with one value", () => {
    expect([...constantCharacteristicCategories(COHORT)]).toEqual(["labelling"]);
  });

  it("rejects a single-valued characteristic that's missing on some samples", () => {
    // Present once, one value — but not true of the cohort.
    const partial = [...COHORT, bm(4, { labelling: "biotin", strain: "B6" })];
    expect(constantCharacteristicCategories(partial).has("strain")).toBe(false);
  });

  it("returns nothing when there are no biomaterials to count", () => {
    expect(constantCharacteristicCategories([]).size).toBe(0);
    expect(constantCharacteristicCategories(undefined).size).toBe(0);
  });
});

describe("constantFactorCategories", () => {
  const factor = (cat: string, fvs: string[][]): Factor =>
    ({
      id: 1,
      name: cat,
      description: "",
      type: "categorical",
      category: { label: cat, uri: null },
      factor_values: fvs.map((names, i) => ({
        id: i,
        free_text_label: `fv${i}`,
        is_baseline: false,
        statements: [],
        biomaterial_short_names: names,
      })),
    }) as Factor;

  it("counts a one-level factor covering every sample as constant", () => {
    const f = factor("protocol", [["S1", "S2", "S3"]]);
    expect([...constantFactorCategories([f], 3)]).toEqual(["protocol"]);
  });

  it("treats a real multi-level factor as varying", () => {
    const f = factor("treatment", [["S1"], ["S2", "S3"]]);
    expect(constantFactorCategories([f], 3).size).toBe(0);
  });

  it("treats a one-level factor that misses samples as varying", () => {
    const f = factor("treatment", [["S1", "S2"]]);
    expect(constantFactorCategories([f], 3).size).toBe(0);
  });
});

describe("isVariableInferredTag", () => {
  const index = buildConstancyIndex(COHORT, []);

  it("hides an inherited characteristic that varies", () => {
    expect(isVariableInferredTag(tag("treatment", "0 Gy, 10 Gy", true), index))
      .toBe(true);
    expect(isVariableInferredTag(tag("individual", "20, 21", true), index))
      .toBe(true);
  });

  it("keeps an inherited characteristic every sample carries", () => {
    expect(isVariableInferredTag(tag("labelling", "biotin", true), index))
      .toBe(false);
  });

  it("never calls a DIRECT tag a variable", () => {
    // A curator attaching an EE-tag asserts it of the whole
    // experiment; the filter must not touch their work.
    expect(isVariableInferredTag(tag("treatment", "0 Gy", false), index))
      .toBe(false);
  });

  it("keeps anything it cannot prove varies", () => {
    const noCohort = buildConstancyIndex([], []);
    expect(isVariableInferredTag(tag("treatment", "0 Gy", true), noCohort))
      .toBe(false);
    // Unrecognised inferred_source — no coverage to check against.
    expect(
      isVariableInferredTag(tag("treatment", "0 Gy", true, "Mystery"), index),
    ).toBe(false);
  });
});
