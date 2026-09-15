/**
 * The Overview's annotation chips: quantities out, one chip per subject
 * on a factor value, identical chips once.
 *
 * The GSE244113 rows are verbatim from gemma2's
 * `/datasets/GSE244113/annotations` and `/design`, 2026-09-15.
 */
import { describe, expect, it } from "vitest";
import { normalizeDatasetAnnotation } from "@/api/endpoints";
import {
  factorValueIdByStatementId,
  isQuantityPair,
  overviewAnnotations,
} from "./overviewAnnotations";
import type { DatasetAnnotation, ExperimentalDesign } from "./types";

const TREATMENT = "http://www.ebi.ac.uk/efo/EFO_0000727";
const DOSE = "http://gemma.msl.ubc.ca/ont/TGEMO_00166";
const DURATION = "http://gemma.msl.ubc.ca/ont/TGEMO_00167";

const GZMB_SOURCE = normalizeDatasetAnnotation({
  id: 56988464,
  objectClass: "FactorValue",
  category: "treatment",
  categoryUri: TREATMENT,
  value: "protein",
  valueUri: "http://purl.obolibrary.org/obo/CHEBI_36080",
  predicate: "derives from",
  predicateUri: "http://purl.obolibrary.org/obo/RO_0001000",
  object: "Gzmb [mouse] granzyme B",
  objectUri: "http://purl.org/commons/record/ncbi_gene/14939",
});
const GZMB_DOSE = normalizeDatasetAnnotation({
  id: 56988465,
  objectClass: "FactorValue",
  category: "treatment",
  categoryUri: TREATMENT,
  value: "protein",
  valueUri: "http://purl.obolibrary.org/obo/CHEBI_36080",
  predicate: "delivered at dose",
  predicateUri: DOSE,
  object: "500 ng/mL",
  secondPredicate: "delivered for duration",
  secondPredicateUri: DURATION,
  secondObject: "20 h",
});
const AMNIOTIC = normalizeDatasetAnnotation({
  id: 55326811,
  objectClass: "FactorValue",
  category: "treatment",
  categoryUri: TREATMENT,
  value: "amniotic fluid",
  valueUri: "http://purl.obolibrary.org/obo/UBERON_0000173",
  predicate: "delivered at dose",
  predicateUri: DOSE,
  object: "50 uL",
  secondPredicate: "delivered for duration",
  secondPredicateUri: DURATION,
  secondObject: "20 h",
});

const DESIGN = {
  experimentalFactors: [
    {
      values: [
        { id: 368965, statements: [{ id: 56988464 }, { id: 56988465 }, { id: 56988465 }] },
        { id: 368970, statements: [{ id: 55326811 }, { id: 55326811 }] },
      ],
    },
  ],
  bioMaterialAssignments: [],
} as unknown as ExperimentalDesign;

const pairs = (a: DatasetAnnotation) => a.statements.map((s) => `${s.predicate} ${s.object}`);

describe("overviewAnnotations", () => {
  it("GSE244113: one protein chip, its source kept, dose and duration dropped", () => {
    const out = overviewAnnotations(
      [GZMB_SOURCE, GZMB_DOSE, AMNIOTIC],
      factorValueIdByStatementId(DESIGN),
    );
    expect(out.map((a) => a.termName)).toEqual(["protein", "amniotic fluid"]);
    expect(pairs(out[0])).toEqual(["derives from Gzmb [mouse] granzyme B"]);
    expect(pairs(out[1])).toEqual([]);
  });

  it("joins nothing when the design isn't there, only drops quantities", () => {
    const out = overviewAnnotations([GZMB_SOURCE, GZMB_DOSE, AMNIOTIC], new Map());
    expect(out.map((a) => a.termName)).toEqual(["protein", "protein", "amniotic fluid"]);
  });

  it("joins two non-quantity statements on one value into one chip", () => {
    const row = (id: number, predicate: string, object: string): DatasetAnnotation => ({
      id,
      objectClass: "FactorValue",
      className: "genotype",
      classUri: null,
      termName: "Dmd",
      termUri: "g",
      statements: [{ predicate, predicateUri: null, object, objectUri: null }],
    });
    const out = overviewAnnotations(
      [row(1, "has genotype", "mdx"), row(2, "has role", "control")],
      new Map([[1, 9], [2, 9]]),
    );
    expect(out).toHaveLength(1);
    expect(pairs(out[0])).toEqual(["has genotype mdx", "has role control"]);
  });

  it("keeps the same subject on two values apart when what remains differs", () => {
    // Dataset 27773's two Tardbp treatments.
    const row = (id: number, object: string): DatasetAnnotation => ({
      id,
      objectClass: "FactorValue",
      className: "treatment",
      classUri: TREATMENT,
      termName: "Tardbp",
      termUri: "t",
      statements: [{ predicate: "has modifier", predicateUri: null, object, objectUri: null }],
    });
    const out = overviewAnnotations(
      [row(1, "peptide 15"), row(2, "peptides 10 and 12")],
      new Map([[1, 10], [2, 20]]),
    );
    expect(out).toHaveLength(2);
  });

  it("shows one chip for one subject at two doses on two values", () => {
    const row = (id: number, dose: string): DatasetAnnotation => ({
      id,
      objectClass: "FactorValue",
      className: "treatment",
      classUri: TREATMENT,
      termName: "doxorubicin",
      termUri: "d",
      statements: [{ predicate: "delivered at dose", predicateUri: DOSE, object: dose, objectUri: null }],
    });
    const out = overviewAnnotations(
      [row(1, "1 uM"), row(2, "5 uM")],
      new Map([[1, 10], [2, 20]]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].statements).toEqual([]);
  });
});

describe("isQuantityPair", () => {
  const p = (predicate: string | null, predicateUri: string | null) => ({
    predicate,
    predicateUri,
    object: "x",
    objectUri: null,
  });

  it("matches dose, duration and sampled after by URI, in either TGEMO namespace", () => {
    expect(isQuantityPair(p(null, DOSE))).toBe(true);
    expect(isQuantityPair(p(null, DURATION))).toBe(true);
    expect(isQuantityPair(p(null, "http://gemma.msl.ubc.ca/ont/TGEMO_00202"))).toBe(true);
    expect(isQuantityPair(p(null, "http://purl.obolibrary.org/obo/TGEMO_00166"))).toBe(true);
  });

  it("falls back to the label only when there is no URI", () => {
    expect(isQuantityPair(p("delivered at dose", null))).toBe(true);
    expect(isQuantityPair(p("delivered at dose", "http://purl.obolibrary.org/obo/RO_0001000"))).toBe(false);
  });

  it("leaves other predicates alone", () => {
    expect(isQuantityPair(p("derives from", "http://purl.obolibrary.org/obo/RO_0001000"))).toBe(false);
    expect(isQuantityPair(p(null, "http://gemma.msl.ubc.ca/ont/TGEMO_00168"))).toBe(false);
  });
});
