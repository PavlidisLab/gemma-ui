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
  impliesFrom,
  isDiseaseTerm,
  mergeRelations,
  topicRelations,
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
  topicality: "TERM_LEVEL",
  inference_direction: "SUBJECT_IMPLIES_OBJECT",
  implied_subject: "Alzheimer disease",
  implied_predicate: "has_genotype",
  implied_object: "APP/PS1",
  implied_object_uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00174",
};

const APP_PS1_BARE: RelationRow = {
  ...APP_PS1_GROUNDED,
  subject_category: "Disease model",
  object_uri: null,
  implied_object_uri: null,
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

describe("an asserted row is not a weak one", () => {
  it("carries support 0 because asserted rows are not counted", () => {
    // 🛑 `numberOfExperiments: 0` on an ONTOLOGY row means "not
    // counted", never "no evidence" — the server ranks basis above
    // support for exactly this reason, and any client that re-sorted on
    // support would sink CLO's own restrictions to the bottom.
    expect(CLO_ASSERTED.number_of_experiments).toBe(0);
    expect(CLO_ASSERTED.basis).toBe("ONTOLOGY");
    expect(CLO_ASSERTED.source).toBe("CLO");
  });
});

describe("the copies the wire still emits", () => {
  // Label-spelling fragmentation (`Disease model` / `disease model`,
  // which split one relation's support into 10, 3 and 1) is FIXED
  // server-side as of 2026-08-18. What remains, deliberately, is the
  // same value grounded and ungrounded: merging those asserts that a
  // bare `APP/PS1` denotes `TGEMO_00174 APP/PS1`, and that call has not
  // been made. We fold only when one side carries no URI at all — the
  // same row wearing less identity, never two URIs.
  it("takes the MAX support, never the sum", () => {
    // 🛑 The variants name different example datasets and we cannot see
    // whether their supporting sets overlap. Adding invents evidence;
    // the max understates, which is the safe direction for a number a
    // curator might act on.
    const merged = mergeRelations([APP_PS1_GROUNDED, APP_PS1_BARE]);
    expect(merged).toHaveLength(1);
    expect(merged[0].number_of_experiments).toBe(10);
    expect(merged[0].number_of_experiments).not.toBe(11);
  });

  it("keeps the grounded object, so the row stays navigable", () => {
    // The support-10 copy is the one with no URI; taking its support
    // must not cost the other copy's link.
    const merged = mergeRelations([APP_PS1_BARE, APP_PS1_GROUNDED]);
    expect(merged[0].implied_object_uri).toBe(
      "http://gemma.msl.ubc.ca/ont/TGEMO_00174",
    );
    expect(merged[0].number_of_experiments).toBe(10);
  });

  it("never merges across bases", () => {
    // 🛑 Two bases naming one pair are two claims. An ontology's
    // molecular diagnosis and a curator's clinical syndrome are both
    // correct and neither subsumes the other.
    const sameClaimAsserted: RelationRow = {
      ...APP_PS1_GROUNDED,
      basis: "ONTOLOGY",
      number_of_experiments: 0,
    };
    expect(mergeRelations([APP_PS1_GROUNDED, sameClaimAsserted])).toHaveLength(2);
  });
});

describe("the licensed direction, which is the server's to state", () => {
  // Captured from `/implies` on build `5fa21d7a8f`. The stored relation
  // is `Alzheimer disease --has_genotype--> APP/PS1`; the DERIVED claim
  // runs the other way, because not every Alzheimer model is APP/PS1.
  const APP_PS1 = "http://gemma.msl.ubc.ca/ont/TGEMO_00174";
  const ALZ = "http://purl.obolibrary.org/obo/MONDO_0004975";
  const modelOf: RelationRow = {
    subject: "Alzheimer disease",
    subject_uri: ALZ,
    subject_category: "Disease model",
    predicate: "has_genotype",
    predicate_uri: "http://purl.obolibrary.org/obo/GENO_0000222",
    object: "APP/PS1",
    object_uri: APP_PS1,
    basis: "CURATED",
    number_of_experiments: 10,
    topicality: "TERM_LEVEL",
    inference_direction: "OBJECT_IMPLIES_SUBJECT",
    implied_subject: "APP/PS1",
    implied_subject_uri: APP_PS1,
    implied_predicate: "is model of",
    implied_predicate_uri: "http://purl.obolibrary.org/obo/RO_0003301",
    implied_object: "Alzheimer disease",
    implied_object_uri: ALZ,
  };

  it("shows the claim on the term that makes it", () => {
    expect(impliesFrom(modelOf, APP_PS1)).toBe(true);
    expect(topicRelations([modelOf], APP_PS1)).toHaveLength(1);
  });

  it("does not show it on the term it is made about", () => {
    // 🛑 The inverse is not licensed and the server says so. Rendering
    // it would put "Alzheimer disease is modelled by APP/PS1" on the
    // disease card — one of seventeen, and a claim nobody made.
    expect(impliesFrom(modelOf, ALZ)).toBe(false);
  });

  it("follows nothing when the predicate is unclassified", () => {
    // `RO_0001000 derives from` covers `amplified total RNA → total
    // RNA` and `cell line → donor`; one URI cannot carry two
    // directions, so it licenses neither.
    const unclassified: RelationRow = {
      ...modelOf,
      inference_direction: "NEITHER",
      implied_subject: null,
      implied_predicate: null,
      implied_object: null,
    };
    expect(impliesFrom(unclassified, APP_PS1)).toBe(false);
    expect(impliesFrom(unclassified, ALZ)).toBe(false);
  });

  it("reads the licensed END, not the implied URI", () => {
    // 🛑 `impliedSubjectUri` is null wherever the annotation was never
    // grounded — `APP/PS1` exists both as TGEMO_00174 and bare. Keying
    // on it drops the ungrounded half of our own evidence.
    const ungrounded: RelationRow = { ...modelOf, implied_subject_uri: null };
    expect(impliesFrom(ungrounded, APP_PS1)).toBe(true);
  });
});

describe("a disease card stays silent", () => {
  const BREAST = "http://purl.obolibrary.org/obo/MONDO_0007254";
  const GENE = "http://purl.org/commons/record/ncbi_gene/672";

  /** Live on the `breast cancer` card: the disease as subject of its own
   *  curation artefacts. */
  const asSubject: RelationRow = {
    subject: "breast cancer",
    subject_uri: BREAST,
    subject_category: "disease",
    predicate: "derived from cell line",
    predicate_uri: "http://purl.obolibrary.org/obo/CLO_0037210",
    object: "E0771-BrM",
    basis: "CURATED",
    topicality: "TERM_LEVEL",
    inference_direction: "SUBJECT_IMPLIES_OBJECT",
    implied_subject: "breast cancer",
    implied_predicate: "derived from cell line",
    implied_object: "E0771-BrM",
  };

  /** …and the row that IS knowledge, on the gene's card. */
  const onTheGene: RelationRow = {
    subject: "BRCA1 [human] breast cancer 1, early onset",
    subject_uri: GENE,
    subject_category: "genotype",
    predicate: "has disease",
    predicate_uri: "http://purl.obolibrary.org/obo/RO_0016002",
    object: "breast cancer",
    object_uri: BREAST,
    basis: "CURATED",
    number_of_experiments: 1,
    // 🛑 breadth 31, which the old client-side cap of 25 deleted — the
    // one row the BRCA1 card exists for.
    object_breadth: 31,
    topicality: "TERM_LEVEL",
    inference_direction: "SUBJECT_IMPLIES_OBJECT",
    implied_subject: "BRCA1 [human] breast cancer 1, early onset",
    implied_predicate: "has disease",
    implied_object: "breast cancer",
    implied_object_uri: BREAST,
  };

  it("recognises the disease from the rows, not from its URI", () => {
    expect(isDiseaseTerm([asSubject], BREAST)).toBe(true);
    expect(isDiseaseTerm([onTheGene], BREAST)).toBe(true);
    expect(isDiseaseTerm([onTheGene], GENE)).toBe(false);
  });

  it("renders nothing on it, even for licensed rows", () => {
    expect(topicRelations([asSubject, onTheGene], BREAST)).toHaveLength(0);
  });

  it("keeps the same relation on the gene's card", () => {
    const kept = topicRelations([asSubject, onTheGene], GENE);
    expect(kept).toHaveLength(1);
    expect(kept[0].implied_object).toBe("breast cancer");
  });

  it("does not cap a wide object off the card", () => {
    // The cap belongs to the suppression gate, not here.
    expect(topicRelations([onTheGene], GENE)[0].object_breadth).toBe(31);
  });
});

describe("one claim, however many stored relations derive it", () => {
  const GENE = "http://purl.org/commons/record/ncbi_gene/672";
  const BREAST = "http://purl.obolibrary.org/obo/MONDO_0007254";
  // 🛑 Live on the BRCA1 card: two rows, two DIFFERENT `tripleKey`s
  // (`BRCA1 has disease breast cancer` and `breast cancer has_genotype
  // BRCA1`), one identical implied claim. Grouping on `tripleKey` shows
  // the same sentence twice.
  const a: RelationRow = {
    subject: "BRCA1 [human]",
    subject_uri: GENE,
    predicate: "has disease",
    object: "breast cancer",
    object_uri: BREAST,
    basis: "CURATED",
    number_of_experiments: 1,
    triple_key: `${GENE} RO_0016002 ${BREAST}`,
    implied_subject: "BRCA1 [human]",
    implied_predicate: "has disease",
    implied_object: "breast cancer",
    implied_object_uri: BREAST,
    inference_direction: "SUBJECT_IMPLIES_OBJECT",
  };
  const b: RelationRow = {
    ...a,
    subject: "breast cancer",
    predicate: "has_genotype",
    triple_key: `${BREAST} GENO_0000222 ${GENE}`,
    number_of_experiments: 4,
    inference_direction: "OBJECT_IMPLIES_SUBJECT",
  };

  it("folds them into the sentence a reader sees, once", () => {
    const merged = mergeRelations([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0].copies).toBe(2);
    expect(merged[0].number_of_experiments).toBe(4);
  });
});

describe("in a crowded group, a property stays and an instance goes", () => {
  // 🛑 Two cards, one rule. `induced pluripotent stem cell line cell`
  // implied fifteen rows — `derived from cell line → 201B7 · 585A1 ·
  // Detroit 551 cell`, the corpus's iPSC lines. `imatinib` implies ten
  // CHEBI roles. Both are one predicate with a dozen objects; neither is
  // a dozen facts. The separator is the OBJECT's breadth, not the
  // subject's: a member appears nowhere else (breadth 1), a property is
  // borne by many (12, 44, 5326).
  const CLASS = "http://purl.obolibrary.org/obo/CLO_0037307";
  const row = (
    object: string,
    object_breadth: number,
    predicate = "derived from cell line",
  ): RelationRow => ({
    subject: "induced pluripotent stem cell line cell",
    subject_uri: CLASS,
    subject_category: "cell line",
    predicate,
    object,
    object_breadth,
    basis: "CURATED",
    number_of_experiments: 1,
    topicality: "TERM_LEVEL",
    inference_direction: "SUBJECT_IMPLIES_OBJECT",
    implied_subject: "induced pluripotent stem cell line cell",
    implied_predicate: predicate,
    implied_object: object,
  });

  it("drops the members and keeps the shared facts", () => {
    const rows = [
      row("201B7", 1),
      row("585A1", 1),
      row("Detroit 551 cell", 1),
      row("WT33", 1),
      row("fibroblast", 14),
      row("embryonic fibroblast", 12),
    ];
    const kept = topicRelations(rows, CLASS).map((r) => r.implied_object);
    expect(kept).toEqual(["fibroblast", "embryonic fibroblast"]);
  });

  it("keeps the most specific three when everything is shared", () => {
    // `imatinib`: ten roles, all borne by dozens to thousands of other
    // chemicals. Dropping the group would take `tyrosine kinase
    // inhibitor` with it — the one role that identifies the compound.
    const roles = [
      row("antineoplastic agent", 5326, "has role"),
      row("antiviral agent", 636, "has role"),
      row("apoptosis inducer", 411, "has role"),
      row("antitubercular agent", 138, "has role"),
      row("tyrosine kinase inhibitor", 44, "has role"),
    ];
    const kept = topicRelations(roles, CLASS).map((r) => r.implied_object);
    expect(kept).toContain("tyrosine kinase inhibitor");
    expect(kept).toHaveLength(3);
    expect(kept).not.toContain("antineoplastic agent");
  });

  it("leaves a small group alone, breadth or no breadth", () => {
    const rows = [row("astrocyte", 23), row("fibroblast", 1)];
    expect(topicRelations(rows, CLASS)).toHaveLength(2);
  });

  it("keeps a row whose breadth the wire did not report", () => {
    // 🛑 Unknown is not a singleton. `0` is impossible by construction
    // and an absent field is an older backend.
    const rows = [
      row("a", 0),
      row("b", 0),
      row("c", 0),
      row("d", 0),
    ];
    expect(topicRelations(rows, CLASS)).toHaveLength(3);
  });
});

describe("a refutation is not rendered as a claim", () => {
  // MGI reports genotypes that do NOT model a disease. Those arrive as
  // `status: "REFUTED"` carrying the same assertive implied triple as
  // any other row, so a card that renders them as written states MGI's
  // finding backwards — under a header saying these are known facts.
  const GENO = "http://www.informatics.jax.org/allele/MGI:5432",
    GLAUCOMA = "http://purl.obolibrary.org/obo/MONDO_0005041";
  const mgi = (status: string | undefined): RelationRow => ({
    subject: "Pitx2<egl1>",
    subject_uri: GENO,
    subject_category: "genotype",
    predicate: "is model of",
    object: "glaucoma",
    object_uri: GLAUCOMA,
    basis: "EXTERNAL",
    source: "MGI",
    status,
    inference_direction: "SUBJECT_IMPLIES_OBJECT",
    implied_subject: "Pitx2<egl1>",
    implied_predicate: "is model of",
    implied_object: "glaucoma",
  });

  it("drops the refuted row", () => {
    expect(topicRelations([mgi("REFUTED")], GENO)).toEqual([]);
  });

  it("keeps the asserted one", () => {
    expect(topicRelations([mgi("ASSERTED")], GENO)).toHaveLength(1);
  });

  it("treats a missing status as asserted", () => {
    // An older deployment omits the field, and dropping on absence
    // would delete the whole surface rather than one row.
    expect(topicRelations([mgi(undefined)], GENO)).toHaveLength(1);
  });
});

const IMATINIB = "http://purl.obolibrary.org/obo/CHEBI_45783";

describe("the server's order is the order", () => {
  // The client tie-break is gone. Every asserted row carries support 0,
  // so `imatinib`'s ten CHEBI roles arrive tied, and the server now
  // orders a tied run by how specific the object is — measured on build
  // `a18e488faf`, verbatim below. Re-imposing that here would be a
  // second definition of "most specific", running after the merge and
  // therefore able to move rows the server placed deliberately.
  const r = (object: string, object_breadth: number, sup = 0): RelationRow => ({
    subject: "imatinib",
    subject_uri: IMATINIB,
    predicate: "has role",
    object,
    object_breadth,
    basis: "ONTOLOGY",
    source: "CHEBI",
    number_of_experiments: sup,
    inference_direction: "SUBJECT_IMPLIES_OBJECT",
    implied_object: object,
    implied_triple_key: `${IMATINIB} has-role ${object}`,
  });

  // As served, ascending inside the tie.
  const asServed = [
    r("tyrosine kinase inhibitor", 44),
    r("antitubercular agent", 138),
    r("hepatoprotective agent", 139),
    r("antimalarial", 245),
    r("antirheumatic drug", 327),
  ];

  it("keeps what the server sent, in the order it sent it", () => {
    expect(mergeRelations(asServed).map((x) => x.object)).toEqual(
      asServed.map((x) => x.object),
    );
  });

  it("leads with the role that identifies the compound", () => {
    // The card takes the first three of a crowded group; the server
    // having sorted the tie is what makes those three the specific ones.
    expect(
      topicRelations(asServed, IMATINIB).map((x) => x.object),
    ).toEqual([
      "tyrosine kinase inhibitor",
      "antitubercular agent",
      "hepatoprotective agent",
    ]);
  });
});
