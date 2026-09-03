/**
 * Reading a continuous strip's values off a tooltip.
 *
 * 🛑 The exponent is shared across the FACTOR, not chosen per value.
 * Read depth runs to eight digits, and `6934029` beside `10248117` is a
 * comparison of digit counts before it is a comparison of quantities.
 * Per-value `toExponential` does not fix that — `6.93e6` beside
 * `1.02e7` moves the exponent too, so the mantissas still cannot be
 * compared at a glance. Pin it and the mantissa carries the signal.
 */
import { describe, expect, it } from "vitest";
import { continuousFormatterFor } from "@gemma/heatmap";

const factor = (measurements: Record<number, number>) =>
  ({
    id: -1,
    name: "Reads",
    type: "continuous" as const,
    category: { label: "Reads", uri: null },
    factor_values: [],
    continuousMeasurements: measurements,
  }) as never;
const cols = (ids: number[]) =>
  ids.map((id) => ({ bioAssayId: id, name: `s${id}`, factorValueIds: {} })) as never;

describe("continuousFormatterFor", () => {
  it("gives every value in a factor the SAME exponent", () => {
    // The case Paul hit: two read counts an order of magnitude apart.
    const f = continuousFormatterFor(
      factor({ 1: 6934029, 2: 10248117 }),
      cols([1, 2]),
    );
    expect(f(6934029)).toBe("6.93 × 10⁶");
    expect(f(10248117)).toBe("10.25 × 10⁶");
  });

  it("does not dress up numbers a person already reads", () => {
    // A percentage, an age, a timepoint: an exponent would be noise.
    const f = continuousFormatterFor(factor({ 1: 51.07, 2: 60.6 }), cols([1, 2]));
    expect(f(51.07)).toBe("51.07");
    expect(f(60.6)).toBe("60.60");
    expect(continuousFormatterFor(factor({ 1: 12, 2: 48 }), cols([1, 2]))(48)).toBe("48");
  });

  it("reaches for the exponent at the bottom of the range too", () => {
    const f = continuousFormatterFor(
      factor({ 1: 0.000_004_2, 2: 0.000_000_9 }),
      cols([1, 2]),
    );
    expect(f(0.0000042)).toBe("4.20 × 10⁻⁶");
    expect(f(0.0000009)).toBe("0.90 × 10⁻⁶");
  });

  it("survives a factor with no measurement at all", () => {
    const f = continuousFormatterFor(factor({}), cols([1, 2]));
    expect(f(7)).toBe("7");
  });
});
