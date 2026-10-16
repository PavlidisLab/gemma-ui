// The heatmap's cell-detail panel height (packages/heatmap/src/
// sidePanelHeight.ts). Lives here because the packages have no vitest
// run of their own.
import { describe, expect, it } from "vitest";
import {
  sidePanelMaxHeight,
  SIDE_PANEL_MARGIN as M,
  SIDE_PANEL_MIN_H as MIN,
} from "@gemma/heatmap";

const vh = 1000;

describe("sidePanelMaxHeight", () => {
  it("stops at a clipping card's bottom, even below the minimum", () => {
    // The 20-gene expression heatmap: a ~300px card that clips.
    expect(
      sidePanelMaxHeight({ top: 100, hardBottom: 400, softBottom: vh, viewportH: vh }),
    ).toBe(300 - M);
  });

  it("fills to the viewport bottom when nothing clips", () => {
    expect(
      sidePanelMaxHeight({ top: 300, hardBottom: Infinity, softBottom: vh, viewportH: vh }),
    ).toBe(700 - M);
  });

  it("keeps a usable height near the viewport bottom — the page can scroll to it", () => {
    expect(
      sidePanelMaxHeight({ top: 900, hardBottom: Infinity, softBottom: vh, viewportH: vh }),
    ).toBe(MIN);
  });

  it("never exceeds 80% of the viewport", () => {
    expect(
      sidePanelMaxHeight({ top: -500, hardBottom: Infinity, softBottom: vh, viewportH: vh }),
    ).toBe(800);
  });

  it("is never negative", () => {
    expect(
      sidePanelMaxHeight({ top: 100, hardBottom: 90, softBottom: vh, viewportH: vh }),
    ).toBe(0);
  });
});
