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
  summarizeSubsets,
  type DatasetSubset,
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
