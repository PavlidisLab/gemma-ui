/**
 * Mirrors curation's `continuousFvValue.test.ts`, adapted to this app's
 * wire shape (`measurement.value`, `summary`, `characteristics`,
 * `statements`) instead of curation's (`numeric_value`,
 * `free_text_label`). Same bug, same fix, different field names.
 */
import { describe, expect, it } from "vitest";
import { continuousFvLabel, continuousFvNumeric } from "./continuousFv";

describe("continuousFvNumeric", () => {
  it("takes measurement.value over summary", () => {
    expect(
      continuousFvNumeric({ measurement: { value: "86" }, summary: "age: 86" }),
    ).toBe(86);
  });

  it("reads the value past the colon when summary is 'category: value'", () => {
    // The exact shape seen live on experiment 93630 / factor 74439:
    // measurement is absent, value/characteristics/statements are all
    // empty, and summary is Gemma's own "age: 13" rendering.
    expect(continuousFvNumeric({ summary: "age: 13" })).toBe(13);
    expect(
      continuousFvNumeric({ summary: "time post infection: 4.5" }),
    ).toBe(4.5);
  });

  it("does not lose a measurement to a unit suffix in free text", () => {
    expect(continuousFvNumeric({ summary: "86 years" })).toBe(86);
    expect(continuousFvNumeric({ summary: "12.5 mg/kg" })).toBe(12.5);
    expect(continuousFvNumeric({ summary: "-3.5 h" })).toBe(-3.5);
  });

  it("keeps a zero measurement, which is a value and not an absence", () => {
    expect(continuousFvNumeric({ measurement: { value: "0" } })).toBe(0);
  });

  it("falls back to a characteristic or statement subject", () => {
    expect(
      continuousFvNumeric({ characteristics: [{ value: "48" }] }),
    ).toBe(48);
    expect(
      continuousFvNumeric({ statements: [{ subject: "48" }] }),
    ).toBe(48);
  });

  it("returns null for a value nobody filled in", () => {
    expect(continuousFvNumeric({})).toBeNull();
    expect(continuousFvNumeric({ summary: "" })).toBeNull();
    expect(continuousFvNumeric({ summary: "not measured" })).toBeNull();
    expect(
      continuousFvNumeric({ measurement: { value: null }, summary: null }),
    ).toBeNull();
  });

  it("ignores an empty measurement.value rather than reading it as 0", () => {
    // Number("") is 0, not NaN — an empty string must not masquerade
    // as a real zero measurement.
    expect(
      continuousFvNumeric({ measurement: { value: "" }, summary: "age: 13" }),
    ).toBe(13);
  });
});

describe("continuousFvLabel", () => {
  it("renders the bare value, not Gemma's 'category: value' summary", () => {
    expect(
      continuousFvLabel({ measurement: { value: "13" }, summary: "age: 13" }),
    ).toBe("13");
    expect(continuousFvLabel({ summary: "age: 22" })).toBe("22");
  });

  it("appends the unit when measurement carries one", () => {
    expect(
      continuousFvLabel({ measurement: { value: "12.5", unit: "mg/kg" } }),
    ).toBe("12.5 mg/kg");
  });

  it("returns null when nothing parses, so callers keep their own fallback", () => {
    expect(continuousFvLabel({ summary: "not measured" })).toBeNull();
  });
});
