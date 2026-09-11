/**
 * @vitest-environment jsdom
 *
 * `HeatmapWidget`'s cell-size caps against a caller that computes them
 * late.
 *
 * The sample-correlation cards measure their box and divide by the
 * sample count to get a cell size, so the value they pass arrives one
 * or two renders after mount — the measurement is 0 on the first one.
 * The caps are also user-adjustable from the Options popover, so the
 * widget has to take a changed prop without overwriting an adjustment
 * the user made.
 *
 * The widget's chrome footer prints `cell=HxWpx` straight off the two
 * state values, which is what these read.
 *
 * jsdom has no canvas backend, so a no-op 2D context is installed here
 * — `renderMatrix` throws on a null one. Nothing in this file draws
 * anything, so no size in it is verified against pixels.
 */
import { describe, expect, it, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { HeatmapWidget } from "@gemma/heatmap";

/** A 2x2 correlation matrix — enough for a real grid, small enough to
 *  read. */
const DATA = { values: [[1, 0.9], [0.9, 1]] };

beforeAll(() => {
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k) => (k in t ? t[k as string] : () => undefined),
    set: (t, k, v) => {
      t[k as string] = v;
      return true;
    },
  });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
});

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The footer readout, e.g. `cell=12×13px`. */
function cellReadout(container: HTMLElement): string {
  const hit = [...container.querySelectorAll("span")].find((s) =>
    /^cell=/.test(s.textContent ?? ""),
  );
  return hit?.textContent ?? "";
}

/** The Cell H / Cell W sliders, told apart by their ranges — Cell H
 *  tops out at 36 and Cell W at 48. */
function cellSlider(container: HTMLElement, axis: "h" | "w"): HTMLInputElement {
  return container.querySelector(
    `input[type="range"][max="${axis === "h" ? 36 : 48}"]`,
  ) as HTMLInputElement;
}

describe("HeatmapWidget cell caps", () => {
  it("adopts a cap the caller computes after the first render", () => {
    const { container, rerender } = render(
      <HeatmapWidget data={DATA} defaultMaxHeight={12} defaultMaxWidth={13} />,
    );
    expect(cellReadout(container)).toBe("cell=12×13px");

    // The caller measured its box and divided: this is the value the
    // cells have to take.
    rerender(
      <HeatmapWidget data={DATA} defaultMaxHeight={204} defaultMaxWidth={204} />,
    );
    expect(cellReadout(container)).toBe("cell=204×204px");
  });

  it("keeps following the caller across repeated changes", () => {
    const { container, rerender } = render(
      <HeatmapWidget data={DATA} defaultMaxHeight={12} defaultMaxWidth={13} />,
    );
    rerender(
      <HeatmapWidget data={DATA} defaultMaxHeight={100} defaultMaxWidth={100} />,
    );
    expect(cellReadout(container)).toBe("cell=100×100px");
    rerender(
      <HeatmapWidget data={DATA} defaultMaxHeight={50} defaultMaxWidth={50} />,
    );
    expect(cellReadout(container)).toBe("cell=50×50px");
  });

  it("stops adopting once the user moves a cell slider", () => {
    const { container, rerender } = render(
      <HeatmapWidget
        data={DATA}
        defaultMaxHeight={12}
        defaultMaxWidth={13}
        defaultControlsOpen
      />,
    );
    fireEvent.change(cellSlider(container, "h"), { target: { value: "30" } });
    expect(cellReadout(container)).toBe("cell=30×13px");

    rerender(
      <HeatmapWidget
        data={DATA}
        defaultMaxHeight={204}
        defaultMaxWidth={204}
        defaultControlsOpen
      />,
    );
    expect(cellReadout(container)).toBe("cell=30×13px");
  });

  it("freezes both axes on one adjustment, not just the one touched", () => {
    // A square cell takes one size, and the square-cell control drives
    // both sliders — releasing only the untouched axis to the caller
    // would change the cell's aspect ratio with nobody asking for it.
    const { container, rerender } = render(
      <HeatmapWidget
        data={DATA}
        defaultMaxHeight={12}
        defaultMaxWidth={13}
        defaultControlsOpen
      />,
    );
    fireEvent.change(cellSlider(container, "w"), { target: { value: "40" } });
    rerender(
      <HeatmapWidget
        data={DATA}
        defaultMaxHeight={204}
        defaultMaxWidth={204}
        defaultControlsOpen
      />,
    );
    expect(cellReadout(container)).toBe("cell=12×40px");
  });
});
