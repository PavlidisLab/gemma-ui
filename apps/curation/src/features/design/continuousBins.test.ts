/**
 * Binning for the continuous-factor plot.
 *
 * The case that prompted this: `age`, n=40, 17–743, four distinct
 * values. Under the old `ceil(sqrt(n))` rule that is 7 bins, three of
 * them empty, and the chart read as "four clusters" when it meant "the
 * bins are too wide to say anything".
 */
import { describe, expect, it } from "vitest";
import { binCountFor } from "./ContinuousFactorView";

describe("binCountFor", () => {
  it("gives the age case far more than the 7 it had", () => {
    expect(binCountFor(40)).toBe(15);
    // The rule it replaced, for the record.
    expect(Math.ceil(Math.sqrt(40))).toBe(7);
  });

  it("never returns so few that one bar spans the data", () => {
    // The floor is the point — a small n must not produce a handful of
    // enormous buckets.
    for (const n of [1, 2, 5, 12, 30, 56]) {
      expect(binCountFor(n)).toBeGreaterThanOrEqual(15);
    }
  });

  it("never returns so many that bars are invisible", () => {
    for (const n of [400, 5_000, 100_000]) {
      expect(binCountFor(n)).toBeLessThanOrEqual(40);
    }
  });

  it("grows with n between the floor and the cap", () => {
    expect(binCountFor(100)).toBe(20);
    expect(binCountFor(225)).toBe(30);
    expect(binCountFor(100)).toBeLessThan(binCountFor(225));
  });

  it("is a whole number for every n", () => {
    for (const n of [3, 7, 41, 99, 1001]) {
      expect(Number.isInteger(binCountFor(n))).toBe(true);
    }
  });
});
