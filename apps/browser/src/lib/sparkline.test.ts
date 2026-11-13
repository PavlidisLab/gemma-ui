// The cell-detail sparkline's geometry (packages/heatmap/src/
// sparkline.ts). Lives here because the packages have no vitest run of
// their own.
import { describe, expect, it } from "vitest";
import { sparklineGeometry } from "@gemma/heatmap";

// Width 4 over 5 columns puts column i at x = i; height 10 over the
// range 0..10 puts value v at y = 10 - v.
const geom = (values: Array<number | null>) => sparklineGeometry(values, 4, 10);

describe("sparklineGeometry", () => {
  it("draws one unbroken line when nothing is missing", () => {
    expect(geom([0, 5, 10, 5, 0])?.d).toBe(
      "M0.0,10.0 L1.0,5.0 L2.0,0.0 L3.0,5.0 L4.0,10.0",
    );
  });

  it("lifts the pen over an NA instead of bridging it", () => {
    const g = geom([0, 5, null, 5, 10]);
    expect(g?.d).toBe("M0.0,10.0 L1.0,5.0 M3.0,5.0 L4.0,0.0");
    expect(g?.dots).toEqual([]);
  });

  it("draws a value with NAs on both sides as a dot", () => {
    const g = geom([0, null, 5, null, 10]);
    expect(g?.d).toBe("");
    expect(g?.dots).toEqual([
      [0, 10],
      [2, 5],
      [4, 0],
    ]);
  });

  it("keeps NA columns in the x scale", () => {
    expect(geom([null, 0, 10, null, null])?.sx(2)).toBe(2);
  });

  it("has nothing to plot with fewer than two finite values", () => {
    expect(geom([null, 3, null, NaN, null])).toBeNull();
  });
});
