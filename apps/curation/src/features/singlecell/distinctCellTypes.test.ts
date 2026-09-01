/**
 * The panel said "No cell types annotated on this experiment yet" while
 * eleven were on screen below it (eid 38651 / GSE199762, 2026-08-31).
 * Nothing was broken in the fetch — the count was of `draft.tags` only,
 * and a single-cell experiment's cell types live on its SUBSETS.
 *
 * A count of the wrong set reads exactly like a count of nothing, which
 * is why this is pinned rather than eyeballed.
 *
 * Fixtures are real: 38651's free-text cluster labels, and 44580's
 * grounded terms, both measured on gemma2 `0293d82c47`.
 */
import { describe, expect, it } from "vitest";

import { distinctCellTypes } from "./SingleCellPanel";
import type { DistinctSubset } from "@/api/subsets";
import type { Tag } from "@/features/experiment/types";

function subset(name: string, value: string, uri: string | null): DistinctSubset {
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

/** GSE199762 — the authors' own cluster names, every URI null. */
const GSE199762: DistinctSubset[] = [
  subset("… - Astrocytes", "Astrocytes", null),
  subset("… - OPCs", "OPCs", null),
  subset("… - Dividing Cells", "Dividing Cells", null),
];

const TAG = (label: string, uri: string | null): Tag => ({
  id: 1,
  category: { label: "cell type", uri: "http://www.ebi.ac.uk/efo/EFO_0000324" },
  value: { label, uri },
});

describe("distinctCellTypes", () => {
  it("counts subset cell types — the empty state was reading the wrong set", () => {
    const out = distinctCellTypes([], GSE199762);
    expect(out).toHaveLength(3);
    expect(out.map((c) => c.label)).toEqual([
      "Astrocytes",
      "OPCs",
      "Dividing Cells",
    ]);
  });

  it("keeps an ungrounded label with a null uri", () => {
    // These are the curation work item. Dropping them would restore the
    // same wrong count by another route.
    expect(distinctCellTypes([], GSE199762).every((c) => c.uri === null)).toBe(
      true,
    );
  });

  it("unions both sources rather than preferring one", () => {
    const out = distinctCellTypes(
      [TAG("astrocyte", "http://purl.obolibrary.org/obo/CL_0000127")],
      GSE199762,
    );
    expect(out).toHaveLength(4);
  });

  it("counts a term carried in both places once", () => {
    const CL = "http://purl.obolibrary.org/obo/CL_0000127";
    const out = distinctCellTypes(
      [TAG("astrocyte", CL)],
      [subset("… - astrocyte", "astrocyte", CL)],
    );
    expect(out).toHaveLength(1);
    expect(out[0].uri).toBe(CL);
  });

  it("does not split one ungrounded label on casing alone", () => {
    const out = distinctCellTypes(
      [TAG("Astrocytes", null)],
      [subset("… - astrocytes", "astrocytes", null)],
    );
    expect(out).toHaveLength(1);
  });

  it("ignores a subset characteristic that is not a cell type", () => {
    const s: DistinctSubset = {
      name: "Subset for larynx",
      id: 2,
      rows: 1,
      characteristics: [
        { category: "organism part", value: "larynx", value_uri: null },
      ],
    };
    expect(distinctCellTypes([], [s])).toEqual([]);
  });

  it("is empty only when both sources are — the sentence depends on it", () => {
    expect(distinctCellTypes([], [])).toEqual([]);
    // A classic subset carries no characteristics at all.
    expect(
      distinctCellTypes([], [{ name: "Subset for lung", id: 3, rows: 1, characteristics: [] }]),
    ).toEqual([]);
  });

  it("drops a blank label rather than counting an unlabelled chip", () => {
    expect(distinctCellTypes([TAG("   ", null)], [])).toEqual([]);
  });
});
