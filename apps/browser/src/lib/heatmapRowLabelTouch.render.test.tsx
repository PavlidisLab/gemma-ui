/**
 * @vitest-environment jsdom
 *
 * The heatmap row-label popover (`packages/heatmap/src/Heatmap.tsx`)
 * used to open only on `mouseenter` — unreachable on a touch device,
 * which has no hover. Chrome Android confirmed it: tapping a row label
 * on the dataset Visualize tab did nothing at all.
 *
 * A tap dispatches `click`, not `mouseenter`, so the fix is a tap
 * handler that opens the same popover. These specs pin that a `click`
 * opens it, a second `click` on the same row closes it, and a tap
 * elsewhere (no `mouseleave` exists to catch this on touch) also
 * closes it — the three things a touch user needs and a mouse user
 * already had some way to do.
 */
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Heatmap } from "@gemma/heatmap";
import type { HeatmapData } from "@gemma/heatmap";

const DATA: HeatmapData = {
  values: [
    [0, 1],
    [1, 0],
  ],
  rowLabels: ["row-a", "row-b"],
};

function renderHeatmap() {
  return render(
    <Heatmap
      data={DATA}
      rowLabelTooltip={(i) => <div>tooltip for row {i}</div>}
    />,
  );
}

describe("heatmap row-label popover on tap", () => {
  it("opens on click (no hover needed)", () => {
    renderHeatmap();
    fireEvent.click(screen.getByText("row-a"));
    expect(screen.getByText("tooltip for row 0")).toBeInTheDocument();
  });

  it("closes on a second tap of the same row", () => {
    renderHeatmap();
    const row = screen.getByText("row-a");
    fireEvent.click(row);
    expect(screen.getByText("tooltip for row 0")).toBeInTheDocument();
    fireEvent.click(row);
    expect(screen.queryByText("tooltip for row 0")).not.toBeInTheDocument();
  });

  it("switches to the tapped row without needing to close first", () => {
    renderHeatmap();
    fireEvent.click(screen.getByText("row-a"));
    fireEvent.click(screen.getByText("row-b"));
    expect(screen.queryByText("tooltip for row 0")).not.toBeInTheDocument();
    expect(screen.getByText("tooltip for row 1")).toBeInTheDocument();
  });

  it("closes on a tap outside the heatmap — touch has no mouseleave to catch this", () => {
    renderHeatmap();
    fireEvent.click(screen.getByText("row-a"));
    expect(screen.getByText("tooltip for row 0")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByText("tooltip for row 0")).not.toBeInTheDocument();
  });
});
