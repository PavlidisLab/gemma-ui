/**
 * Row ordering for the heatmap — the permutation, not the picture.
 *
 * Lives here rather than in `packages/heatmap/` because neither app's
 * vitest run reaches that directory (see `columnOrder.test.ts`, which
 * nothing executes); the browser app is where these heatmaps ship.
 */

import { describe, it, expect } from "vitest";
import { computeRowOrder, type CellValue } from "@gemma/heatmap";

/** Three rows that move together and two that move against them. */
const CO_EXPRESSED: CellValue[][] = [
  [1, 2, 3, 4, 5], // A ─┐
  [9, 1, 1, 1, 1], // B   against
  [2, 4, 6, 8, 10], // C ─┘ with A
  [9, 2, 1, 1, 1], // D   against, like B
  [3, 6, 9, 12, 15], // E ─┘ with A
];

describe("computeRowOrder", () => {
  it("leaves the order alone in 'none'", () => {
    expect(computeRowOrder("none", CO_EXPRESSED)).toEqual([0, 1, 2, 3, 4]);
  });

  it("puts co-expressed rows next to each other when clustering", () => {
    const order = computeRowOrder("cluster", CO_EXPRESSED);
    const at = (row: number) => order.indexOf(row);
    // A, C, E rise together; B and D fall. Whichever block leads, each
    // block is contiguous.
    const rising = [at(0), at(2), at(4)].sort((x, y) => x - y);
    const falling = [at(1), at(3)].sort((x, y) => x - y);
    expect(rising[2] - rising[0]).toBe(2);
    expect(falling[1] - falling[0]).toBe(1);
  });

  it("returns every row exactly once", () => {
    for (const mode of ["cluster", "expression", "label", "none"] as const) {
      const order = computeRowOrder(mode, CO_EXPRESSED, [
        "z",
        "a",
        "m",
        undefined,
        "b",
      ]);
      expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    }
  });

  it("sorts by row mean, highest first", () => {
    const values: CellValue[][] = [
      [1, 1, 1], // mean 1
      [5, 5, 5], // mean 5
      [3, 3, 3], // mean 3
    ];
    expect(computeRowOrder("expression", values)).toEqual([1, 2, 0]);
  });

  it("sorts by label, naturally, with unlabelled rows last", () => {
    const values: CellValue[][] = [[1], [1], [1], [1]];
    const order = computeRowOrder("label", values, [
      "GENE10",
      "GENE2",
      undefined,
      "gene1",
    ]);
    // Natural compare puts GENE2 before GENE10, case-insensitively;
    // the unlabelled row sinks.
    expect(order).toEqual([3, 1, 0, 2]);
  });

  it("ignores nulls rather than letting one poison a row", () => {
    const values: CellValue[][] = [
      [1, null, 3],
      [9, 9, null],
    ];
    expect(computeRowOrder("expression", values)).toEqual([1, 0]);
  });

  it("falls back to expression order past the cluster cap", () => {
    // 401 rows, descending means — clustering declines, so the result
    // must be the plain expression sort.
    const values: CellValue[][] = Array.from({ length: 401 }, (_, i) => [
      401 - i,
      401 - i,
    ]);
    const order = computeRowOrder("cluster", values);
    expect(order.slice(0, 3)).toEqual([0, 1, 2]);
    expect(order.length).toBe(401);
  });

  it("handles a single row and an empty matrix", () => {
    expect(computeRowOrder("cluster", [[1, 2, 3]])).toEqual([0]);
    expect(computeRowOrder("cluster", [])).toEqual([]);
  });
});
