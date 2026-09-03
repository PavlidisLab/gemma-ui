/**
 * Grouping by a CONTINUOUS factor.
 *
 * 🛑 `packages/heatmap` has its own `columnOrder.test.ts`, and the app
 * suite does not run it — the curation vitest config only globs `src`.
 * This case lives here so it actually runs in CI, because the bug it
 * pins was invisible from either side alone: the continuous branch was
 * reachable only when a dataset had NO usable categorical factor, and
 * every fixture in the package's own test had one.
 *
 * Symptom: picking "PC1 score" or `age` as the grouping reordered the
 * columns categorically and silently ignored the factor just chosen.
 */
import { describe, expect, it } from "vitest";
import { computeColumnOrder } from "@gemma/heatmap";

const AGE = {
  id: 7,
  name: "age",
  type: "continuous" as const,
  category: { label: "age", uri: null },
  factor_values: [],
  continuousMeasurements: { 101: 40, 102: 10, 103: 30, 104: 20 } as Record<number, number>,
};
/** A perfectly ordinary categorical factor, present in almost every
 *  real design — and the thing that used to shadow the continuous
 *  branch entirely. */
const TREATMENT = {
  id: 3,
  name: "treatment",
  type: "categorical" as const,
  category: { label: "treatment", uri: null },
  factor_values: [
    { id: 31, free_text_label: "ctrl", is_baseline: true },
    { id: 32, free_text_label: "drug", is_baseline: false },
  ],
};
const columns = [101, 102, 103, 104].map((id, i) => ({
  bioAssayId: id,
  name: `s${id}`,
  factorValueIds: { 3: i % 2 === 0 ? 31 : 32 } as Record<number, number>,
}));

const payload = (factors: unknown[]) =>
  ({ rows: [], columns, factors } as never);

describe("computeColumnOrder with a continuous grouping factor", () => {
  it("sorts by the measurement even when a categorical factor exists", () => {
    const { columnOrder } = computeColumnOrder(payload([TREATMENT, AGE]), AGE.id);
    // ages 40, 10, 30, 20 → ascending is indices 1, 3, 2, 0.
    expect(columnOrder).toEqual([1, 3, 2, 0]);
  });

  it("still sorts by it when no categorical factor is present at all", () => {
    const { columnOrder } = computeColumnOrder(payload([AGE]), AGE.id);
    expect(columnOrder).toEqual([1, 3, 2, 0]);
  });

  it("draws no group gaps — a continuous axis has no buckets to separate", () => {
    const { gaps } = computeColumnOrder(payload([TREATMENT, AGE]), AGE.id);
    expect(gaps.every((g) => g === 0)).toBe(true);
  });

  it("puts samples with no measurement last, not first", () => {
    // Null sorts after every number: an unmeasured sample is unknown,
    // and unknown is not the bottom of the scale.
    const partial = { ...AGE, continuousMeasurements: { 101: 40, 103: 30 } };
    const { columnOrder } = computeColumnOrder(payload([partial]), partial.id);
    expect(columnOrder.slice(0, 2)).toEqual([2, 0]);
    expect(columnOrder.slice(2).sort()).toEqual([1, 3]);
  });

  it("leaves a categorical grouping alone", () => {
    const { columnOrder } = computeColumnOrder(
      payload([TREATMENT, AGE]),
      TREATMENT.id,
    );
    // Baseline bucket first: even indices carry fv 31.
    expect(columnOrder.slice(0, 2).sort()).toEqual([0, 2]);
  });
});
