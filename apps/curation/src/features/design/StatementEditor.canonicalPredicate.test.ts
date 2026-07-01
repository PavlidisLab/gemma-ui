import { describe, expect, it } from "vitest";
import { canonicalPredicateUri } from "./StatementEditor";
import { PREDICATES } from "@/generated/predicates";

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
