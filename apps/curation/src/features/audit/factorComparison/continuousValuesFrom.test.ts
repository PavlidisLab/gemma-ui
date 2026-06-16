import { describe, expect, it } from "vitest";
import { continuousValuesFrom } from "./ContinuousStrip";

/**
 * Contract tests for ``continuousValuesFrom`` — the priority-ordered
 * numeric extractor used to build the rug-plot inputs for
 * ``ContinuousStrip``.
 *
 * Priority order (highest → lowest):
 *   1. ``numeric_value`` (agent's continuous_populator output)
 *   2. ``measurement.value`` (real Gemma's FV shape)
 *   3. ``free_text_label`` leading numeric regex
 *
 * ``n_samples`` falls back: ``biomaterial_short_names.length ?? 1``.
 */

describe("continuousValuesFrom — numeric extraction priority order", () => {
  it("null / undefined input → empty array", () => {
    expect(continuousValuesFrom(null)).toEqual([]);
    expect(continuousValuesFrom(undefined)).toEqual([]);
  });

  it("empty array input → empty array", () => {
    expect(continuousValuesFrom([])).toEqual([]);
  });

  it("FV with numeric_value=12.5 returns 12.5", () => {
    const result = continuousValuesFrom([{ numeric_value: 12.5 }]);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(12.5);
  });

  it("FV with numeric_value=0 (falsy but valid number) returns 0", () => {
    const result = continuousValuesFrom([{ numeric_value: 0 }]);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(0);
  });

  it("FV with numeric_value as string '7.3' is parsed and returned", () => {
    const result = continuousValuesFrom([{ numeric_value: "7.3" }]);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBeCloseTo(7.3);
  });

  it("numeric_value takes priority over measurement.value", () => {
    const result = continuousValuesFrom([{
      numeric_value: 12.5,
      measurement: { value: "99" },
      free_text_label: "999 µM",
    }]);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(12.5);
  });

  it("FV with measurement={value:'7'} returns 7 when no numeric_value", () => {
    const result = continuousValuesFrom([{
      numeric_value: null,
      measurement: { value: "7" },
    }]);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(7);
  });

  it("measurement.value takes priority over free_text_label regex", () => {
    const result = continuousValuesFrom([{
      numeric_value: null,
      measurement: { value: "42" },
      free_text_label: "999 units",
    }]);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(42);
  });

  it("FV with free_text_label 'rotenone 3.5 µM' extracts 3.5", () => {
    // The regex anchors at the start of the label, so "rotenone 3.5 µM"
    // has no leading digit — expects null. Test the correct leading form.
    const result = continuousValuesFrom([{
      numeric_value: null,
      measurement: null,
      free_text_label: "3.5 µM rotenone",
    }]);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBeCloseTo(3.5);
  });

  it("free_text_label with leading negative number extracts correctly", () => {
    const result = continuousValuesFrom([{
      numeric_value: null,
      measurement: null,
      free_text_label: "-2.7 degrees",
    }]);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBeCloseTo(-2.7);
  });

  it("FV with no numeric anywhere is EXCLUDED from the result (not null, not in array)", () => {
    const result = continuousValuesFrom([{
      numeric_value: null,
      measurement: null,
      free_text_label: "control",
    }]);
    // The non-numeric FV must be excluded entirely — not an array of nulls.
    expect(result).toHaveLength(0);
  });

  it("FV with no fields at all is excluded", () => {
    const result = continuousValuesFrom([{}]);
    expect(result).toHaveLength(0);
  });

  it("n_samples falls back to biomaterial_short_names.length when available", () => {
    const result = continuousValuesFrom([{
      numeric_value: 5,
      biomaterial_short_names: ["GSM1", "GSM2", "GSM3"],
    }]);
    expect(result[0].n_samples).toBe(3);
  });

  it("n_samples falls back to 1 when biomaterial_short_names is absent", () => {
    const result = continuousValuesFrom([{ numeric_value: 5 }]);
    expect(result[0].n_samples).toBe(1);
  });

  it("n_samples is 0 when biomaterial_short_names is an empty array (length=0, not null)", () => {
    // The fallback is `?? 1` which only triggers on null/undefined.
    // An empty array has length 0, which is falsy but not null/undefined,
    // so n_samples reflects the actual array length (0), not the fallback (1).
    const result = continuousValuesFrom([{
      numeric_value: 5,
      biomaterial_short_names: [],
    }]);
    expect(result[0].n_samples).toBe(0);
  });

  it("mixed list preserves FV order — numeric and non-numeric interleaved", () => {
    const result = continuousValuesFrom([
      { numeric_value: 1.0 },
      { free_text_label: "control" },  // no numeric → excluded
      { measurement: { value: "3.0" } },
      { free_text_label: "5.0 mg/kg" },
    ]);
    // Items 0, 2, 3 survive in original order; item 1 is excluded.
    expect(result).toHaveLength(3);
    expect(result[0].value).toBe(1.0);
    expect(result[1].value).toBe(3.0);
    expect(result[2].value).toBeCloseTo(5.0);
  });

  it("free_text_label text that starts with a word (not digit) yields no extraction", () => {
    // The regex /^(-?\d+(?:\.\d+)?)\b/ requires a leading digit or minus-digit.
    const result = continuousValuesFrom([{
      numeric_value: null,
      measurement: null,
      free_text_label: "rotenone 3.5 µM",
    }]);
    // "rotenone" starts the label — no leading number → excluded.
    expect(result).toHaveLength(0);
  });

  it("Infinity / NaN numeric_value is treated as invalid and not extracted", () => {
    const result = continuousValuesFrom([
      { numeric_value: Infinity },
      { numeric_value: NaN },
      { numeric_value: 42 },
    ]);
    // Only the finite 42 should survive.
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(42);
  });
});
