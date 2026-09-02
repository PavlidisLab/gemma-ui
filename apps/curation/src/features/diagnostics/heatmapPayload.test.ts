import { describe, expect, it } from "vitest";
import { buildDesignHeatmapPayload } from "./heatmapPayload";
import type { Design } from "@/features/experiment/types";

const design = {
  factors: [
    {
      id: 7,
      name: "treatment",
      category: { label: "treatment", uri: null },
      description: "",
      type: "categorical" as const,
      factor_values: [
        {
          id: 71,
          free_text_label: "LPS",
          is_baseline: false,
          statements: [],
          biomaterial_short_names: ["S1"],
        },
        {
          id: 72,
          free_text_label: "PBS",
          is_baseline: true,
          statements: [],
          biomaterial_short_names: ["S2"],
        },
      ],
    },
  ],
  biomaterials: [
    { short_name: "S1", name: "S1", characteristics: {}, bio_assays: [{ bio_assay_id: 101, short_name: "GSM1", name: "a" }] },
    { short_name: "S2", name: "S2", characteristics: {}, bio_assays: [{ bio_assay_id: 102, short_name: "GSM2", name: "b" }] },
  ],
} as unknown as Design;

const values = [
  [1, 0.9],
  [0.9, 1],
];

describe("buildDesignHeatmapPayload", () => {
  it("assigns each column its factor value, which is what draws the strips", () => {
    const p = buildDesignHeatmapPayload({
      design,
      bioAssayIds: [101, 102],
      values,
      colLabels: ["a", "b"],
      datasetId: 5,
    });
    expect(p?.columns.map((c) => c.factorValueIds)).toEqual([
      { 7: 71 },
      { 7: 72 },
    ]);
    // Passed through, not remapped: the payload's Factor is the same
    // snake_case shape the editor uses, so there is no adapter to drift.
    expect(p?.factors[0].factor_values[0].free_text_label).toBe("LPS");
  });

  it("joins on bio_assay_id, not on the accession", () => {
    // /svd and /sample-correlation both key columns by BioAssay id and
    // never mention a GSM. Feeding accessions must find nothing rather
    // than half-matching something.
    const p = buildDesignHeatmapPayload({
      design,
      bioAssayIds: ["GSM1", "GSM2"],
      values,
      colLabels: ["a", "b"],
      datasetId: 5,
    });
    expect(p).toBeNull();
  });

  it("returns null when the design places no column, so the caller can fall back", () => {
    // A payload whose every strip cell is blank reads as a rendering
    // fault. The bare matrix is the honest picture.
    expect(
      buildDesignHeatmapPayload({
        design,
        bioAssayIds: [999],
        values: [[1]],
        colLabels: ["x"],
        datasetId: 5,
      }),
    ).toBeNull();
  });

  it("returns null with no factors at all", () => {
    expect(
      buildDesignHeatmapPayload({
        design: { ...design, factors: [] } as unknown as Design,
        bioAssayIds: [101],
        values: [[1]],
        colLabels: ["a"],
        datasetId: 5,
      }),
    ).toBeNull();
  });

  it("keeps a column the design does not place, rather than dropping it", () => {
    // Dropping it would silently shrink the matrix and misalign every
    // value after it against its row.
    const p = buildDesignHeatmapPayload({
      design,
      bioAssayIds: [101, 999],
      values,
      colLabels: ["a", "unassigned"],
      datasetId: 5,
    });
    expect(p?.columns).toHaveLength(2);
    expect(p?.columns[1].factorValueIds).toEqual({});
  });
});
