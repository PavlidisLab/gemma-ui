/**
 * "Our pipeline, or the authors of the study?" — Paul, 2026-08-31, of a
 * single-cell tab showing eleven cell types and no idea where they came
 * from.
 *
 * The answer lives in the assignment's PROTOCOL, which never reaches the
 * wire (a LAZY `@ManyToOne` built outside its transaction), so this
 * reads the display `name` instead. That makes it a stopgap matching on
 * a string nobody promised to keep — which is exactly why the mapping is
 * pinned, and why anything unrecognised must come back `unknown` rather
 * than defaulting to either side.
 *
 * Names are measured on gemma2; the protocol vocabulary is gembro's
 * count over all 949 assignments on prod.
 */
import { describe, expect, it } from "vitest";

import {
  assignmentOrigin,
  cellTypeCounts,
  groundedCount,
  type CellTypeAssignment,
} from "./cellTypeAssignment";

describe("assignmentOrigin", () => {
  it("names ours from the pipeline family", () => {
    // eid 44580, verbatim.
    expect(assignmentOrigin("sc-pipeline-2.0.0-family")).toBe("pipeline");
    // The other protocol versions in the corpus — 151 assignments
    // between them, so the older names must not fall through.
    expect(assignmentOrigin("sc-pipeline-1.1.2")).toBe("pipeline");
    expect(assignmentOrigin("sc-pipeline-2.0.0dev")).toBe("pipeline");
    expect(assignmentOrigin("sc-pipeline-1.2.0")).toBe("pipeline");
  });

  it("names the authors", () => {
    // eid 66278, verbatim. 223 assignments carry the author-submitted
    // protocol over 214 dimensions.
    expect(assignmentOrigin("Author-submitted annotations")).toBe("authors");
  });

  it("🛑 declines to guess rather than defaulting to ours", () => {
    // 10 assignments on prod have no protocol at all, and the name is a
    // display string that can change without notice. A wrong provenance
    // claim is worse than none.
    expect(assignmentOrigin("some future thing")).toBe("unknown");
    expect(assignmentOrigin("")).toBe("unknown");
    expect(assignmentOrigin(null)).toBe("unknown");
    expect(assignmentOrigin(undefined)).toBe("unknown");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(assignmentOrigin("  AUTHOR-SUBMITTED ANNOTATIONS  ")).toBe("authors");
    expect(assignmentOrigin("SC-Pipeline-2.0.0")).toBe("pipeline");
  });
});

describe("groundedCount", () => {
  it("counts terms, not provenance — the two are separate axes", () => {
    // 66278: author-submitted AND entirely ungrounded. 44580: ours AND
    // fully grounded. The correlation is real and is NOT the signal —
    // reading grounding as authorship is the inference this refuses.
    expect(
      groundedCount({
        name: "Author-submitted annotations",
        cell_types: [
          { value: "Astrocytes", value_uri: null },
          { value: "OPCs", value_uri: null },
        ],
      }),
    ).toBe(0);
    expect(
      groundedCount({
        name: "sc-pipeline-2.0.0-family",
        cell_types: [
          { value: "astrocyte", value_uri: "http://purl.obolibrary.org/obo/CL_0000127" },
          { value: "OPCs", value_uri: null },
        ],
      }),
    ).toBe(1);
  });

  it("an assignment with no cell types is zero, not a crash", () => {
    expect(groundedCount({})).toBe(0);
  });
});

/**
 * Verbatim from `GET /rest/v2/datasets/79038/cellTypeAssignment`
 * (Rexach-2024.3), post-`snakeify`, captured 2026-09-03. The tally is
 * keyed by the cell type's CHARACTERISTIC id, and the ten numbers match
 * what Gemma 1.0 prints beside each DEA subset.
 */
const REXACH: CellTypeAssignment = {
  id: 416382,
  name: "author-submitted",
  number_of_assigned_cells: 89700,
  preferred: true,
  cell_types: [
    { id: 54991254, value: "endothelial cell", value_uri: "CL_0000115" },
    { id: 54991247, value: "astrocyte", value_uri: "CL_0000127" },
    { id: 54991250, value: "oligodendrocyte", value_uri: "CL_0000128" },
    { id: 54991252, value: "oligodendrocyte precursor cell", value_uri: "CL_0002453" },
    { id: 54991253, value: "inhibitory neuron", value_uri: "CL_0000498" },
    { id: 54991251, value: "T cell", value_uri: "CL_0000084" },
    { id: 54991256, value: "ependymal cell", value_uri: "CL_0000065" },
    { id: 54991249, value: "excitatory neuron", value_uri: "CL_0000679" },
    { id: 54991255, value: "microglial cell", value_uri: "CL_0000129" },
    { id: 54991248, value: "pericyte", value_uri: "CL_0000669" },
  ],
  number_of_assigned_cells_by_cell_type: {
    "54991247": 14113,
    "54991248": 1873,
    "54991249": 34610,
    "54991250": 15462,
    "54991251": 2907,
    "54991252": 5184,
    "54991253": 6578,
    "54991254": 3322,
    "54991255": 3543,
    "54991256": 2108,
  },
};

describe("cellTypeCounts", () => {
  it("joins the tally onto the cell types by id and sorts largest first", () => {
    expect(
      cellTypeCounts(REXACH).map((c) => [c.label, c.cells]),
    ).toEqual([
      ["excitatory neuron", 34610],
      ["oligodendrocyte", 15462],
      ["astrocyte", 14113],
      ["inhibitory neuron", 6578],
      ["oligodendrocyte precursor cell", 5184],
      ["microglial cell", 3543],
      ["endothelial cell", 3322],
      ["T cell", 2907],
      ["ependymal cell", 2108],
      ["pericyte", 1873],
    ]);
  });

  it("sums to the assignment's own total — the join is not dropping a type", () => {
    const sum = cellTypeCounts(REXACH).reduce((n, c) => n + (c.cells ?? 0), 0);
    expect(sum).toBe(REXACH.number_of_assigned_cells);
    expect(sum).toBe(89700);
  });

  it("keeps the ontology URI so the caller can still render a Term", () => {
    const top = cellTypeCounts(REXACH)[0];
    expect(top.uri).toBe("CL_0000679");
  });

  it("🛑 reports an absent tally as null, NEVER as 0", () => {
    // A host predating 2026-09-03 sends no tally. Rendering "0 cells"
    // for a dataset whose cells were never counted is a false claim
    // about the data, not a cosmetic default.
    const old = { ...REXACH, number_of_assigned_cells_by_cell_type: null };
    const out = cellTypeCounts(old);
    expect(out).toHaveLength(10);
    expect(out.every((c) => c.cells === null)).toBe(true);
  });

  it("reports a type the tally omits as null, and sorts it last", () => {
    const partial: CellTypeAssignment = {
      ...REXACH,
      number_of_assigned_cells_by_cell_type: { "54991249": 34610 },
    };
    const out = cellTypeCounts(partial);
    expect(out[0]).toMatchObject({ label: "excitatory neuron", cells: 34610 });
    expect(out.slice(1).every((c) => c.cells === null)).toBe(true);
  });

  it("survives an assignment with no cell types at all", () => {
    expect(cellTypeCounts({ cell_types: null })).toEqual([]);
  });

  it("labels an unlabelled cell type rather than rendering an empty row", () => {
    const blank: CellTypeAssignment = {
      cell_types: [{ id: 1, value: "  ", value_uri: null }],
      number_of_assigned_cells_by_cell_type: { "1": 5 },
    };
    expect(cellTypeCounts(blank)[0]).toMatchObject({
      label: "(unlabelled)",
      cells: 5,
    });
  });
});
