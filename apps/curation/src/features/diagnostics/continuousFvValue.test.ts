/**
 * 🛑 This exists because reading the human label first is a silent,
 * plausible way to lose a measurement.
 *
 * A continuous factor value carries BOTH `numeric_value` (Gemma's
 * `FactorValue.measurement.value`, filled by `composeDesign`) and
 * `free_text_label`, which is that same quantity rendered for a
 * person — "86 years", not "86". `Number("86 years")` is NaN, so a
 * parser that reaches for the label first turns every measured value
 * into a missing one and the factor scores zero against every PC
 * without anything reporting an error.
 */
import { describe, expect, it } from "vitest";
import { continuousFvValue } from "./heatmapPayload";

describe("continuousFvValue", () => {
  it("takes the measurement over the human rendering of it", () => {
    expect(
      continuousFvValue({ numeric_value: 86, free_text_label: "86 years" }),
    ).toBe(86);
  });

  it("does not lose a measurement to a unit suffix", () => {
    // The exact shape that scored NaN before.
    expect(continuousFvValue({ free_text_label: "86 years" })).toBe(86);
    expect(continuousFvValue({ free_text_label: "12.5 mg/kg" })).toBe(12.5);
    expect(continuousFvValue({ free_text_label: "-3.5 h" })).toBe(-3.5);
  });

  it("keeps a zero measurement, which is a value and not an absence", () => {
    expect(continuousFvValue({ numeric_value: 0, free_text_label: "0 h" })).toBe(0);
  });

  it("falls back to the statement subject when there is no label", () => {
    expect(
      continuousFvValue({ statements: [{ subject: { label: "48" } }] }),
    ).toBe(48);
  });

  it("returns null for a value nobody filled in", () => {
    // Null, not 0 — the strip must read as unassigned rather than as
    // the bottom of the scale.
    expect(continuousFvValue({})).toBeNull();
    expect(continuousFvValue({ free_text_label: "" })).toBeNull();
    expect(continuousFvValue({ free_text_label: "not measured" })).toBeNull();
    expect(continuousFvValue({ numeric_value: null, free_text_label: null })).toBeNull();
  });

  it("ignores a non-finite measurement rather than passing NaN on", () => {
    expect(continuousFvValue({ numeric_value: NaN, free_text_label: "7 d" })).toBe(7);
  });
});
