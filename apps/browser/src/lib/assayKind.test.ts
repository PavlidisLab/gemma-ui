/**
 * What kind of data a dataset holds.
 *
 * 🛑 The platform's `technologyType` is the WRONG first answer. Gemma
 * maps sequencing onto generic gene-list platforms, so an ordinary
 * bulk RNA-seq experiment reports `GENELIST` — which this repo's own
 * `TOP_TECHNOLOGY_TYPES` labels "Other". Telling a reader their
 * RNA-seq dataset is "Other" is worse than saying nothing.
 *
 * Fixture copied verbatim from `GET /datasets/28143` (GSE217927): a
 * mouse dataset on `Generic_mouse_ncbiIds` / `GENELIST` whose own
 * characteristics say `bulk RNA-seq assay`.
 */
import { describe, expect, it } from "vitest";
import { assayKindLabel, technologyTypeLabel } from "./platformConstants";

const REAL = [
  { category: "study design", value: "Transcriptional Regulator Perturbation Experiment" },
  { category: "developmental stage", value: "prime adult stage" },
  {
    category: "assay",
    categoryUri: "http://purl.obolibrary.org/obo/OBI_0000070",
    value: "bulk RNA-seq assay",
  },
];

describe("assayKindLabel", () => {
  it("finds the assay among other characteristics", () => {
    expect(assayKindLabel(REAL)).toBe("bulk RNA-seq assay");
  });

  it("matches on the category URI, not just the label", () => {
    // The label is free text and has changed before; the URI is the
    // stable half.
    expect(
      assayKindLabel([
        { category: "ASSAY TYPE", categoryUri: "http://purl.obolibrary.org/obo/OBI_0000070", value: "single cell RNA sequencing assay" },
      ]),
    ).toBe("single cell RNA sequencing assay");
  });

  it("returns null when there is no assay annotation, so the caller can fall back", () => {
    expect(assayKindLabel([{ category: "disease", value: "asthma" }])).toBeNull();
    expect(assayKindLabel([])).toBeNull();
    expect(assayKindLabel(null)).toBeNull();
  });

  it("ignores an assay row with an empty value", () => {
    expect(assayKindLabel([{ category: "assay", value: "  " }])).toBeNull();
  });
});

describe("technologyTypeLabel — the fallback, and why it is only that", () => {
  it("names the ones it can", () => {
    expect(technologyTypeLabel("SEQUENCING")).toBe("RNA-Seq");
    expect(technologyTypeLabel("ONECOLOR")).toBe("Microarray");
  });

  it("labels a real RNA-seq dataset's platform 'Other' — the reason it is second", () => {
    // GSE217927 is bulk RNA-seq and its platform is GENELIST.
    expect(technologyTypeLabel("GENELIST")).toBe("Other");
    // ...which is why assayKindLabel wins when it has an answer.
    expect(assayKindLabel(REAL)).toBe("bulk RNA-seq assay");
  });

  it("returns null for an unknown or absent type rather than inventing one", () => {
    expect(technologyTypeLabel("SOMETHING_NEW")).toBeNull();
    expect(technologyTypeLabel(null)).toBeNull();
  });
});
