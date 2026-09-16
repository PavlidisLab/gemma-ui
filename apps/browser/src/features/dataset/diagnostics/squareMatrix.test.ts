/**
 * `square: true` must produce a square MATRIX for an N×N input, not
 * just square cells.
 *
 * The two axes size differently: `matrixW = cellW * columns.length`
 * (rendered columns, after merging) but `matrixH = cellH * numRows`
 * (always every row). With a shared side length that only comes out
 * square when nothing merged — so the sample-correlation panel, whose
 * 417×417 matrix merged columns down to fit a ~275px card, rendered
 * narrow and tall.
 *
 * Lives here rather than in `packages/heatmap/` because neither app's
 * vitest run reaches that directory (see `columnOrder.test.ts`, which
 * nothing executes); the browser app is the consumer these panels
 * ship in.
 */

import { describe, it, expect } from "vitest";
import { resolveConfig, computeLayout, type HeatmapData } from "@gemma/heatmap";

function nxn(n: number): HeatmapData {
  return {
    values: Array.from({ length: n }, () =>
      Array.from({ length: n }, () => 0.5),
    ),
  };
}

const CELL = { maxHeight: 12, maxWidth: 12 } as const;

describe("square heatmap layout", () => {
  it("renders an N×N matrix square in a box narrower than N cells", () => {
    const data = nxn(417);
    const config = resolveConfig(data, { square: true, fit: "fit", cell: CELL });
    const layout = computeLayout(data, config, 275, 420);

    expect(layout.cellW).toBeCloseTo(layout.cellH, 6);
    expect(layout.columns.length).toBe(417);
    expect(layout.matrixW).toBeCloseTo(layout.matrixH, 6);
  });

  it("keeps the square matrix inside both box axes", () => {
    const data = nxn(417);
    const config = resolveConfig(data, { square: true, fit: "fit", cell: CELL });
    const layout = computeLayout(data, config, 275, 420);

    expect(layout.matrixW).toBeLessThanOrEqual(275 + 0.001);
    expect(layout.matrixH).toBeLessThanOrEqual(420 + 0.001);
  });

  it("still caps cells at maxHeight when the box is roomy", () => {
    const data = nxn(8);
    const config = resolveConfig(data, { square: true, fit: "fit", cell: CELL });
    const layout = computeLayout(data, config, 600, 600);

    expect(layout.cellW).toBeLessThanOrEqual(12);
    expect(layout.matrixW).toBeCloseTo(layout.matrixH, 6);
  });

  it("leaves non-square layouts merging columns as before", () => {
    const data = nxn(417);
    const config = resolveConfig(data, { fit: "fit", cell: CELL });
    const layout = computeLayout(data, config, 275, 420);

    expect(layout.columns.length).toBeLessThan(417);
  });
});
