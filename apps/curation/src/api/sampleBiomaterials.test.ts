/**
 * Pinned against real gemma2 bytes, because the bug this fixes was
 * invisible in types: `composeDesign` read per-sample characteristics
 * off a `biomaterials` array that Gemma's `/design` has never sent, so
 * every Gemma-backed sample composed with `characteristics: {}` and
 * every surface built on them — the sample table's columns, the
 * popover, the inherited-chip projection — rendered empty and correct
 * at the same time.
 *
 * FIXTURE: `GET https://gemma2.msl.ubc.ca/rest/v2/datasets/91164/samples`
 * (GSE324761), captured 2026-08-29, first two of four assays, passed
 * through the client's `snakeify` so it is shaped exactly as the parser
 * sees it. GSE324761 is the case Paul hit: `MCF7 cell` drove six
 * inferred relations while appearing nowhere in the UI.
 */
import { describe, expect, it } from "vitest";
import { toSampleBiomaterials } from "./sampleBiomaterials";

const SAMPLES_91164 = [
  {
    id: 1967342,
    name: "MCF7 Mock 6 hours, replicate a",
    accession: { accession: "GSM9585113" },
    sample: {
      id: 1961186,
      name: "GSE324761_Biomat_1",
      characteristics: [
        {
          id: 55441635,
          category: "cell line",
          category_uri: "http://purl.obolibrary.org/obo/CLO_0000031",
          value: "MCF7 cell",
          value_uri: "http://purl.obolibrary.org/obo/CLO_0007606",
          original_value: "cell line: MCF7",
        },
        {
          id: 55441636,
          category: "treatment",
          category_uri: "http://www.ebi.ac.uk/efo/EFO_0000727",
          value: "none",
          value_uri: null,
          original_value: "treatment: none",
        },
        {
          id: 55441637,
          category: "BioSource",
          category_uri: null,
          value: "MCF7",
          value_uri: null,
          original_value: "MCF7",
        },
        {
          id: 55441638,
          category: "molecular entity",
          category_uri: "http://purl.obolibrary.org/obo/CHEBI_23367",
          value: "total RNA",
          value_uri: "http://www.ebi.ac.uk/efo/EFO_0004964",
        },
      ],
    },
  },
  {
    id: 1967343,
    name: "MCF7 SALSa (119) 6 hours replicate b",
    accession: { accession: "GSM9585116" },
    sample: {
      id: 1961187,
      name: "GSE324761_Biomat_4",
      characteristics: [
        {
          id: 55441639,
          category: "cell line",
          category_uri: "http://purl.obolibrary.org/obo/CLO_0000031",
          value: "MCF7 cell",
          value_uri: "http://purl.obolibrary.org/obo/CLO_0007606",
          original_value: "cell line: MCF7",
        },
      ],
    },
  },
];

describe("toSampleBiomaterials — real gemma2 bytes", () => {
  const rows = toSampleBiomaterials(SAMPLES_91164);

  it("yields one row per biomaterial", () => {
    expect(rows.map((r) => r.short_name)).toEqual([
      "GSE324761_Biomat_1",
      "GSE324761_Biomat_4",
    ]);
  });

  it("recovers MCF7 — the characteristic the UI showed as (0)", () => {
    expect(rows[0].characteristics).toEqual({
      "cell line": "MCF7 cell",
      treatment: "none",
      BioSource: "MCF7",
      "molecular entity": "total RNA",
    });
  });

  it("carries the URIs, which is what makes the chip groundable", () => {
    expect(rows[0].characteristic_uris["cell line"]).toEqual({
      category_uri: "http://purl.obolibrary.org/obo/CLO_0000031",
      value_uri: "http://purl.obolibrary.org/obo/CLO_0007606",
    });
    // Ungrounded free text keeps its slot with nulls rather than being
    // dropped — the popover shows the value either way.
    expect(rows[0].characteristic_uris.BioSource).toEqual({
      category_uri: null,
      value_uri: null,
    });
  });

  it("carries the GSM, which no other payload on this path does", () => {
    expect(rows.map((r) => r.accession)).toEqual(["GSM9585113", "GSM9585116"]);
  });

  it("keys on the same short name composeDesign derives", () => {
    // `bio_material_assignments[].bio_material_name` on this dataset is
    // the bare `GSE324761_Biomat_1` — no pipe, so `parseShortName`
    // returns it whole and the two sides meet.
    expect(rows[0].short_name).toBe("GSE324761_Biomat_1");
  });
});

describe("the shapes that are not GSE324761", () => {
  it("splits a piped name the way parseShortName does", () => {
    const rows = toSampleBiomaterials([
      {
        id: 1,
        name: "assay",
        accession: { accession: "GSM36429" },
        sample: {
          id: 9,
          name: "GSE2018_bioMaterial_7|GSM36429",
          characteristics: [{ category: "sex", value: "female" }],
        },
      },
    ]);
    expect(rows[0].short_name).toBe("GSM36429");
  });

  it("folds several assays onto one biomaterial", () => {
    const rows = toSampleBiomaterials([
      {
        id: 1,
        name: "lane 1",
        accession: { accession: "GSM1" },
        sample: { id: 9, name: "BM", characteristics: [] },
      },
      {
        id: 2,
        name: "lane 2",
        accession: { accession: "GSM2" },
        sample: { id: 9, name: "BM", characteristics: [] },
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].bio_assays.map((a) => a.short_name)).toEqual([
      "GSM1",
      "GSM2",
    ]);
    // First assay naming a GSM wins the join key.
    expect(rows[0].accession).toBe("GSM1");
  });

  it("joins a repeated category rather than dropping half of it", () => {
    // Zero collisions in 84 samples across 4 datasets (2026-08-29), but
    // the map cannot hold two values and a silent drop is unreadable.
    const rows = toSampleBiomaterials([
      {
        id: 1,
        name: "a",
        accession: null,
        sample: {
          id: 9,
          name: "BM",
          characteristics: [
            { category: "treatment", value: "drug A" },
            { category: "treatment", value: "drug B" },
          ],
        },
      },
    ]);
    expect(rows[0].characteristics.treatment).toBe("drug A; drug B");
  });

  it("skips a characteristic with no category or no value", () => {
    const rows = toSampleBiomaterials([
      {
        id: 1,
        name: "a",
        accession: null,
        sample: {
          id: 9,
          name: "BM",
          characteristics: [
            { category: "", value: "orphan" },
            { category: "sex", value: "  " },
            { category: "organism part", value: "liver" },
          ],
        },
      },
    ]);
    expect(rows[0].characteristics).toEqual({ "organism part": "liver" });
  });

  it("ignores an assay with no biomaterial", () => {
    expect(toSampleBiomaterials([{ id: 1, name: "a", sample: null }])).toEqual(
      [],
    );
  });
});
