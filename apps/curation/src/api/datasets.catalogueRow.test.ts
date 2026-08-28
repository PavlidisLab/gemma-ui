/**
 * The catalogue row, from either producer.
 *
 * 🛑 What this pins, and why it is two assertions rather than one:
 *
 * Gemma's dataset row has **no `taxonCommonName`** — measured on gemma2
 * 2026-08-28, the key is absent from all 30 keys of every row — and
 * carries a nested `taxon` object instead. `useDatasets` read only the
 * flat name, so `taxon` came out `undefined` on every remote row.
 * `WorkflowDatasetRow` declares it `string`, non-optional, so the
 * typechecker had nothing to say.
 *
 * The list survived that, because it happens to write `r.taxon || "—"`.
 * `datasetMatchesQuery` did not: `r.taxon.toLowerCase()` threw inside
 * the caller's `useMemo` and took the dashboard down the moment anyone
 * typed a character into the search box.
 *
 * So: the mapper must read both shapes, AND the matcher must not throw
 * on a field that is missing anyway. Either alone leaves a live crash
 * one wire change away.
 */
import { describe, expect, it } from "vitest";
import {
  datasetMatchesQuery,
  datasetSummaryFromRow,
  type DatasetSummary,
} from "./datasets";
// `taxonLabel` lives in lib/taxon so `DatasetMeta` (design.ts) reads the
// same rule — the same field was missing on `/datasets/{id}` too.
import { taxonLabel, type TaxonBearingRow } from "@/lib/taxon";

/** Gemma's shape, after `snakeify` — trimmed from a live gemma2 row. */
const GEMMA_ROW = {
  id: 1,
  short_name: "GSE2018",
  name: "Lung transplant acute rejection",
  accession: "GSE2018",
  taxon: {
    id: 1,
    scientific_name: "Homo sapiens",
    common_name: "human",
    ncbi_id: 9606,
  },
} as unknown as TaxonBearingRow;

/** local_api's shape — a flat common name, no nested object. */
const STORE_ROW = {
  id: 9,
  short_name: "GSE3253",
  name: "Some study",
  taxon_common_name: "mouse",
} as unknown as TaxonBearingRow;

describe("taxonLabel — one datum, two wire shapes", () => {
  it("reads local_api's flat taxon_common_name", () => {
    expect(taxonLabel(STORE_ROW)).toBe("mouse");
  });

  it("reads Gemma's nested taxon.common_name", () => {
    expect(taxonLabel(GEMMA_ROW)).toBe("human");
  });

  it("falls back to the scientific name when there is no common one", () => {
    const r = { taxon: { scientific_name: "Danio rerio" } } as unknown as TaxonBearingRow;
    expect(taxonLabel(r)).toBe("Danio rerio");
  });

  it("returns a string — never undefined — when neither shape carries one", () => {
    expect(taxonLabel({} as TaxonBearingRow)).toBe("");
    expect(
      taxonLabel({ taxon: null } as unknown as TaxonBearingRow),
    ).toBe("");
  });

  it("invents nothing: an empty flat name does not become a label", () => {
    const r = { taxon_common_name: "" } as unknown as TaxonBearingRow;
    expect(taxonLabel(r)).toBe("");
  });
});

describe("datasetMatchesQuery — cannot throw", () => {
  /** Every field absent. This is the row the remote catalogue actually
   *  produced for `taxon`, generalized: the matcher must survive any of
   *  them going missing, not just the one we already know about. */
  const BARE = { experiment_id: 1 } as unknown as DatasetSummary;

  it("returns false rather than throwing when every field is missing", () => {
    expect(() => datasetMatchesQuery(BARE, "human")).not.toThrow();
    expect(datasetMatchesQuery(BARE, "human")).toBe(false);
  });

  it("an undefined taxon does not stop the other fields matching", () => {
    const r = {
      experiment_id: 1,
      short_name: "GSE2018",
      title: "Lung transplant",
      // taxon undefined — exactly what remote mode produced
    } as unknown as DatasetSummary;
    expect(datasetMatchesQuery(r, "gse2018")).toBe(true);
    expect(datasetMatchesQuery(r, "lung")).toBe(true);
    expect(datasetMatchesQuery(r, "human")).toBe(false);
  });

  it("still matches on taxon when there is one", () => {
    const r = {
      experiment_id: 1,
      short_name: "GSE2018",
      title: "Lung transplant",
      taxon: "human",
    } as unknown as DatasetSummary;
    expect(datasetMatchesQuery(r, "human")).toBe(true);
  });

  it("an empty query matches everything, missing fields included", () => {
    expect(datasetMatchesQuery(BARE, "   ")).toBe(true);
  });
});

/**
 * The catalogue row's counts.
 *
 * 🛑 Neither producer sends factor / FV / tag counts on a list row —
 * not the store's `WorkflowDatasetRow`, not Gemma's
 * `ExpressionExperimentValueObject` — and the mapper wrote a literal
 * `0` for all three. So the list reported "0 factors (0 FVs) 0 tags"
 * for every dataset in both modes, and a curator clicking through to
 * GSE6306 found one factor with six values.
 *
 * A zero is a claim. Undefined is the truth, and the column renders a
 * dash for it.
 */
describe("datasetSummaryFromRow — counts it cannot know", () => {
  const row = { id: 1, short_name: "GSE6306", name: "t" } as never;

  it("leaves the design counts undefined rather than zero", () => {
    const s = datasetSummaryFromRow(row);
    expect(s.n_factors).toBeUndefined();
    expect(s.n_fvs).toBeUndefined();
    expect(s.n_tags).toBeUndefined();
  });

  it("still reports the sample count, which the row does carry", () => {
    const s = datasetSummaryFromRow({
      id: 1,
      short_name: "GSE6306",
      name: "t",
      number_of_bio_assays: 1218,
    } as never);
    expect(s.n_biomaterials).toBe(1218);
  });
});
