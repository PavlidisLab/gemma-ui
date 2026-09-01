/**
 * One line per subject, not per statement.
 *
 * Gemma stores a factor value's statements FLAT — one row per
 * (predicate, object) pair, repeating the category and subject on each
 * — so a value reading
 *
 *     GSK2879552 delivered for duration 2 d and delivered at dose 1 µM
 *
 * arrives as two rows both naming GSK2879552. The dataset page rendered
 * one row per statement and printed the subject chip and its CHEBI
 * CURIE twice, so a value with three pairs read as three treatments.
 *
 * Fixtures are the real shape from ee 34931 / GSE176403, whose FV
 * 258378 is exactly that case.
 */
import { describe, expect, it } from "vitest";
import {
  groupStatementsBySubject,
  statementHasPair,
} from "./statementGroups";
import type { FactorValueStatement } from "./types";

const CHEBI_GSK = "http://purl.obolibrary.org/obo/CHEBI_176334";
const CHEBI_DOXY = "http://purl.obolibrary.org/obo/CHEBI_50845";
const EFO_TREATMENT = "http://www.ebi.ac.uk/efo/EFO_0000727";

/** FV 258378 — one subject, two pairs. */
const TWO_PAIRS: FactorValueStatement[] = [
  {
    id: 1,
    category: "treatment",
    categoryUri: EFO_TREATMENT,
    subject: "GSK2879552",
    subjectUri: CHEBI_GSK,
    predicate: "delivered for duration",
    object: "2 d",
  },
  {
    id: 2,
    category: "treatment",
    categoryUri: EFO_TREATMENT,
    subject: "GSK2879552",
    subjectUri: CHEBI_GSK,
    predicate: "delivered at dose",
    object: "1 µM",
  },
];

describe("groupStatementsBySubject", () => {
  it("collapses two pairs on one subject into a single group", () => {
    const groups = groupStatementsBySubject(TWO_PAIRS);
    expect(groups).toHaveLength(1);
    expect(groups[0].subject).toBe("GSK2879552");
    expect(groups[0].subjectUri).toBe(CHEBI_GSK);
    expect(groups[0].statements.map((s) => s.predicate)).toEqual([
      "delivered for duration",
      "delivered at dose",
    ]);
  });

  it("keeps genuinely different subjects apart", () => {
    // The other real case on that dataset: doxycycline AND GSK2879552
    // on one value. Two drugs, two lines — collapsing these would be
    // worse than repeating a subject.
    const groups = groupStatementsBySubject([
      {
        category: "treatment",
        categoryUri: EFO_TREATMENT,
        subject: "doxycycline",
        subjectUri: CHEBI_DOXY,
        predicate: "delivered for duration",
        object: "3 d",
      },
      ...TWO_PAIRS,
    ]);
    expect(groups.map((g) => g.subject)).toEqual([
      "doxycycline",
      "GSK2879552",
    ]);
    expect(groups[1].statements).toHaveLength(2);
  });

  it("does not merge one subject across two categories", () => {
    // A statement's category may legitimately differ from its factor's,
    // so the same subject under two categories is two claims.
    const groups = groupStatementsBySubject([
      { category: "treatment", subject: "X", predicate: "p", object: "o" },
      { category: "genotype", subject: "X", predicate: "q", object: "r" },
    ]);
    expect(groups).toHaveLength(2);
  });

  it("preserves wire order, of groups and of pairs within them", () => {
    const groups = groupStatementsBySubject([
      { subject: "B", predicate: "p1" },
      { subject: "A", predicate: "p2" },
      { subject: "B", predicate: "p3" },
    ]);
    expect(groups.map((g) => g.subject)).toEqual(["B", "A"]);
    expect(groups[0].statements.map((s) => s.predicate)).toEqual(["p1", "p3"]);
  });

  it("returns nothing for nothing, rather than throwing", () => {
    expect(groupStatementsBySubject(null)).toEqual([]);
    expect(groupStatementsBySubject(undefined)).toEqual([]);
    expect(groupStatementsBySubject([])).toEqual([]);
  });

  it("groups a subject-only statement on its own", () => {
    const groups = groupStatementsBySubject([
      { subject: "cisplatin", subjectUri: "u" },
    ]);
    expect(groups).toHaveLength(1);
    expect(statementHasPair(groups[0].statements[0])).toBe(false);
  });
});

describe("statementHasPair", () => {
  it("is true when either half of the pair is present", () => {
    expect(statementHasPair({ predicate: "p" })).toBe(true);
    expect(statementHasPair({ object: "o" })).toBe(true);
    expect(statementHasPair({ objectUri: "u" })).toBe(true);
  });

  it("is false for a subject named and nothing said about it", () => {
    expect(statementHasPair({ subject: "X", subjectUri: "u" })).toBe(false);
  });
});
