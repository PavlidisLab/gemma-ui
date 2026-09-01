/**
 * A statement annotation reads as subject · predicate · object.
 *
 * 🛑 **`value` is the subject.** Gemma's `731ecfa1d0` gave that meaning
 * to an existing field rather than adding one called `subject` — which
 * is why looking for `subject` in a field list found nothing and cost a
 * day. Every fixture below is the shape the live wire actually sends,
 * measured on gemma2 `e9dd6b7f7b`.
 *
 * This file used to be organised around a pre/post-rename split and
 * carried six cases for a string-subtraction parser that recovered the
 * subject out of `termName`. That parser is gone — the wire carries the
 * subject — so the cases that pinned its edge behaviour went with it.
 * What survives is what still has to be true.
 */
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
  it("a plain characteristic is not a statement", () => {
    // No predicate and no object — the common case, and it must not
    // render as a one-legged statement.
    expect(
      parseAnnotationStatement(
        ann({
          className: "organism part",
          value: "lung",
          valueUri: "http://purl.obolibrary.org/obo/UBERON_0002048",
          termName: "lung",
        }),
      ),
    ).toBeNull();
  });

  it("reads subject, predicate and object straight off the wire", () => {
    // eid 1658, verbatim.
    const stmt = parseAnnotationStatement(
      ann({
        className: "treatment",
        value: "hypochlorous acid",
        valueUri: "http://purl.obolibrary.org/obo/CHEBI_24757",
        termName: "hypochlorous acid",
        predicate: "delivered at dose",
        predicateUri: "http://gemma.msl.ubc.ca/ont/TGEMO_00166",
        object: "0.4 mM",
        objectUri: null,
      }),
    );
    expect(stmt).toEqual({
      subject: "hypochlorous acid",
      subjectUri: "http://purl.obolibrary.org/obo/CHEBI_24757",
      pairs: [
        {
          predicate: "delivered at dose",
          predicateUri: "http://gemma.msl.ubc.ca/ont/TGEMO_00166",
          object: "0.4 mM",
          objectUri: null,
        },
      ],
    });
  });

  it("carries both pairs when a subject has two", () => {
    // Gemma's wire holds exactly two slots; there is no third.
    const stmt = parseAnnotationStatement(
      ann({
        value: "Listeria monocytogenes",
        valueUri: "http://purl.obolibrary.org/obo/NCBITaxon_1639",
        termName: "Listeria monocytogenes",
        predicate: "has_genotype",
        predicateUri: "http://purl.obolibrary.org/obo/GENO_0000222",
        object: "delta-A",
        objectUri: null,
        secondPredicate: "has_genotype",
        secondPredicateUri: "http://purl.obolibrary.org/obo/GENO_0000222",
        secondObject: "delta-inlB",
        secondObjectUri: null,
      }),
    );
    expect(stmt?.subject).toBe("Listeria monocytogenes");
    expect(stmt?.pairs.map((p) => p.object)).toEqual(["delta-A", "delta-inlB"]);
  });

  it("🛑 keeps two rows apart that would otherwise read identically", () => {
    // Gemma STRIPS `has developmental stage` from the composed string,
    // so both of these render as "prime adult stage" on a page that
    // shows `termName` alone — 6-month mice and 20-year-old humans,
    // indistinguishable. The object was on the wire the whole time.
    const mouse = parseAnnotationStatement(
      ann({
        className: "developmental stage",
        value: "prime adult stage",
        termName: "prime adult stage",
        predicate: "has developmental stage",
        predicateUri: "http://gemma.msl.ubc.ca/ont/TGEMO_00168",
        object: "6 month",
      }),
    );
    const human = parseAnnotationStatement(
      ann({
        className: "developmental stage",
        value: "prime adult stage",
        termName: "prime adult stage",
        predicate: "has developmental stage",
        predicateUri: "http://gemma.msl.ubc.ca/ont/TGEMO_00168",
        object: "20-31 years",
      }),
    );
    expect(mouse?.subject).toBe(human?.subject);
    expect(mouse?.pairs[0].object).toBe("6 month");
    expect(human?.pairs[0].object).toBe("20-31 years");
  });

  it("needs no special case for the predicates Gemma strips", () => {
    // dose, duration and stage are stripped from `termName` only. The
    // parser never looks at `termName`, so there is nothing to special-
    // case — the deleted version needed a vocabulary of three URIs.
    for (const [predicate, object] of [
      ["delivered at dose", "10 uM"],
      ["delivered for duration", "48 h"],
      ["has developmental stage", "1 month"],
    ]) {
      const stmt = parseAnnotationStatement(
        ann({ value: "dexamethasone", termName: "dexamethasone", predicate, object }),
      );
      expect(stmt?.pairs[0]).toMatchObject({ predicate, object });
    }
  });

  it("🛑 a row with no subject label degrades, it does not guess", () => {
    // A server predating the rename sends no `value`. Returning null
    // makes the caller render `termName` verbatim — today's behaviour
    // for anything unparseable. Inventing a subject would be worse than
    // the run-on string it replaced.
    expect(
      parseAnnotationStatement(
        ann({
          termName: "Homozygous negative  Il10 [mouse] interleukin 10",
          predicate: "has_genotype",
          object: "Homozygous negative",
        }),
      ),
    ).toBeNull();
  });

  it("a predicate with no object still forms a pair", () => {
    // Half a pair is on the wire, so it is shown; suppressing it would
    // hide a real annotation.
    const stmt = parseAnnotationStatement(
      ann({ value: "brain", termName: "brain", predicate: "has role" }),
    );
    expect(stmt?.pairs).toEqual([
      { predicate: "has role", predicateUri: null, object: null, objectUri: null },
    ]);
  });
});
