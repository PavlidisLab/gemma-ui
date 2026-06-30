import { describe, expect, it } from "vitest";
import { computeFvDiff } from "./fvDiff";
import type { GridFv } from "./FactorComparisonGrid";
import type { Factor } from "@/features/experiment/types";

/**
 * Contract tests for ``computeFvDiff`` — per-statement, per-slot diff.
 *
 * The function returns ``{leftKeys, rightKeys}``: sets of chip keys
 * (format ``s{i}:{subject|predicate|object}``) on each side that
 * differ from their counterpart. Both sets will be empty when null is
 * passed on either side (nothing to diff against).
 *
 * Key design rules locked by these tests:
 *   - Subjects pair by canonical URI first, label fallback.
 *   - Within a paired statement, each slot is independently compared
 *     via ``sameTerm``: same URI → no diff key; same label → no diff key.
 *   - Positional fallback when no subject URI / label matches.
 *   - Unmatched statements on one side get ALL three slot keys added.
 */

type Statement = {
  subject?: { label?: string; uri?: string | null } | null;
  predicate?: { label?: string; uri?: string | null } | null;
  object?: { label?: string; uri?: string | null } | null;
};

function mkFv(statements: Statement[]): GridFv {
  return {
    free_text_label: "",
    biomaterial_short_names: [],
    is_baseline: false,
    statements,
  } as unknown as Factor["factor_values"][number];
}

describe("computeFvDiff — per-statement S-P-O slot diffing", () => {
  it("both sides null → empty key sets", () => {
    const { leftKeys, rightKeys } = computeFvDiff(null, null);
    expect(leftKeys.size).toBe(0);
    expect(rightKeys.size).toBe(0);
  });

  it("left null → empty key sets (caller renders right without rings)", () => {
    const right = mkFv([
      { subject: { label: "mouse" }, predicate: { label: "is" }, object: { label: "alive" } },
    ]);
    const { leftKeys, rightKeys } = computeFvDiff(null, right);
    expect(leftKeys.size).toBe(0);
    expect(rightKeys.size).toBe(0);
  });

  it("right null → empty key sets (caller renders left without rings)", () => {
    const left = mkFv([
      { subject: { label: "mouse" }, predicate: { label: "is" }, object: { label: "alive" } },
    ]);
    const { leftKeys, rightKeys } = computeFvDiff(left, null);
    expect(leftKeys.size).toBe(0);
    expect(rightKeys.size).toBe(0);
  });

  it("empty statement lists on both sides → empty key sets", () => {
    const { leftKeys, rightKeys } = computeFvDiff(mkFv([]), mkFv([]));
    expect(leftKeys.size).toBe(0);
    expect(rightKeys.size).toBe(0);
  });

  it("empty statement list on left → right keys added for each statement slot", () => {
    const right = mkFv([
      { subject: { label: "drug" }, predicate: { label: "has-dose" }, object: { label: "10 µM" } },
    ]);
    const { leftKeys, rightKeys } = computeFvDiff(mkFv([]), right);
    expect(leftKeys.size).toBe(0);
    // right side has one statement, all 3 slots flagged
    expect(rightKeys.has("s0:subject")).toBe(true);
    expect(rightKeys.has("s0:predicate")).toBe(true);
    expect(rightKeys.has("s0:object")).toBe(true);
  });

  it("empty statement list on right → left keys added for each statement slot", () => {
    const left = mkFv([
      { subject: { label: "drug" }, predicate: { label: "has-dose" }, object: { label: "10 µM" } },
    ]);
    const { leftKeys, rightKeys } = computeFvDiff(left, mkFv([]));
    expect(rightKeys.size).toBe(0);
    expect(leftKeys.has("s0:subject")).toBe(true);
    expect(leftKeys.has("s0:predicate")).toBe(true);
    expect(leftKeys.has("s0:object")).toBe(true);
  });

  it("matching subject URIs → no diff keys on subject slot", () => {
    const uri = "http://purl.obolibrary.org/obo/CHEBI_00001";
    const left = mkFv([{
      subject: { label: "caffeine", uri },
      predicate: { label: "has-role", uri: "http://purl.obolibrary.org/obo/RO_0000087" },
      object: { label: "stimulant", uri: "http://purl.obolibrary.org/obo/CHEBI_35337" },
    }]);
    const right = mkFv([{
      subject: { label: "caffeine", uri },
      predicate: { label: "has-role", uri: "http://purl.obolibrary.org/obo/RO_0000087" },
      object: { label: "stimulant", uri: "http://purl.obolibrary.org/obo/CHEBI_35337" },
    }]);
    const { leftKeys, rightKeys } = computeFvDiff(left, right);
    expect(leftKeys.has("s0:subject")).toBe(false);
    expect(rightKeys.has("s0:subject")).toBe(false);
    // Also no predicate or object diff when all match.
    expect(leftKeys.size).toBe(0);
    expect(rightKeys.size).toBe(0);
  });

  it("differing subject labels with no URIs → diff key on subject slot", () => {
    const left = mkFv([{
      subject: { label: "mouse", uri: null },
      predicate: { label: "strain", uri: null },
      object: { label: "C57BL/6", uri: null },
    }]);
    const right = mkFv([{
      subject: { label: "rat", uri: null },
      predicate: { label: "strain", uri: null },
      object: { label: "Sprague-Dawley", uri: null },
    }]);
    // No subject key match → positional fallback; all differing slots flagged.
    const { leftKeys, rightKeys } = computeFvDiff(left, right);
    expect(leftKeys.has("s0:subject")).toBe(true);
    expect(rightKeys.has("s0:subject")).toBe(true);
  });

  it("matching head subject, differing predicate → diff key on predicate only", () => {
    const subjectUri = "http://purl.obolibrary.org/obo/NCIT_C14250"; // "mouse"
    const objectUri = "http://purl.obolibrary.org/obo/CLO_0000001";
    const left = mkFv([{
      subject: { label: "mouse", uri: subjectUri },
      predicate: { label: "has-sex", uri: "http://purl.obolibrary.org/obo/RO_0000087" },
      object: { label: "male", uri: objectUri },
    }]);
    const right = mkFv([{
      subject: { label: "mouse", uri: subjectUri },
      predicate: { label: "has-strain", uri: "http://purl.obolibrary.org/obo/RO_0000088" },
      object: { label: "male", uri: objectUri },
    }]);
    const { leftKeys, rightKeys } = computeFvDiff(left, right);
    // Subject URIs match → no subject diff keys.
    expect(leftKeys.has("s0:subject")).toBe(false);
    expect(rightKeys.has("s0:subject")).toBe(false);
    // Predicate URIs differ → diff keys on predicate.
    expect(leftKeys.has("s0:predicate")).toBe(true);
    expect(rightKeys.has("s0:predicate")).toBe(true);
    // Object URIs match → no object diff keys.
    expect(leftKeys.has("s0:object")).toBe(false);
    expect(rightKeys.has("s0:object")).toBe(false);
  });

  it("positional fallback when statements lack subject ids — pairs by index", () => {
    // Three statements on each side; no subject URI, no matching label.
    // Positional: left[0] pairs with right[0], left[1]↔right[1], etc.
    const left = mkFv([
      { subject: { label: "alpha" }, object: { label: "X" } },
      { subject: { label: "beta" },  object: { label: "Y" } },
      { subject: { label: "gamma" }, object: { label: "Z" } },
    ]);
    const right = mkFv([
      { subject: { label: "alpha" }, object: { label: "X" } },
      { subject: { label: "beta" },  object: { label: "DIFFERENT" } },
      { subject: { label: "gamma" }, object: { label: "Z" } },
    ]);
    const { leftKeys, rightKeys } = computeFvDiff(left, right);
    // Only s1:object should differ.
    expect(leftKeys.has("s1:object")).toBe(true);
    expect(rightKeys.has("s1:object")).toBe(true);
    // s0 and s2 should NOT have diff keys.
    expect(leftKeys.has("s0:object")).toBe(false);
    expect(leftKeys.has("s2:object")).toBe(false);
  });

  it("URI canonicalisation: full IRI and bare CURIE for the same term do not produce a diff", () => {
    // The same ontology term represented as a full IRI on the left
    // and as a bare CURIE on the right should NOT produce diff keys
    // (this was the TGEMO:00001 regression Paul caught 2026-06-15).
    const left = mkFv([{
      subject: { label: "Homozygous negative", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00001" },
      predicate: { label: "genotype", uri: null },
      object: { label: "wt", uri: null },
    }]);
    const right = mkFv([{
      subject: { label: "Homozygous negative", uri: "TGEMO:00001" },
      predicate: { label: "genotype", uri: null },
      object: { label: "wt", uri: null },
    }]);
    const { leftKeys, rightKeys } = computeFvDiff(left, right);
    // Canonicalised CURIE should match — no subject diff key.
    expect(leftKeys.has("s0:subject")).toBe(false);
    expect(rightKeys.has("s0:subject")).toBe(false);
  });

  it("subject-key match pairs correctly when left and right have differently ordered statements", () => {
    // Left: [beta-statement, alpha-statement]
    // Right: [alpha-statement, beta-statement]
    // Subject-key matching should pair alpha↔alpha and beta↔beta.
    const alphaUri = "http://purl.obolibrary.org/obo/CHEBI_00042";
    const betaUri  = "http://purl.obolibrary.org/obo/CHEBI_00043";
    const left = mkFv([
      { subject: { label: "beta",  uri: betaUri  }, object: { label: "dose-1" } },
      { subject: { label: "alpha", uri: alphaUri }, object: { label: "dose-2" } },
    ]);
    const right = mkFv([
      { subject: { label: "alpha", uri: alphaUri }, object: { label: "dose-2" } },
      { subject: { label: "beta",  uri: betaUri  }, object: { label: "dose-1" } },
    ]);
    // If reordering is handled correctly, all slots should match — no diff keys.
    const { leftKeys, rightKeys } = computeFvDiff(left, right);
    expect(leftKeys.size).toBe(0);
    expect(rightKeys.size).toBe(0);
  });
});
