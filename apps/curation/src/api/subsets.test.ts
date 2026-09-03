/**
 * `summarizeSubsets` collapses Gemma's subset rows by name — and the
 * collapse is the part that can lie. 275 rows becoming 45 subsets is
 * either a correct dedup or a silent data loss depending on whether the
 * duplicated rows really are the same subset, so the row count travels
 * beside the list rather than being thrown away.
 *
 * Fixtures are the verbatim shapes measured on gemma2 `0293d82c47`
 * (2026-08-31), post-`snakeify`.
 */
import { describe, expect, it } from "vitest";

import {
  sharedNamePrefix,
  isProcessedPreferred,
  summarizeSubsetGroups,
  summarizeSubsets,
  type DatasetSubset,
  type SubsetGroup,
} from "./subsets";

/** Single-cell: one subset per cell-type assignment, each carrying a
 *  COPY of a cell-level characteristic. Three rows share one name —
 *  the shape that makes 275 rows into 45 subsets on eid 44580. */
const SINGLE_CELL: DatasetSubset[] = [
  {
    id: 51759,
    source_experiment_id: 44580,
    source_experiment_short_name: "GSE284797",
    name: "Astrocytic EphA4 signaling - CA1-prosubiculum hippocampal neuron",
    description: null,
    characteristics: [
      {
        id: 54017773,
        category: "cell type",
        category_uri: "http://www.ebi.ac.uk/efo/EFO_0000324",
        value: "CA1-prosubiculum hippocampal neuron",
        value_uri: "http://purl.obolibrary.org/obo/CL_4023040",
      },
    ],
    sub_set_group_ids: [],
  },
  {
    id: 61129,
    source_experiment_id: 44580,
    name: "Astrocytic EphA4 signaling - CA1-prosubiculum hippocampal neuron",
    characteristics: [
      {
        id: 54496423,
        category: "cell type",
        category_uri: "http://www.ebi.ac.uk/efo/EFO_0000324",
        value: "CA1-prosubiculum hippocampal neuron",
        value_uri: "http://purl.obolibrary.org/obo/CL_4023040",
      },
    ],
  },
  {
    id: 61340,
    source_experiment_id: 44580,
    // An author cluster label with no CL term — 23% of them corpus-wide.
    name: "Astrocytic EphA4 signaling - L4 RSP-ACA glutamatergic neuron",
    characteristics: [
      {
        id: 54498991,
        category: "cell type",
        category_uri: "http://www.ebi.ac.uk/efo/EFO_0000324",
        value: "L4 RSP-ACA glutamatergic neuron",
        value_uri: null,
      },
    ],
  },
];

/** Classic: cut on a factor, named for the level, carrying NO
 *  characteristics at all. eid 38390, verbatim. */
const CLASSIC: DatasetSubset[] = [
  {
    id: 39228,
    source_experiment_id: 38390,
    name: "Subset for larynx",
    characteristics: [],
    sub_set_group_ids: [45169],
  },
  {
    id: 39226,
    source_experiment_id: 38390,
    name: "Subset for lung",
    characteristics: [],
    sub_set_group_ids: [45169],
  },
  {
    id: 39227,
    source_experiment_id: 38390,
    name: "Subset for trachea",
    characteristics: [],
    sub_set_group_ids: [45169],
  },
];

describe("summarizeSubsets", () => {
  it("collapses by name and keeps the row count that proves it collapsed", () => {
    const s = summarizeSubsets(SINGLE_CELL);
    expect(s.subsets).toHaveLength(2);
    expect(s.rowCount).toBe(3);
    expect(s.subsets[0].rows).toBe(2);
    expect(s.subsets[1].rows).toBe(1);
  });

  it("keys on the lowest id so the list is stable across refetches", () => {
    // Gemma returns the duplicates in no guaranteed order; taking the
    // first id would reorder the React keys on a reordered response.
    const s = summarizeSubsets([...SINGLE_CELL].reverse());
    const dup = s.subsets.find((x) => x.rows === 2);
    expect(dup?.id).toBe(51759);
  });

  it("carries one copy of a characteristic duplicated across rows", () => {
    const s = summarizeSubsets(SINGLE_CELL);
    expect(s.subsets[0].characteristics).toHaveLength(1);
    expect(s.subsets[0].characteristics[0].value).toBe(
      "CA1-prosubiculum hippocampal neuron",
    );
  });

  it("keeps an ungrounded cell type rather than dropping it", () => {
    // The value with a null `value_uri` is the curation work item, not
    // noise — it must reach the panel to be marked.
    const s = summarizeSubsets(SINGLE_CELL);
    const ungrounded = s.subsets[1].characteristics[0];
    expect(ungrounded.value).toBe("L4 RSP-ACA glutamatergic neuron");
    expect(ungrounded.value_uri).toBeNull();
  });

  it("a classic factor-cut subset carries no characteristics and no duplication", () => {
    const s = summarizeSubsets(CLASSIC);
    expect(s.subsets).toHaveLength(3);
    expect(s.rowCount).toBe(3);
    expect(s.subsets.every((x) => x.characteristics.length === 0)).toBe(true);
  });

  it("an empty response is not an error state", () => {
    expect(summarizeSubsets([])).toEqual({
      subsets: [],
      rowCount: 0,
      commonPrefix: "",
    });
  });
});

describe("sharedNamePrefix", () => {
  it("trims back to the last separator, never mid-word", () => {
    expect(
      sharedNamePrefix([
        "Astrocytic EphA4 signaling - CA1-prosubiculum hippocampal neuron",
        "Astrocytic EphA4 signaling - L4 RSP-ACA glutamatergic neuron",
      ]),
    ).toBe("Astrocytic EphA4 signaling - ");
  });

  it("returns nothing when the shared head is not a whole segment", () => {
    // "Subset for l" is shared by larynx and lung, and cutting there
    // would render "arynx" / "ung".
    expect(sharedNamePrefix(["Subset for larynx", "Subset for lung"])).toBe("");
  });

  it("returns nothing for a single subset — there is no shared prefix", () => {
    expect(sharedNamePrefix(["Subset for larynx"])).toBe("");
  });
});

/* ------------------------------------------------------------------ *
 * Subset GROUPS. The flat list above is a lie on 62% of single-cell
 * datasets (57 of 92 measured 2026-09-03) because they carry more than
 * one subset group and all but one is a superseded cut.
 *
 * 🛑 Fixtures below are the SHAPE gemma2 returns, not a convenient
 * reduction of it: `/subSetGroups` sends `sub_sets` with NO
 * characteristics and the annotations arrive on `/subSets`. A fixture
 * that put characteristics on the group rows would pass while the join
 * it exists to cover was broken.
 *
 * Numbers come from eid 79038 (Rexach-2024.3), measured 2026-09-03.
 * ------------------------------------------------------------------ */

function sub(
  id: number,
  name: string,
  groupId: number,
  value: string,
  uri: string | null,
): DatasetSubset {
  return {
    id,
    name,
    characteristics: [
      { id: id * 10, category: "cell type", value, value_uri: uri },
    ],
    sub_set_group_ids: [groupId],
  };
}

const CL = "http://purl.obolibrary.org/obo/CL_";

/** The live cut: grounded to CL, owns the `cell type` factor, preferred
 *  quantitation type. */
const LIVE: SubsetGroup = {
  id: 49734,
  name: "Split part 3 of: … [organism part = visual cortex]",
  factors: [{ id: 68843, name: "cell type" }],
  quantitation_types: [
    // The raw single-cell counts — preferred, but NOT the processed cut.
    {
      id: 615700,
      name: "10x MEX",
      is_preferred: true,
      is_masked_preferred: false,
      is_single_cell_preferred: true,
    },
    // The live one.
    {
      id: 615713,
      name: "10x MEX aggregated by cell type (log2cpm)",
      is_preferred: true,
      is_masked_preferred: false,
      is_single_cell_preferred: false,
    },
    // The masked aggregate — also answers is_preferred true.
    {
      id: 615714,
      name: "10x MEX aggregated by cell type (log2cpm) - Processed version",
      is_preferred: true,
      is_masked_preferred: true,
      is_single_cell_preferred: false,
    },
  ],
  sub_sets: [{ id: 79076 }, { id: 79081 }],
};

/** The superseded cut: the author's raw strings, no factor, not
 *  preferred. */
const DEAD: SubsetGroup = {
  id: 49732,
  name: "Split part 3 of: … [organism part = visual cortex]",
  factors: [],
  quantitation_types: [
    {
      id: 615709,
      name: "10x MEX aggregated by cell type (log2cpm)",
      is_preferred: false,
      is_masked_preferred: false,
      is_single_cell_preferred: false,
    },
  ],
  sub_sets: [{ id: 79059 }, { id: 79064 }],
};

const ROWS: DatasetSubset[] = [
  sub(79076, "P - astrocyte", 49734, "astrocyte", `${CL}0000127`),
  sub(79081, "P - opc", 49734, "oligodendrocyte precursor cell", `${CL}0002453`),
  sub(79059, "P - astrocyte raw", 49732, "astrocyte", null),
  sub(79064, "P - opc raw", 49732, "opc", null),
];

describe("summarizeSubsetGroups", () => {
  it("marks the preferred-quantitation-type group live and the rest superseded", () => {
    const out = summarizeSubsetGroups(ROWS, [DEAD, LIVE]);
    expect(out.liveAmbiguous).toBe(false);
    // Live sorts first regardless of the order the groups arrived in —
    // gemma2 returns the dead one first on eid 77392.
    expect(out.groups.map((g) => g.id)).toEqual([49734, 49732]);
    expect(out.groups[0].superseded).toBe(false);
    expect(out.groups[1].superseded).toBe(true);
  });

  it("joins characteristics from /subSets onto the group's own subsets", () => {
    const out = summarizeSubsetGroups(ROWS, [LIVE, DEAD]);
    const live = out.groups.find((g) => g.id === 49734)!;
    expect(live.subsets).toHaveLength(2);
    expect(live.groundedCount).toBe(2);
    expect(live.factorNames).toEqual(["cell type"]);

    const dead = out.groups.find((g) => g.id === 49732)!;
    expect(dead.groundedCount).toBe(0);
    expect(dead.factorNames).toEqual([]);
    // The raw author string is the thing a curator is looking for here.
    expect(dead.subsets.flatMap((s) => s.characteristics.map((c) => c.value)))
      .toContain("opc");
  });

  it("does not guess when two groups both claim a preferred type", () => {
    const both = {
      ...DEAD,
      quantitation_types: [
        {
          is_preferred: true,
          is_masked_preferred: false,
          is_single_cell_preferred: false,
        },
      ],
    };
    const out = summarizeSubsetGroups(ROWS, [LIVE, both]);
    expect(out.liveAmbiguous).toBe(true);
    expect(out.groups.every((g) => !g.superseded)).toBe(true);
  });

  it("does not guess when no group claims a preferred type", () => {
    const neither = { ...LIVE, quantitation_types: [{ is_preferred: false }] };
    const out = summarizeSubsetGroups(ROWS, [neither, DEAD]);
    expect(out.liveAmbiguous).toBe(true);
    expect(out.groups.every((g) => !g.superseded)).toBe(true);
  });

  it("does not rely on 'has a factor' — it fails on 10 of 92 datasets", () => {
    // eid 75811 / 75052 / 67057 / 67053: both groups carry a factor and
    // only the quantitation type separates them.
    const deadWithFactor: SubsetGroup = {
      ...DEAD,
      factors: [{ id: 999, name: "cell type" }],
    };
    const out = summarizeSubsetGroups(ROWS, [LIVE, deadWithFactor]);
    expect(out.liveAmbiguous).toBe(false);
    expect(out.groups.find((g) => g.id === 49732)!.superseded).toBe(true);
  });

  it("surfaces subsets belonging to no group rather than dropping them", () => {
    const orphan: DatasetSubset = {
      id: 1,
      name: "loose",
      characteristics: [],
      sub_set_group_ids: [],
    };
    const out = summarizeSubsetGroups([...ROWS, orphan], [LIVE, DEAD]);
    expect(out.ungrouped.map((s) => s.name)).toEqual(["loose"]);
  });

  it("counts rows and names separately inside one group", () => {
    const dupe = sub(79077, "P - astrocyte", 49734, "astrocyte", `${CL}0000127`);
    const out = summarizeSubsetGroups([...ROWS, dupe], [LIVE, DEAD]);
    const live = out.groups.find((g) => g.id === 49734)!;
    expect(live.rowCount).toBe(3);
    expect(live.subsets).toHaveLength(2);
    expect(live.subsets.find((s) => s.name === "P - astrocyte")!.rows).toBe(2);
  });

  it("returns nothing to render when Gemma has no groups", () => {
    const out = summarizeSubsetGroups([], []);
    expect(out.groups).toEqual([]);
    expect(out.ungrouped).toEqual([]);
  });
});

/**
 * 🛑 `is_preferred` is ONE field conflating THREE flags — Gemma computes
 * it as `isPreferred || isSingleCellPreferred || isMaskedPreferred`, so
 * three quantitation types answer true on a single-cell dataset. Reading
 * it alone made eids 65454 and 51179 look like two live cuts.
 * `isSingleCellPreferred` was exposed 2026-09-03 (`50903ef8e7`) to tell
 * them apart, taking the discriminator from 90 of 92 datasets to 92.
 *
 * Rows below are the three QTs gembro measured on eid 65454.
 */
describe("isProcessedPreferred", () => {
  const RAW_SINGLE_CELL = {
    name: "10x MEX",
    is_preferred: true,
    is_masked_preferred: false,
    is_single_cell_preferred: true,
  };
  const AGGREGATE = {
    name: "10x MEX aggregated by cell type (log2cpm)",
    is_preferred: true,
    is_masked_preferred: false,
    is_single_cell_preferred: false,
  };
  const MASKED = {
    name: "10x MEX aggregated by cell type (log2cpm) - Processed version",
    is_preferred: true,
    is_masked_preferred: true,
    is_single_cell_preferred: false,
  };

  it("picks the aggregate — the only one of the three that is the live cut", () => {
    expect([RAW_SINGLE_CELL, AGGREGATE, MASKED].filter(isProcessedPreferred))
      .toEqual([AGGREGATE]);
  });

  it("rejects the raw single-cell counts even though is_preferred is true", () => {
    expect(isProcessedPreferred(RAW_SINGLE_CELL)).toBe(false);
  });

  it("rejects the masked aggregate even though is_preferred is true", () => {
    expect(isProcessedPreferred(MASKED)).toBe(false);
  });

  it("rejects a type that is not preferred at all", () => {
    expect(isProcessedPreferred({ is_preferred: false })).toBe(false);
  });

  it("treats the two new flags as absent-means-false, for an older host", () => {
    // A host predating `50903ef8e7` sends neither flag; the rule has to
    // degrade to the old behaviour rather than rejecting everything.
    expect(isProcessedPreferred({ is_preferred: true })).toBe(true);
  });
});

/** A group carries every QT reachable through its dimension, so more
 *  than one — and only some of them preferred — is the normal shape,
 *  not a defect. eid 51179 has a group whose flags read [False, True]. */
describe("a group with several quantitation types", () => {
  it("is live when ANY of them is preferred in the processed sense", () => {
    const many: SubsetGroup = {
      ...LIVE,
      quantitation_types: [
        { is_preferred: false },
        {
          is_preferred: true,
          is_masked_preferred: false,
          is_single_cell_preferred: false,
        },
      ],
    };
    const out = summarizeSubsetGroups(ROWS, [many, DEAD]);
    expect(out.liveAmbiguous).toBe(false);
    expect(out.groups.find((g) => g.id === many.id)!.superseded).toBe(false);
  });
});
