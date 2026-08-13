import { describe, expect, it } from "vitest";
import { alertFact, deriveFromTerm } from "./derivedFacts";
import type { AnnotationTermDetail } from "@/api/annotations";

/**
 * Derived facts must never reach the curator dressed as curated content
 * or as the term's own definition. These tests pin the two ways that
 * could happen: a CLO ``disease:`` description leaking into the
 * definition slot, and the Cellosaurus block being dropped or merged
 * into one unattributed row.
 *
 * Wire values are verbatim from gemma2 / frink on 2026-08-12.
 */

const mkTerm = (o: Partial<AnnotationTermDetail> = {}): AnnotationTermDetail => ({
  uri: "http://purl.obolibrary.org/obo/CLO_0008127",
  label: "NCI-H929 cell",
  definition: "",
  parents: [],
  synonyms: [],
  alternativeIds: [],
  xrefs: [],
  ontologyVersion: "2026-06-19",
  ontology: "clo",
  source: "gemma",
  canonicalUrl: null,
  ...o,
});

describe("CLO description → derived cell-line notes", () => {
  it("lifts a disease: description out of the definition slot", () => {
    const r = deriveFromTerm(
      mkTerm({ definition: "disease: plasmacytoma;   myeloma" }),
    );
    // The definition slot must end up EMPTY — rendering the string
    // there would present a catalogue inference as the term's meaning.
    expect(r.definition).toBe("");
    expect(r.facts.map((f) => f.value)).toEqual(["plasmacytoma", "myeloma"]);
    // NOT "disease": 41% of CLO's disease: values are construction
    // methods, not diagnoses (geb's survey, 2026-08-12).
    expect(r.facts.every((f) => f.relation === "cell line note")).toBe(true);
    expect(r.facts.every((f) => f.source === "CLO")).toBe(true);
  });

  it("splits multiple diseases into separate facts, not one blob", () => {
    const r = deriveFromTerm(mkTerm({ definition: "disease: a; b; c" }));
    expect(r.facts).toHaveLength(3);
  });

  it("never claims a disease for a value that is not one", () => {
    // CLO_0004312 "hybridoma 231 cell" really ships this. Rendering it
    // as a disease invents a clinical claim out of a lab technique.
    const r = deriveFromTerm(
      mkTerm({
        uri: "http://purl.obolibrary.org/obo/CLO_0004312",
        definition: "disease: hybridoma",
      }),
    );
    expect(r.facts).toHaveLength(1);
    expect(r.facts[0].relation).not.toBe("disease");
    expect(r.facts[0].value).toBe("hybridoma");
    expect(r.facts[0].sourceDetail).toContain("disease:");
  });

  it("handles the single-value form", () => {
    const r = deriveFromTerm(
      mkTerm({ definition: "disease: rhabdomyosarcoma" }),
    );
    expect(r.facts.map((f) => f.value)).toEqual(["rhabdomyosarcoma"]);
  });

  it("leaves a genuine prose definition untouched", () => {
    // CLO_0037272 (TMD8) — same field, same ontology, real definition.
    const prose =
      "An immortal human B cell line cell originating from the bone marrow " +
      "of humans with diffuse large B-cell lymphoma.";
    const r = deriveFromTerm(
      mkTerm({
        uri: "http://purl.obolibrary.org/obo/CLO_0037272",
        definition: prose,
      }),
    );
    expect(r.definition).toBe(prose);
    expect(r.facts).toEqual([]);
  });

  it("does not pattern-match non-CLO definitions", () => {
    // A prose definition on another ontology that happens to open with
    // a word and a colon must survive intact.
    const r = deriveFromTerm(
      mkTerm({
        uri: "http://purl.obolibrary.org/obo/MONDO_0009693",
        definition: "disease: this is prose that merely looks structured",
      }),
    );
    expect(r.definition).toBe(
      "disease: this is prose that merely looks structured",
    );
    expect(r.facts).toEqual([]);
  });

  it("an empty definition yields nothing", () => {
    expect(deriveFromTerm(mkTerm({ definition: "" }))).toEqual({
      definition: "",
      facts: [],
    });
  });
});

describe("Cellosaurus sourceMetadata → derived facts", () => {
  const kb = () =>
    mkTerm({
      uri: "https://www.cellosaurus.org/CVCL_0372",
      label: "KB",
      sourceMetadata: {
        species: [{ ncbiTaxonId: 9606, label: "Homo sapiens (Human)" }],
        cellLineType: "Cancer cell line",
        sex: "Female",
        strainType: null,
        problematic: "Contaminated",
      },
    });

  it("reads every populated field", () => {
    const { facts } = deriveFromTerm(kb());
    expect(facts.map((f) => f.relation)).toEqual([
      "problematic",
      "species",
      "cell line type",
      "sex",
    ]);
    expect(facts.every((f) => f.source === "Cellosaurus")).toBe(true);
  });

  it("puts the contamination flag first and marks it as a warning", () => {
    const { facts } = deriveFromTerm(kb());
    expect(facts[0].relation).toBe("problematic");
    expect(facts[0].tone).toBe("warn");
    expect(alertFact(facts)?.value).toBe("Contaminated");
  });

  it("a clean line raises no alert", () => {
    const hela = mkTerm({
      uri: "https://www.cellosaurus.org/CVCL_0030",
      sourceMetadata: {
        species: [{ ncbiTaxonId: 9606, label: "Homo sapiens (Human)" }],
        cellLineType: "Cancer cell line",
        sex: "Female",
        strainType: null,
        problematic: null,
      },
    });
    expect(alertFact(deriveFromTerm(hela).facts)).toBeNull();
  });

  it("carries the taxon id alongside the species label", () => {
    const { facts } = deriveFromTerm(kb());
    expect(facts.find((f) => f.relation === "species")?.value).toBe(
      "Homo sapiens (Human) · NCBI Taxon 9606",
    );
  });

  it("keeps strainType — the same slot carries mouse strains", () => {
    const strain = mkTerm({
      uri: "https://www.cellosaurus.org/CVCL_XXXX",
      sourceMetadata: { strainType: "Inbred strain" },
    });
    const { facts } = deriveFromTerm(strain);
    expect(facts).toEqual([
      {
        relation: "strain type",
        value: "Inbred strain",
        source: "Cellosaurus",
        sourceDetail: "strain-type",
        tone: "info",
      },
    ]);
  });

  it("a term with no sourceMetadata yields no facts", () => {
    expect(deriveFromTerm(mkTerm()).facts).toEqual([]);
  });

  it("blank strings are not facts", () => {
    const blank = mkTerm({
      uri: "https://www.cellosaurus.org/CVCL_XXXX",
      sourceMetadata: { sex: "  ", cellLineType: "", problematic: null },
    });
    expect(deriveFromTerm(blank).facts).toEqual([]);
  });
});

describe("both sources at once", () => {
  it("CLO disease and Cellosaurus facts coexist, CLO first", () => {
    const { definition, facts } = deriveFromTerm(
      mkTerm({
        definition: "disease: plasmacytoma",
        sourceMetadata: { sex: "Female" },
      }),
    );
    expect(definition).toBe("");
    expect(facts.map((f) => [f.source, f.relation])).toEqual([
      ["CLO", "cell line note"],
      ["Cellosaurus", "sex"],
    ]);
  });
});
