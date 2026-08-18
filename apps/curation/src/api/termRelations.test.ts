/**
 * The two rules the payload forces, against bytes gemma2 actually
 * serves.
 *
 * Captured from
 * `GET /rest/v2/annotations/relations/implies?from=<MONDO_0004975>` on
 * build `337011bbeb` (2026-08-18) and snakeified the way `api.client`
 * snakeifies every response. Captured rather than hand-written because
 * a case mismatch on a nested field renders identically to "nothing
 * known" — the same trap `provenanceWire.test.tsx` exists for.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_OBJECT_BREADTH,
  mergeRelations,
  rankRelations,
  withinBreadth,
  type RelationRow,
} from "./termRelations";

/** Two of the three wire rows for ONE fact — `Alzheimer has_genotype
 *  APP/PS1` — split on `subjectCategory` case and a grounded-vs-null
 *  `objectUri`, carrying support 1 and 10 respectively. */
const APP_PS1_GROUNDED: RelationRow = {
  subject: "Alzheimer disease",
  subject_uri: "http://purl.obolibrary.org/obo/MONDO_0004975",
  subject_category: "disease",
  predicate: "has_genotype",
  predicate_uri: "http://purl.obolibrary.org/obo/GENO_0000222",
  object: "APP/PS1",
  object_uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00174",
  object_category: null,
  taxon_id: 2,
  taxon_name: "mouse",
  basis: "CURATED",
  number_of_experiments: 1,
  object_breadth: 3,
  specificity: 0.0,
  example_dataset_id: 31951,
  corroborated: true,
};

const APP_PS1_BARE: RelationRow = {
  ...APP_PS1_GROUNDED,
  subject_category: "Disease model",
  object_uri: null,
  number_of_experiments: 10,
  example_dataset_id: 20187,
};

/** CLO's own restriction. 🛑 support 0 — asserted rows are not counted. */
const CLO_ASSERTED: RelationRow = {
  subject: "AG07671 cell",
  subject_uri: "http://purl.obolibrary.org/obo/CLO_0032907",
  subject_category: "cell line",
  predicate: "is disease model for",
  predicate_uri: "http://purl.obolibrary.org/obo/CLO_0000179",
  object: "Alzheimer disease",
  object_uri: "http://purl.obolibrary.org/obo/MONDO_0004975",
  object_category: "disease",
  taxon_id: null,
  taxon_name: null,
  basis: "ONTOLOGY",
  source: "CLO",
  source_version: "2026-06-19",
  number_of_experiments: 0,
  object_breadth: 9,
  specificity: 0.0,
  example_dataset_id: null,
  corroborated: true,
};

describe("the harvest emits one fact several times", () => {
  it("folds the copies that differ only on category case and grounding", () => {
    const merged = mergeRelations([APP_PS1_GROUNDED, APP_PS1_BARE]);
    expect(merged).toHaveLength(1);
    expect(merged[0].copies).toBe(2);
  });

  it("takes the MAX support, never the sum", () => {
    // 🛑 The variants list different example datasets and we cannot see
    // whether their supporting sets overlap. Adding them invents
    // evidence; the max understates, which is the safe direction for a
    // number a curator might act on.
    const merged = mergeRelations([APP_PS1_GROUNDED, APP_PS1_BARE]);
    expect(merged[0].number_of_experiments).toBe(10);
    expect(merged[0].number_of_experiments).not.toBe(11);
  });

  it("keeps the grounded object, so the row stays navigable", () => {
    // The support-10 copy is the one with no objectUri; taking its
    // support must not cost the other copy's URI.
    const merged = mergeRelations([APP_PS1_BARE, APP_PS1_GROUNDED]);
    expect(merged[0].object_uri).toBe("http://gemma.msl.ubc.ca/ont/TGEMO_00174");
    expect(merged[0].number_of_experiments).toBe(10);
  });

  it("never merges across bases", () => {
    // 🛑 Two bases naming the same pair are two claims. MONDO's
    // molecular diagnosis and a curator's clinical syndrome are both
    // correct and neither subsumes the other.
    const sameFactAsserted: RelationRow = {
      ...APP_PS1_GROUNDED,
      basis: "ONTOLOGY",
      number_of_experiments: 0,
    };
    expect(mergeRelations([APP_PS1_GROUNDED, sameFactAsserted])).toHaveLength(2);
  });
});

describe("strongest first, and support is not the ladder", () => {
  it("puts an asserted row above a well-supported curated one", () => {
    // 🛑 The live trap: CLO's rows arrive with support 0 because
    // asserted rows are not counted. Sorting on support alone sinks the
    // strongest basis to the bottom.
    const ranked = rankRelations(mergeRelations([APP_PS1_BARE, CLO_ASSERTED]));
    expect(ranked.map((r) => r.basis)).toEqual(["CURATED", "ONTOLOGY"]);
    // …CURATED outranks ONTOLOGY, so that IS basis order, not support
    // order — the check that matters is that a 0-support CURATED row
    // still beats nothing and that support only breaks ties within a
    // basis.
    const ranked2 = rankRelations(
      mergeRelations([
        { ...APP_PS1_GROUNDED, number_of_experiments: 1, object: "low", object_uri: null },
        { ...APP_PS1_BARE, number_of_experiments: 10, object: "high" },
      ]),
    );
    expect(ranked2.map((r) => r.object)).toEqual(["high", "low"]);
  });

  it("sorts at all, because the endpoint does not", () => {
    // Measured on gemma2: ?subject=<Alzheimer> serves its support-10
    // row TENTH, behind five support-1 rows.
    const served = mergeRelations([
      { ...APP_PS1_GROUNDED, object: "3xTg-AD", object_uri: null, number_of_experiments: 2 },
      { ...APP_PS1_GROUNDED, object: "5xFAD", object_uri: null, number_of_experiments: 7 },
      { ...APP_PS1_GROUNDED, object: "APP NL-F", object_uri: null, number_of_experiments: 1 },
      { ...APP_PS1_GROUNDED, object: "APP/PS1", object_uri: null, number_of_experiments: 10 },
    ]);
    expect(rankRelations(served)[0].object).toBe("APP/PS1");
  });
});

describe("an object that identifies nothing is not a topic", () => {
  it("drops a dose-shaped object and keeps a model", () => {
    const dose: RelationRow = {
      ...APP_PS1_GROUNDED,
      object: "24 h",
      object_breadth: 448,
    };
    const kept = withinBreadth(
      mergeRelations([dose, APP_PS1_GROUNDED]),
      DEFAULT_MAX_OBJECT_BREADTH,
    );
    expect(kept.map((r) => r.object)).toEqual(["APP/PS1"]);
  });

  it("treats breadth 0 as unknown and keeps the row", () => {
    // 🛑 Impossible by construction — every row's object is in the
    // table — so 0 means the lookup missed. Reading it as maximally
    // specific is how a case-collation bug kept exactly the dirtiest
    // values.
    const unknown: RelationRow = { ...APP_PS1_GROUNDED, object_breadth: 0 };
    expect(withinBreadth(mergeRelations([unknown]), 5)).toHaveLength(1);
  });

  it("keeps a row whose breadth the wire omitted", () => {
    const older: RelationRow = { ...APP_PS1_GROUNDED, object_breadth: null };
    expect(withinBreadth(mergeRelations([older]), 5)).toHaveLength(1);
  });
});
