import { describe, expect, it } from "vitest";
import {
  previewOf,
  resolveOrientationText,
} from "./OrientationProse";

/**
 * Contract tests for the OrientationProse slot.
 *
 * The component itself is a presentational React function — its
 * branches are:
 *   1. null / undefined / empty / whitespace → return null
 *      (slot suppresses).
 *   2. text ≤ collapseChars → render as-is.
 *   3. text > collapseChars → render a preview + "show more".
 *
 * (1) is owned by ``resolveOrientationText`` — pure, unit-tested
 *     here.
 * (2) and (3) are render-mode concerns; (3)'s preview shape is
 *     owned by ``previewOf``, also pure and tested here.
 */

describe("previewOf", () => {
  it("returns the text unchanged when it fits the budget", () => {
    expect(previewOf("short text", 100)).toBe("short text");
  });

  it("cuts at a word boundary when one falls in the back-half of the budget", () => {
    const text = "one two three four five six seven eight nine ten";
    const cut = previewOf(text, 20);
    expect(cut).toBe("one two three four");
    expect(cut.endsWith(" ")).toBe(false);
    // back-half rule: lastSpace > budget * 0.6 = 12; first space
    // beyond char-20 sits at "four|five" boundary → cut earlier.
  });

  it("falls back to a hard cut when no whitespace lands in the back-half", () => {
    // Long unbroken token followed by a short trailing — the only
    // space sits in the front-half of the budget, so the back-half
    // rule fails and the hard cut wins.
    const text = "a thisisaverylongunbrokenword";
    const cut = previewOf(text, 10);
    expect(cut).toBe("a thisisav");
  });

  it("never returns more than budget characters", () => {
    const text = "x".repeat(1000);
    const cut = previewOf(text, 100);
    expect(cut.length).toBeLessThanOrEqual(100);
  });
});

describe("resolveOrientationText — empty-state suppression", () => {
  it("returns null for null input", () => {
    expect(resolveOrientationText(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(resolveOrientationText(undefined)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(resolveOrientationText("")).toBeNull();
  });

  it("returns null for whitespace-only input", () => {
    expect(resolveOrientationText("   \n\t  ")).toBeNull();
  });

  it("returns the trimmed text when it has content", () => {
    expect(resolveOrientationText("  hello world  ")).toBe("hello world");
  });
});
