/**
 * foldTagStatements — the TagBar's shared-subject fold.
 *
 * A tag can carry several statements. When consecutive ones share a
 * subject, the chip prints that subject once instead of repeating it
 * on every row (the shape a mixed mouse strain produces:
 * `mixed C57BL/6J x C3H/HeJ derives from C57BL/6J` and
 * `… derives from C3H/HeJ`).
 *
 * What the fold must NOT do is invent structure: it groups only
 * CONSECUTIVE rows, matches a URI against a URI, and leaves the
 * single-statement case — far and away the common one — exactly as it
 * rendered before.
 */
import { describe, expect, it } from "vitest";
import { foldTagStatements } from "./TagBar";
import type { Statement } from "@/features/experiment/types";

const term = (label: string, uri?: string) => ({ label, uri: uri ?? null });

const stmt = (
  subject: string,
  predicate: string | null,
  object: string | null,
  opts: { subjectUri?: string; objectUri?: string; gemmaId?: number } = {},
): Statement =>
  ({
    gemma_id: opts.gemmaId ?? null,
    subject: term(subject, opts.subjectUri),
    predicate: predicate ? term(predicate) : null,
    object: object ? term(object, opts.objectUri) : null,
  }) as unknown as Statement;

describe("foldTagStatements — the reported case", () => {
  it("folds one subject and one repeated predicate over two objects", () => {
    const folds = foldTagStatements([
      stmt("mixed C57BL/6J x C3H/HeJ", "derives from", "C57BL/6J"),
      stmt("mixed C57BL/6J x C3H/HeJ", "derives from", "C3H/HeJ"),
    ]);
    expect(folds).toHaveLength(1);
    expect(folds[0].subject?.label).toBe("mixed C57BL/6J x C3H/HeJ");
    expect(folds[0].count).toBe(2);
    expect(folds[0].runs).toHaveLength(1);
    expect(folds[0].runs[0].predicate?.label).toBe("derives from");
    expect(folds[0].runs[0].objects.map((o) => o.label)).toEqual([
      "C57BL/6J",
      "C3H/HeJ",
    ]);
  });
});

describe("foldTagStatements — leaves the common case alone", () => {
  it("a single statement stays a single fold of count 1", () => {
    const folds = foldTagStatements([stmt("Abca4", "has genotype", "null")]);
    expect(folds).toHaveLength(1);
    expect(folds[0].count).toBe(1);
    expect(folds[0].runs).toHaveLength(1);
    expect(folds[0].runs[0].objects).toHaveLength(1);
  });

  it("an empty list folds to nothing", () => {
    expect(foldTagStatements([])).toEqual([]);
  });

  it("different subjects do not fold together", () => {
    const folds = foldTagStatements([
      stmt("Abca4", "has genotype", "null"),
      stmt("Rho", "has genotype", "null"),
    ]);
    expect(folds).toHaveLength(2);
    expect(folds.map((f) => f.count)).toEqual([1, 1]);
  });
});

describe("foldTagStatements — never invents structure", () => {
  it("keeps distinct predicates as separate runs under one subject", () => {
    const folds = foldTagStatements([
      stmt("HeLa", "derives from", "cervix"),
      stmt("HeLa", "has disease", "adenocarcinoma"),
    ]);
    expect(folds).toHaveLength(1);
    expect(folds[0].runs.map((r) => r.predicate?.label)).toEqual([
      "derives from",
      "has disease",
    ]);
    expect(folds[0].runs.every((r) => r.objects.length === 1)).toBe(true);
  });

  it("only folds CONSECUTIVE rows — order is data, not a set", () => {
    const folds = foldTagStatements([
      stmt("A", "p", "x"),
      stmt("B", "p", "y"),
      stmt("A", "p", "z"),
    ]);
    expect(folds.map((f) => f.subject?.label)).toEqual(["A", "B", "A"]);
    expect(folds.map((f) => f.count)).toEqual([1, 1, 1]);
  });

  it("same label under different URIs is NOT the same subject", () => {
    const folds = foldTagStatements([
      stmt("C57BL/6J", "p", "x", { subjectUri: "http://purl.obolibrary.org/obo/NCBITaxon_10090" }),
      stmt("C57BL/6J", "p", "y", { subjectUri: "http://purl.obolibrary.org/obo/OTHER_1" }),
    ]);
    expect(folds).toHaveLength(2);
  });

  it("a grounded subject does not absorb a bare-label one of the same spelling", () => {
    const folds = foldTagStatements([
      stmt("C57BL/6J", "p", "x", { subjectUri: "http://example.org/T1" }),
      stmt("C57BL/6J", "p", "y"),
    ]);
    expect(folds).toHaveLength(2);
  });

  it("two bare-label subjects spelled alike DO fold, case-insensitively", () => {
    const folds = foldTagStatements([
      stmt("mixed strain", "derives from", "x"),
      stmt("Mixed Strain", "derives from", "y"),
    ]);
    expect(folds).toHaveLength(1);
    expect(folds[0].runs[0].objects).toHaveLength(2);
  });

  it("a statement with no object contributes no phantom object", () => {
    const folds = foldTagStatements([
      stmt("subject only", null, null),
      stmt("subject only", "derives from", "x"),
    ]);
    expect(folds).toHaveLength(1);
    expect(folds[0].count).toBe(2);
    expect(folds[0].runs[0].objects).toEqual([]);
    expect(folds[0].runs[1].objects.map((o) => o.label)).toEqual(["x"]);
  });
});
