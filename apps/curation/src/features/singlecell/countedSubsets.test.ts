/**
 * Which subsets the single-cell summary counts cell types from.
 *
 * Two panels on one screen read the same `SubsetGroupsSummary`, and
 * they used to disagree: the summary counted `groups` alone while
 * `SubsetsCard` also draws `ungrouped`. On a dataset whose `/subSets`
 * rows all carry an empty `sub_set_group_ids` — 8 of the 100 single-cell
 * datasets measured 2026-09-03 — `groups` is `[]`, so the summary
 * printed "No cell types on this experiment" directly above "N subsets
 * in no group" and its cell-type chips.
 *
 * The superseded-cut rule is pinned alongside it, because the fix must
 * not reopen the double-count it exists to stop (eid 79038: the same
 * ten cell types twice, once grounded and once as the author's raw
 * strings).
 */
import { describe, expect, it } from "vitest";

import { countedSubsets } from "./SingleCellPanel";
import type {
  DistinctSubset,
  SubsetGroupsSummary,
  SubsetGroupView,
} from "@/api/subsets";

function subset(name: string, value: string, uri: string | null = null): DistinctSubset {
  return {
    name,
    id: 1,
    rows: 16,
    characteristics: [
      {
        category: "cell type",
        category_uri: "http://www.ebi.ac.uk/efo/EFO_0000324",
        value,
        value_uri: uri,
      },
    ],
  };
}

function group(
  id: number,
  subsets: DistinctSubset[],
  superseded: boolean,
): SubsetGroupView {
  return {
    id,
    name: `group ${id}`,
    subsets,
    rowCount: subsets.length,
    commonPrefix: "",
    factorNames: [],
    preferred: !superseded,
    groundedCount: subsets.filter((s) =>
      s.characteristics.some((c) => !!c.value_uri),
    ).length,
    superseded,
  };
}

function summary(over: Partial<SubsetGroupsSummary> = {}): SubsetGroupsSummary {
  return { groups: [], ungrouped: [], liveAmbiguous: false, ...over };
}

const names = (rows: DistinctSubset[]) =>
  rows.flatMap((s) => s.characteristics.map((c) => c.value));

/** eid 79038's shape — the live cut grounded to CL, the dead one the
 *  author's raw strings for the same cells. */
const LIVE = group(
  1,
  [subset("… - OPC", "oligodendrocyte precursor cell", "http://purl.obolibrary.org/obo/CL_0002453")],
  false,
);
const DEAD = group(2, [subset("… - opc", "opc")], true);

describe("countedSubsets — subsets in no group", () => {
  it("counts the ungrouped rows when there are no groups at all", () => {
    const out = countedSubsets(
      summary({ ungrouped: [subset("… - Astrocytes", "Astrocytes")] }),
    );
    expect(names(out)).toEqual(["Astrocytes"]);
  });

  it("counts the ungrouped rows alongside the live group", () => {
    const out = countedSubsets(
      summary({
        groups: [LIVE, DEAD],
        ungrouped: [subset("… - Microglia", "Microglia")],
      }),
    );
    expect(names(out)).toEqual(["oligodendrocyte precursor cell", "Microglia"]);
  });

  it("counts the ungrouped rows when no cut could be picked as live", () => {
    // Nothing is marked superseded in this state, so both groups are
    // counted — and the orphans still are.
    const out = countedSubsets(
      summary({
        groups: [group(1, [subset("a", "A")], false), group(2, [subset("b", "B")], false)],
        ungrouped: [subset("c", "C")],
        liveAmbiguous: true,
      }),
    );
    expect(names(out)).toEqual(["A", "B", "C"]);
  });
});

describe("countedSubsets — the superseded cut stays out", () => {
  it("drops a superseded group when a live one exists", () => {
    const out = countedSubsets(summary({ groups: [LIVE, DEAD] }));
    expect(names(out)).toEqual(["oligodendrocyte precursor cell"]);
  });

  it("falls back to every group when all of them are superseded", () => {
    const out = countedSubsets(summary({ groups: [DEAD] }));
    expect(names(out)).toEqual(["opc"]);
  });
});

describe("countedSubsets — nothing to count", () => {
  it("returns an empty list for an undefined summary", () => {
    expect(countedSubsets(undefined)).toEqual([]);
  });

  it("returns an empty list for an empty summary", () => {
    expect(countedSubsets(summary())).toEqual([]);
  });
});
