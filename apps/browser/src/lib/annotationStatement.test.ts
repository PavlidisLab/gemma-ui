import { describe, expect, it } from "vitest";
import { parseAnnotationStatement } from "./annotationStatement";
import type { DatasetAnnotation } from "./types";

function ann(overrides: Partial<DatasetAnnotation>): DatasetAnnotation {
  return {
    objectClass: "FactorValue",
    className: "genotype",
    classUri: null,
    termName: "",
    termUri: null,
    ...overrides,
  };
}

describe("parseAnnotationStatement", () => {
  it("a plain (non-statement) annotation returns null", () => {
    const a = ann({
      className: "organism part",
      termName: "lung",
      termUri: "http://purl.obolibrary.org/obo/UBERON_0002048",
    });
    expect(parseAnnotationStatement(a)).toBeNull();
  });

  it("splits a one-pair statement — real gemma2 shape (subject + genotype)", () => {
    // GET /rest/v2/datasets/1000/annotations, verified 2026-08-30.
    const a = ann({
      termUri: "http://purl.org/commons/record/ncbi_gene/16153",
      termName: "Homozygous negative  Il10 [mouse] interleukin 10",
      predicate: "has_genotype",
      predicateUri: "http://purl.obolibrary.org/obo/GENO_0000222",
      object: "Homozygous negative",
      objectUri: "http://gemma.msl.ubc.ca/ont/TGEMO_00001",
    });
    const stmt = parseAnnotationStatement(a);
    expect(stmt).toEqual({
      subject: "Il10 [mouse] interleukin 10",
      subjectUri: "http://purl.org/commons/record/ncbi_gene/16153",
      pairs: [
        {
          predicate: "has_genotype",
          predicateUri: "http://purl.obolibrary.org/obo/GENO_0000222",
          object: "Homozygous negative",
          objectUri: "http://gemma.msl.ubc.ca/ont/TGEMO_00001",
        },
      ],
    });
  });

  it("splits a two-pair statement — real gemma2 shape (double genotype)", () => {
    // GET /rest/v2/datasets/500/annotations, verified 2026-08-30.
    const a = ann({
      className: "treatment",
      termUri: "http://purl.obolibrary.org/obo/NCBITaxon_1639",
      termName: "delta-A  delta-inlB  Listeria monocytogenes",
      predicate: "has_genotype",
      predicateUri: "http://purl.obolibrary.org/obo/GENO_0000222",
      object: "delta-A",
      objectUri: null,
      secondPredicate: "has_genotype",
      secondPredicateUri: "http://purl.obolibrary.org/obo/GENO_0000222",
      secondObject: "delta-inlB",
      secondObjectUri: null,
    });
    const stmt = parseAnnotationStatement(a);
    expect(stmt?.subject).toBe("Listeria monocytogenes");
    expect(stmt?.subjectUri).toBe("http://purl.obolibrary.org/obo/NCBITaxon_1639");
    expect(stmt?.pairs).toHaveLength(2);
    expect(stmt?.pairs[0]).toMatchObject({ predicate: "has_genotype", object: "delta-A" });
    expect(stmt?.pairs[1]).toMatchObject({ predicate: "has_genotype", object: "delta-inlB" });
  });

  it("falls back to null when termName doesn't decompose cleanly (predicate spelled out inline)", () => {
    // GET /rest/v2/datasets/3000/annotations, verified 2026-08-30 — the
    // "subject predicate object" single-space shape isn't reversible
    // (the object text alone doesn't isolate the subject prefix).
    const a = ann({
      className: "organism part",
      termUri: "http://purl.obolibrary.org/obo/UBERON_0000955",
      termName: "brain has role reference subject role",
      predicate: "has role",
      predicateUri: "http://purl.obolibrary.org/obo/RO_0000087",
      object: "reference subject role",
      objectUri: "http://purl.obolibrary.org/obo/OBI_0000220",
    });
    expect(parseAnnotationStatement(a)).toBeNull();
  });

  it("falls back to null when the predicate is paraphrased instead of concatenated", () => {
    // GET /rest/v2/datasets/3000/annotations, verified 2026-08-30 —
    // "has modifier" renders as "with" in termName.
    const a = ann({
      className: "disease",
      termUri: "http://purl.obolibrary.org/obo/MONDO_0021636",
      termName: "astrocytic tumor with grade II",
      predicate: "has modifier",
      predicateUri: null,
      object: "grade II",
      objectUri: null,
    });
    expect(parseAnnotationStatement(a)).toBeNull();
  });

  it("a predicate with no object at all has nothing to anchor the split on", () => {
    const a = ann({
      termName: "some phrase",
      predicate: "has role",
      predicateUri: "http://example.org/has_role",
    });
    expect(parseAnnotationStatement(a)).toBeNull();
  });
});
