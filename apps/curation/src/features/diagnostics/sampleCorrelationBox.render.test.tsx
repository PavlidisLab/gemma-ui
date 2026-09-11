/**
 * @vitest-environment jsdom
 *
 * The sample-correlation tile's box measurement.
 *
 * The matrix sizes itself from the MEASURED height of the box it sits
 * in, and that box only renders once the matrix has arrived — on a cold
 * diagnostics cache the card mounts showing `PanelLoading` instead. So
 * the subject here is timing: the measurement has to survive the
 * element appearing on a later render, not only on the first one.
 *
 * `HeatmapWidget` is stubbed to record the props it is handed, which is
 * where the measured height lands. jsdom has no `ResizeObserver` and
 * lays nothing out, so one is installed here and driven by hand.
 *
 * NOT tested here: anything positional. Nothing in this suite renders
 * pixels, so the matrix's actual on-screen size is not verified by a
 * green run.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";

const widgetProps: Array<Record<string, unknown>> = [];

vi.mock("@gemma/heatmap", () => ({
  HeatmapWidget: (props: Record<string, unknown>) => {
    widgetProps.push(props);
    return <div data-testid="heatmap-widget" />;
  },
  computeColumnOrder: (_p: unknown, _g: unknown) => ({ columnOrder: [0, 1, 2] }),
  serializeHeatmapDataAsTsv: () => "",
}));

vi.mock("@/api/diagnostics", () => ({ useSampleCorrelation: vi.fn() }));
vi.mock("@/api/workflow", () => ({
  useBatchOutliers: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  usePipelineStatus: () => ({ data: undefined }),
}));
vi.mock("@/api/qcMetrics", () => ({ useQcMetrics: () => ({ data: undefined }) }));
vi.mock("@/features/design/DesignDraftContext", () => ({
  useDesignDraft: () => ({ draft: null }),
}));
vi.mock("@gemma/ui", () => ({ useEscapeKey: () => undefined }));

import { useSampleCorrelation } from "@/api/diagnostics";
import { SampleCorrelationCard } from "./SampleCorrelationCard";

/** Every live observer, so a test can fire one after the fact. */
type Observed = { el: Element; fire: (height: number) => void };
let observed: Observed[] = [];

class FakeResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe(el: Element) {
    observed.push({
      el,
      fire: (height: number) =>
        this.cb(
          [{ target: el, contentRect: { width: 400, height } }] as never,
          this as never,
        ),
    });
  }
  unobserve() {}
  disconnect() {}
}

/** A three-sample matrix — enough for a real grid, small enough to read. */
const MATRIX = {
  bio_assay_ids: [1, 2, 3],
  bio_assay_short_names: ["GSM1", "GSM2", "GSM3"],
  values: [
    [1, 0.98, 0.97],
    [0.98, 1, 0.99],
    [0.97, 0.99, 1],
  ],
  method: "pearson",
  matrix: "full",
  actual_outlier_bio_assay_ids: [],
  predicted_outlier_bio_assay_ids: [],
};

const loading = { data: undefined, isLoading: true, error: null };
const loaded = {
  data: { matrix: MATRIX, reason: null },
  isLoading: false,
  error: null,
};

/** The box the observer is meant to watch — the widget's parent. */
function boxOf(container: HTMLElement): Element {
  return container.querySelector('[data-testid="heatmap-widget"]')!
    .parentElement!;
}

const lastWidgetProps = () => widgetProps[widgetProps.length - 1];

beforeEach(() => {
  widgetProps.length = 0;
  observed = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SampleCorrelationCard — measuring a box that mounts late", () => {
  it("observes the box when it arrives on a later render", () => {
    vi.mocked(useSampleCorrelation).mockReturnValue(loading as never);
    const { container, rerender } = render(
      <SampleCorrelationCard experimentId={1658} />,
    );
    // Cold cache: the loading state is what mounted, so there is no box
    // to watch yet.
    expect(observed).toHaveLength(0);
    expect(widgetProps).toHaveLength(0);

    vi.mocked(useSampleCorrelation).mockReturnValue(loaded as never);
    rerender(<SampleCorrelationCard experimentId={1658} />);

    expect(observed).toHaveLength(1);
    expect(observed[0].el).toBe(boxOf(container));
  });

  it("sizes the matrix from the measured height, not the constant", () => {
    vi.mocked(useSampleCorrelation).mockReturnValue(loading as never);
    const { rerender } = render(<SampleCorrelationCard experimentId={1658} />);
    vi.mocked(useSampleCorrelation).mockReturnValue(loaded as never);
    rerender(<SampleCorrelationCard experimentId={1658} />);

    const beforeMeasurement = lastWidgetProps().matrixMaxHeight as number;
    observed[0].fire(612);
    rerender(<SampleCorrelationCard experimentId={1658} />);

    // No design draft here, so no annotation strips come off the top:
    // the matrix gets the whole measured box.
    expect(lastWidgetProps().matrixMaxHeight).toBe(612);
    expect(lastWidgetProps().matrixMaxHeight).not.toBe(beforeMeasurement);
    // Cells are sized to fill it — three samples across 612px.
    expect(lastWidgetProps().defaultMaxHeight).toBe(204);
    expect(lastWidgetProps().defaultMaxWidth).toBe(204);
  });

  it("ignores a zero-height measurement", () => {
    vi.mocked(useSampleCorrelation).mockReturnValue(loaded as never);
    const { rerender } = render(<SampleCorrelationCard experimentId={1658} />);
    const fallback = lastWidgetProps().matrixMaxHeight;

    // A hidden tab measures 0x0, and taking that would collapse the
    // matrix to its 40px floor.
    observed[0].fire(0);
    rerender(<SampleCorrelationCard experimentId={1658} />);
    expect(lastWidgetProps().matrixMaxHeight).toBe(fallback);
  });

  it("keeps following the box after a resize", () => {
    vi.mocked(useSampleCorrelation).mockReturnValue(loaded as never);
    const { rerender } = render(<SampleCorrelationCard experimentId={1658} />);

    observed[0].fire(400);
    rerender(<SampleCorrelationCard experimentId={1658} />);
    expect(lastWidgetProps().matrixMaxHeight).toBe(400);

    observed[0].fire(800);
    rerender(<SampleCorrelationCard experimentId={1658} />);
    expect(lastWidgetProps().matrixMaxHeight).toBe(800);
  });
});
