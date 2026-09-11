/**
 * `adaptHeatmapWire` — the `/heatmap-data` matrix adapter.
 *
 * The cells are the whole subject here: the wire declares them
 * `number | string | null`, and the difference between "no value" and
 * "the value is zero" is the difference between an NA cell and a real
 * expression reading. `withPcScoreStrip` gets a pass over the same
 * boundary because it also has to decide what counts as a number.
 */
import { describe, expect, it } from "vitest";

import { adaptHeatmapWire, withPcScoreStrip } from "./heatmapData";

/** A one-row matrix carrying whatever cells the test is about. */
function wireWithCells(cells: Array<number | string | null>) {
  return {
    dataset_id: 1658,
    matrix: {
      values: [cells],
      rows_count: 1,
      cols_count: cells.length,
      quantitation_type: { name: "rma value", is_preferred: true },
    },
    rows: [{ design_element_id: 7, design_element_name: "probe_7", genes: [] }],
    columns: cells.map((_, i) => ({
      bio_assay_id: 100 + i,
      bio_material_id: 200 + i,
      name: `GSM${i}`,
    })),
    factors: [],
  };
}

const cellsOf = (wire: Parameters<typeof adaptHeatmapWire>[0]) =>
  adaptHeatmapWire(wire)!.matrix.values[0];

describe("adaptHeatmapWire — absent cells are null, not zero", () => {
  it("maps a null cell to null", () => {
    expect(cellsOf(wireWithCells([null]))).toEqual([null]);
  });

  it("maps an empty string to null", () => {
    expect(cellsOf(wireWithCells([""]))).toEqual([null]);
  });

  it("maps a whitespace-only string to null", () => {
    expect(cellsOf(wireWithCells(["  "]))).toEqual([null]);
  });

  it('maps the string "NaN" to null', () => {
    expect(cellsOf(wireWithCells(["NaN"]))).toEqual([null]);
  });

  it("keeps a real zero as zero", () => {
    const out = cellsOf(wireWithCells([0]));
    expect(out).toEqual([0]);
    // Distinguishable from the absent cases above, which is the point.
    expect(out[0]).not.toBeNull();
  });

  it('keeps the string "0" as zero', () => {
    expect(cellsOf(wireWithCells(["0"]))).toEqual([0]);
  });

  it("parses a numeric string", () => {
    expect(cellsOf(wireWithCells(["-1.25"]))).toEqual([-1.25]);
  });

  it("maps a non-numeric string to null", () => {
    expect(cellsOf(wireWithCells(["n/a"]))).toEqual([null]);
  });

  it("maps a non-finite number to null", () => {
    expect(cellsOf(wireWithCells([Number.POSITIVE_INFINITY]))).toEqual([null]);
  });

  it("keeps a mixed row's real values and blanks only the absent ones", () => {
    expect(cellsOf(wireWithCells([0, null, "NaN", "2.5", "", 3]))).toEqual([
      0,
      null,
      null,
      2.5,
      null,
      3,
    ]);
  });
});

describe("adaptHeatmapWire — shape", () => {
  it("returns null when there is no matrix", () => {
    expect(adaptHeatmapWire(null)).toBeNull();
    expect(adaptHeatmapWire({ matrix: null })).toBeNull();
    expect(adaptHeatmapWire({ matrix: { values: [] } })).toBeNull();
  });

  it("carries the column and quantitation-type fields through", () => {
    const out = adaptHeatmapWire(wireWithCells([1, 2]))!;
    expect(out.datasetId).toBe(1658);
    expect(out.matrix.rows).toBe(1);
    expect(out.matrix.cols).toBe(2);
    expect(out.matrix.quantitationType.name).toBe("rma value");
    expect(out.matrix.quantitationType.isPreferred).toBe(true);
    expect(out.columns.map((c) => c.bioAssayId)).toEqual([100, 101]);
  });
});

describe("withPcScoreStrip", () => {
  it("adds a continuous strip keyed on the negative PC number", () => {
    const payload = adaptHeatmapWire(wireWithCells([1, 2]))!;
    const out = withPcScoreStrip(payload, 3, { 100: -0.4, 101: 0.9 })!;
    expect(out.factors).toHaveLength(1);
    expect(out.factors[0].id).toBe(-3);
    expect(out.factors[0].type).toBe("continuous");
    expect(out.factors[0].continuousMeasurements).toEqual({
      100: -0.4,
      101: 0.9,
    });
  });

  it("keeps a zero score — it is a position on the component", () => {
    const payload = adaptHeatmapWire(wireWithCells([1, 2]))!;
    const out = withPcScoreStrip(payload, 1, { 100: 0, 101: 1 })!;
    expect(out.factors[0].continuousMeasurements).toEqual({ 100: 0, 101: 1 });
  });

  it("adds no strip when no column has a finite score", () => {
    const payload = adaptHeatmapWire(wireWithCells([1, 2]))!;
    const out = withPcScoreStrip(payload, 1, { 999: 0.5 })!;
    expect(out.factors).toHaveLength(0);
  });
});
