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

describe("clause-stripped predicates", () => {
  const TGEMO = (n: string) => `http://gemma.msl.ubc.ca/ont/TGEMO_${n}`;
  const row = (over: Partial<DatasetAnnotation>): DatasetAnnotation =>
    ({
      objectClass: "FactorValue",
      className: "developmental stage",
      classUri: null,
      termName: "prime adult stage",
      termUri: "http://purl.obolibrary.org/obo/UBERON_0018241",
      predicate: "has developmental stage",
      predicateUri: TGEMO("00168"),
      object: "6 month",
      objectUri: null,
      ...over,
    }) as DatasetAnnotation;

  it("🛑 recovers the object Gemma strips from termName", () => {
    // Real row, eid 27103. Gemma's `ignoredPredicates` drops the whole
    // clause from the composed string, so `termName` is already the
    // bare subject — but `object` was never dropped from the wire.
    const s = parseAnnotationStatement(row({}));
    expect(s?.subject).toBe("prime adult stage");
    expect(s?.pairs[0].object).toBe("6 month");
  });

  it("keeps two experiments apart that otherwise read identically", () => {
    // Both are `prime adult stage`: 6-month mice and 20-31-year-old
    // humans. Without the object the page cannot tell them apart.
    const mouse = parseAnnotationStatement(row({ object: "6 month" }));
    const human = parseAnnotationStatement(row({ object: "20-31 years" }));
    expect(mouse?.pairs[0].object).not.toBe(human?.pairs[0].object);
  });

  it("covers dose and duration too", () => {
    for (const [uri, obj] of [
      [TGEMO("00166"), "10 µM"],
      [TGEMO("00167"), "24 h"],
    ]) {
      const s = parseAnnotationStatement(
        row({ termName: "dexamethasone", predicateUri: uri, object: obj }),
      );
      expect(s?.subject).toBe("dexamethasone");
      expect(s?.pairs[0].object).toBe(obj);
    }
  });

  it("🛑 refuses a row mixing a stripped clause with a composed one", () => {
    // The composed clause is still inside `termName`, so treating it as
    // the subject would print that clause twice.
    const s = parseAnnotationStatement(
      row({
        termName: "prime adult stage has background APP/PS1",
        secondPredicate: "has background",
        secondPredicateUri: "http://gemma.msl.ubc.ca/ont/TGEMO_00216",
        secondObject: "APP/PS1",
      }),
    );
    expect(s).toBeNull();
  });
});

describe("b5c6747f68 rename compatibility", () => {
  const TGEMO = (n: string) => `http://gemma.msl.ubc.ca/ont/TGEMO_${n}`;

  it("a pre-rename row and its post-rename equivalent parse to the same statement", () => {
    // Same real row as "splits a one-pair statement" above: once as a
    // pre-rename payload (termName/termUri only, composed sentence),
    // and once as `withDatasetAnnotationCompat` (api/endpoints.ts)
    // would leave it post-rename — `value`/`valueUri` present and
    // coalesced onto termName/termUri too.
    const preRename = ann({
      termUri: "http://purl.org/commons/record/ncbi_gene/16153",
      termName: "Homozygous negative  Il10 [mouse] interleukin 10",
      predicate: "has_genotype",
      predicateUri: "http://purl.obolibrary.org/obo/GENO_0000222",
      object: "Homozygous negative",
      objectUri: "http://gemma.msl.ubc.ca/ont/TGEMO_00001",
    });
    const postRename = ann({
      termUri: "http://purl.org/commons/record/ncbi_gene/16153",
      termName: "Il10 [mouse] interleukin 10",
      valueUri: "http://purl.org/commons/record/ncbi_gene/16153",
      value: "Il10 [mouse] interleukin 10",
      predicate: "has_genotype",
      predicateUri: "http://purl.obolibrary.org/obo/GENO_0000222",
      object: "Homozygous negative",
      objectUri: "http://gemma.msl.ubc.ca/ont/TGEMO_00001",
    });
    expect(parseAnnotationStatement(postRename)).toEqual(parseAnnotationStatement(preRename));
  });

  it("🛑 a post-rename dose row still recovers the dose, with no ignoredPredicates special case", () => {
    // Same case as "🛑 recovers the object Gemma strips from termName"
    // above, but as it looks once Gemma serves b5c6747f68: `value` is
    // already the bare subject for every predicate, not just the
    // three ignoredPredicates ones, so the `a.value` branch handles it
    // directly instead of falling through to `isStripped`.
    const s = parseAnnotationStatement(
      ann({
        className: "developmental stage",
        termUri: "http://purl.obolibrary.org/obo/UBERON_0018241",
        termName: "prime adult stage",
        valueUri: "http://purl.obolibrary.org/obo/UBERON_0018241",
        value: "prime adult stage",
        predicate: "has developmental stage",
        predicateUri: TGEMO("00168"),
        object: "6 month",
      }),
    );
    expect(s?.subject).toBe("prime adult stage");
    expect(s?.pairs[0].object).toBe("6 month");
  });

  it("two post-rename rows both reading 'prime adult stage' stay distinguishable by object", () => {
    // Same guarantee as "keeps two experiments apart" above — 6-month
    // mice vs. 20-31-year-old humans — proven against a post-rename row.
    const statementFor = (object: string) =>
      parseAnnotationStatement(
        ann({
          termUri: "http://purl.obolibrary.org/obo/UBERON_0018241",
          termName: "prime adult stage",
          valueUri: "http://purl.obolibrary.org/obo/UBERON_0018241",
          value: "prime adult stage",
          predicate: "has developmental stage",
          predicateUri: TGEMO("00168"),
          object,
        }),
      );
    const mouse = statementFor("6 month");
    const human = statementFor("20-31 years");
    expect(mouse?.pairs[0].object).not.toBe(human?.pairs[0].object);
  });
});
