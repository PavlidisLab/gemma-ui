import { describe, expect, it } from "vitest";
import { canonicalPredicateUri, groupStatementsBySubject } from "./StatementEditor";
import { PREDICATES } from "@/generated/predicates";
import type { Statement } from "@/features/experiment/types";

/**
 * Tests for canonicalPredicateUri() — the resolver behind the
 * StatementEditor predicate `<select>` value.
 *
 * The dropdown options carry `predicates.ts`'s canonical URIs. A
 * statement can reach the editor with a legacy obo-purl form of the same
 * TGEMO term (`.../obo/TGEMO_00168`) — from a pre-namespace-migration
 * agent run or an older hand-authored template. The resolver must match
 * these by canonical CURIE so the dropdown selects the right option
 * instead of blanking to the "predicate" placeholder. Regression guard
 * for the exp-91203 blank-predicate bug.
 */

// Pull real fixtures from the source of truth so the test tracks the
// live vocabulary rather than a hand-copied snapshot.
const TGEMO_PRED = PREDICATES.find((p) =>
  (p.uri ?? "").startsWith("http://gemma.msl.ubc.ca/ont/TGEMO_"),
)!;
const NON_TGEMO_PRED = PREDICATES.find((p) =>
  (p.uri ?? "").startsWith("http://purl.obolibrary.org/obo/RO_"),
)!;

describe("canonicalPredicateUri", () => {
  it("returns the canonical URI unchanged for an exact match", () => {
    expect(canonicalPredicateUri(TGEMO_PRED.uri)).toBe(TGEMO_PRED.uri);
    expect(canonicalPredicateUri(NON_TGEMO_PRED.uri)).toBe(NON_TGEMO_PRED.uri);
  });

  it("resolves a legacy obo-purl TGEMO URI to the canonical gemma-ont option", () => {
    // Same term, wrong namespace host — the exact shape that blanked the
    // dropdown before the fix.
    const legacy = TGEMO_PRED.uri!.replace(
      "http://gemma.msl.ubc.ca/ont/TGEMO_",
      "http://purl.obolibrary.org/obo/TGEMO_",
    );
    expect(legacy).not.toBe(TGEMO_PRED.uri); // sanity: the input really differs
    expect(canonicalPredicateUri(legacy)).toBe(TGEMO_PRED.uri);
  });

  it("returns '' for null / undefined / empty (the placeholder value)", () => {
    expect(canonicalPredicateUri(null)).toBe("");
    expect(canonicalPredicateUri(undefined)).toBe("");
    expect(canonicalPredicateUri("")).toBe("");
  });

  it("returns '' for a URI outside the predicate vocabulary", () => {
    expect(
      canonicalPredicateUri("http://purl.obolibrary.org/obo/UBERON_0002107"),
    ).toBe("");
  });
});

describe("groupStatementsBySubject — drops redundant bare statements", () => {
  const term = (label: string, uri: string | null = null) => ({ label, uri });
  const stmt = (partial: Partial<Statement>): Statement => ({
    category: term("treatment", "http://www.ebi.ac.uk/efo/EFO_0000727"),
    subject: term("metformin", "http://purl.obolibrary.org/obo/CHEBI_6801"),
    predicate: null,
    object: null,
    ...partial,
  });

  it("drops a bare subject-only statement when the group has a real one (GSE36409 metformin)", () => {
    // The dangling-editor repro: a complete statement + a spurious
    // subject-only one under the same subject.
    const complete = stmt({
      predicate: term(
        "delivered for duration",
        "http://purl.obolibrary.org/obo/TGEMO_00167",
      ),
      object: term("30 d"),
    });
    const bare = stmt({}); // metformin, null predicate + object
    const groups = groupStatementsBySubject([complete, bare]);
    expect(groups).toHaveLength(1);
    // Only the content-bearing statement survives; index maps to the original.
    expect(groups[0].statements).toHaveLength(1);
    expect(groups[0].statements[0].predicate?.label).toBe(
      "delivered for duration",
    );
    expect(groups[0].indices).toEqual([0]);
  });

  it("keeps one row when a group is entirely bare (add-a-predicate affordance)", () => {
    const groups = groupStatementsBySubject([stmt({})]);
    expect(groups).toHaveLength(1);
    expect(groups[0].statements).toHaveLength(1);
    expect(groups[0].indices).toEqual([0]);
  });

  it("keeps every content-bearing statement and preserves original indices", () => {
    const dose = stmt({
      predicate: term("delivered at dose"),
      object: term("0.1 MOI"),
    });
    const bare = stmt({});
    const duration = stmt({
      predicate: term("delivered for duration"),
      object: term("48 h"),
    });
    const groups = groupStatementsBySubject([dose, bare, duration]);
    expect(groups).toHaveLength(1);
    expect(groups[0].statements.map((s) => s.object?.label)).toEqual([
      "0.1 MOI",
      "48 h",
    ]);
    // bare was index 1 → dropped; surviving indices are the originals.
    expect(groups[0].indices).toEqual([0, 2]);
  });
});
