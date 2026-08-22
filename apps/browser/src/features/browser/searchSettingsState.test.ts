import { describe, expect, it } from "vitest";
import { makeInitialSettings } from "./searchSettingsState";
import {
  MICROARRAY_TECHNOLOGY_TYPES,
  RNA_SEQ_TECHNOLOGY_TYPES,
} from "@/lib/platformConstants";
import type { Taxon } from "@/lib/types";

const DISEASE = "http://www.ebi.ac.uk/efo/EFO_0000408";
const ALZHEIMER = "http://purl.obolibrary.org/obo/MONDO_0004975";

const TAXA = [
  { id: 1, commonName: "human", scientificName: "Homo sapiens" },
  { id: 2, commonName: "mouse", scientificName: "Mus musculus" },
] as Taxon[];

describe("makeInitialSettings — a shared search", () => {
  it("keeps the shared query when the route carries none", () => {
    // Regression: base.query was assigned unconditionally, so every
    // ?s= link lost its query — /browser has no $query route param.
    const s = makeInitialSettings({ shared: { query: "hippocampus", currentQuery: "hippocampus" } });
    expect(s.query).toBe("hippocampus");
    expect(s.currentQuery).toBe("hippocampus");
  });

  it("lets an explicit route query win over the shared one", () => {
    const s = makeInitialSettings({
      query: "from the route",
      shared: { query: "from the link" },
    });
    expect(s.query).toBe("from the route");
  });

  it("restores the rest of the shared selection", () => {
    const s = makeInitialSettings({
      shared: {
        taxon: [{ id: 2 }] as never,
        technologyTypes: ["SEQUENCING"],
        annotations: [
          { classUri: DISEASE, className: "disease", termUri: ALZHEIMER, termName: "Alzheimer disease" },
        ],
        ignoreExcludedTerms: true,
      },
    });
    expect(s.taxon.map((t) => t.id)).toEqual([2]);
    expect(s.technologyTypes).toEqual(["SEQUENCING"]);
    expect(s.annotations).toHaveLength(1);
    expect(s.ignoreExcludedTerms).toBe(true);
  });

  it("starts empty when nothing is supplied", () => {
    const s = makeInitialSettings({});
    expect(s.query).toBeUndefined();
    expect(s.taxon).toEqual([]);
    expect(s.annotations).toEqual([]);
    expect(s.ignoreExcludedTerms).toBe(false);
  });
});

describe("makeInitialSettings — deep links from the home page", () => {
  it("seeds a whole-category include from ?categoryUri=", () => {
    const s = makeInitialSettings({ categoryUri: DISEASE, categoryLabel: "disease" });
    expect(s.categories).toEqual([{ classUri: DISEASE, className: "disease" }]);
    expect(s.annotations).toEqual([]);
  });

  it("seeds a single term from ?annotationUri=, scoped by the category", () => {
    const s = makeInitialSettings({
      categoryUri: DISEASE,
      categoryLabel: "disease",
      annotationUri: ALZHEIMER,
      annotationLabel: "Alzheimer disease",
    });
    expect(s.annotations).toEqual([
      { classUri: DISEASE, className: "disease", termUri: ALZHEIMER, termName: "Alzheimer disease" },
    ]);
    // NOT also a whole-category include: that would widen the result
    // far past the term that was clicked.
    expect(s.categories).toEqual([]);
  });
});

describe("makeInitialSettings — taxon and technology presets", () => {
  it("matches an initial taxon by common name, id, or scientific name", () => {
    for (const key of ["mouse", "2", "Mus musculus"]) {
      const s = makeInitialSettings({ initialTaxon: key, taxa: TAXA });
      expect(s.taxon.map((t) => t.id)).toEqual([2]);
    }
  });

  it("ignores an initial taxon that matches nothing", () => {
    expect(makeInitialSettings({ initialTaxon: "wombat", taxa: TAXA }).taxon).toEqual([]);
  });

  it("maps the technology presets onto their type lists", () => {
    expect(makeInitialSettings({ preset: "rnaseq" }).technologyTypes).toEqual([
      ...RNA_SEQ_TECHNOLOGY_TYPES,
    ]);
    expect(makeInitialSettings({ preset: "microarray" }).technologyTypes).toEqual([
      ...MICROARRAY_TECHNOLOGY_TYPES,
    ]);
  });

  it("seeds scrnaseq with the single-cell assay annotations too", () => {
    const s = makeInitialSettings({ preset: "scrnaseq" });
    expect(s.technologyTypes).toEqual(["SEQUENCING"]);
    expect(s.annotations.map((a) => a.termUri)).toEqual([
      "http://purl.obolibrary.org/obo/OBI_0003109",
      "http://purl.obolibrary.org/obo/OBI_0002631",
    ]);
  });
});
