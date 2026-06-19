/**
 * Tests for ``findingDisplayedGoldEmpty`` + the ``findingActionLabel``
 * goldEmpty override.
 *
 * Anchored on the GSE110721 (id 14966) ticket-55 bug Paul caught
 * 2026-06-16:
 *
 *   - Audit row carries a ``calibration_match`` finding for
 *     ``cell type: astrocyte`` (the audit was run against live
 *     Gemma, where the tag exists).
 *   - Curator's display baseline is ``polished_gold``, which carries
 *     three tags (developmental stage / organism part / assay) and
 *     does NOT have cell-type.
 *   - Card title rendered as "TAG MATCH" but the body showed
 *     "Current: no entry" — visible contradiction.
 *
 * The fix downgrades the title to "Add tag" when the displayed gold
 * side lacks the value, so title agrees with body. Same logic for
 * factor cards.
 */
import { describe, expect, it } from "vitest";
import type { AuditFinding } from "@/api/auditTypes";
import type { Design } from "@/features/experiment/types";
import {
  findingActionLabel,
  findingDisplayedGoldEmpty,
} from "./findingHelpers";

function makeFinding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return {
    target_kind: "tag",
    target_id: "tag:cell-type/astrocyte",
    severity: "ok",
    issue_code: "calibration_match",
    rationale: "Is `cell type: astrocyte` correctly assigned?",
    rationale_summary: "",
    rationale_bin: "",
    citation: "",
    citation_url: "",
    supporting_evidence: [],
    why: null,
    reviews: [],
    comparison: null,
    ...overrides,
  } as AuditFinding;
}

function makeDraft(tags: Design["tags"] = [], factors: Design["factors"] = []) {
  return {
    tags,
    factors,
    name: "",
    title: "",
    description: "",
    experimentId: 1,
    experimentShortName: "GSE0",
    taxon: null,
    biomaterials: [],
    publications: [],
  } as unknown as Design;
}

describe("findingDisplayedGoldEmpty — tag side", () => {
  it("returns null when no draft is loaded (don't override the title)", () => {
    const f = makeFinding();
    expect(findingDisplayedGoldEmpty(f, null)).toBeNull();
  });

  it("returns false when the draft has a tag matching the target_id slugs", () => {
    const f = makeFinding({ target_id: "tag:cell-type/astrocyte" });
    const draft = makeDraft([
      {
        category: { label: "cell type", uri: null },
        value: { label: "astrocyte", uri: null },
      } as Design["tags"][number],
    ]);
    expect(findingDisplayedGoldEmpty(f, draft)).toBe(false);
  });

  it("returns true when the draft has DIFFERENT tags but not this one", () => {
    const f = makeFinding({ target_id: "tag:cell-type/astrocyte" });
    const draft = makeDraft([
      {
        category: { label: "developmental stage", uri: null },
        value: { label: "juvenile", uri: null },
      } as Design["tags"][number],
      {
        category: { label: "organism part", uri: null },
        value: { label: "Ammon's horn", uri: null },
      } as Design["tags"][number],
    ]);
    expect(findingDisplayedGoldEmpty(f, draft)).toBe(true);
  });

  it("returns true when the draft has NO tags at all", () => {
    const f = makeFinding({ target_id: "tag:cell-type/astrocyte" });
    expect(findingDisplayedGoldEmpty(f, makeDraft())).toBe(true);
  });

  it("returns false on URI match even when label slugs differ (GSE110721 D283 Med cell drift)", () => {
    // Agent's proposer_term has CLO:0002673 with label "D283 Med cell";
    // draft already carries the same URI under a different label
    // ("D283 Med"). Slug equality would fail and the helper would
    // (wrongly) report goldEmpty=true. URI match wins.
    const f = makeFinding({
      target_id: "calibration:match:cell-line/d283-med-cell",
      rationale: "Is `cell line: D283 Med cell` correctly assigned?",
      proposer_term: {
        label: "D283 Med cell",
        uri: "http://purl.obolibrary.org/obo/CLO_0002673",
      } as AuditFinding["proposer_term"],
    });
    const draft = makeDraft([
      {
        category: { label: "cell line", uri: null },
        value: {
          label: "D283 Med",
          uri: "http://purl.obolibrary.org/obo/CLO_0002673",
        },
      } as Design["tags"][number],
    ]);
    expect(findingDisplayedGoldEmpty(f, draft)).toBe(false);
  });

  it("falls back to backticked rationale token when target_id doesn't parse", () => {
    const f = makeFinding({
      target_id: "calibration:match:opaque-key",
      rationale: "Is `cell type: astrocyte` correctly assigned?",
    });
    const draft = makeDraft([
      {
        category: { label: "cell type", uri: null },
        value: { label: "astrocyte", uri: null },
      } as Design["tags"][number],
    ]);
    expect(findingDisplayedGoldEmpty(f, draft)).toBe(false);
  });
});

describe("findingDisplayedGoldEmpty — factor side", () => {
  it("returns true when the draft has no factor of that category", () => {
    const f = makeFinding({
      target_kind: "factor",
      target_id: "factor:treatment",
      issue_code: "calibration_factor_match_exact",
      rationale: "",
    });
    const draft = makeDraft([], [
      { category: { label: "genotype", uri: null }, factor_values: [] } as Design["factors"][number],
    ]);
    expect(findingDisplayedGoldEmpty(f, draft)).toBe(true);
  });

  it("returns false when the draft has a matching factor", () => {
    const f = makeFinding({
      target_kind: "factor",
      target_id: "factor:treatment",
      issue_code: "calibration_factor_match_exact",
      rationale: "",
    });
    const draft = makeDraft([], [
      { category: { label: "treatment", uri: null }, factor_values: [] } as Design["factors"][number],
    ]);
    expect(findingDisplayedGoldEmpty(f, draft)).toBe(false);
  });

  // Calibration findings carry a numeric Gemma factor id in
  // ``target_id`` (``factor:55021``) rather than a category slug. The
  // helper must bridge through ``gold_target_index`` instead of
  // slug-matching — slug("timepoint") never equals "55021", so the
  // bare slug walk silently downgrades the match to "Add factor".
  it("numeric target_id: uses gold_target_index when present", () => {
    const f = makeFinding({
      target_kind: "factor",
      target_id: "factor:55021",
      issue_code: "calibration_factor_match_exact",
      rationale: "",
      gold_target_index: 0,
    } as Partial<AuditFinding>);
    const draft = makeDraft([], [
      { category: { label: "timepoint", uri: null }, factor_values: [] } as Design["factors"][number],
    ]);
    expect(findingDisplayedGoldEmpty(f, draft)).toBe(false);
  });

  it("numeric target_id: returns null when no gold_target_index is set", () => {
    const f = makeFinding({
      target_kind: "factor",
      target_id: "factor:55021",
      issue_code: "calibration_factor_match_exact",
      rationale: "",
    });
    const draft = makeDraft([], [
      { category: { label: "timepoint", uri: null }, factor_values: [] } as Design["factors"][number],
    ]);
    expect(findingDisplayedGoldEmpty(f, draft)).toBeNull();
  });

  it("numeric target_id: returns null when gold_target_index is out of range", () => {
    const f = makeFinding({
      target_kind: "factor",
      target_id: "factor:55021",
      issue_code: "calibration_factor_match_exact",
      rationale: "",
      gold_target_index: 5,
    } as Partial<AuditFinding>);
    const draft = makeDraft([], [
      { category: { label: "timepoint", uri: null }, factor_values: [] } as Design["factors"][number],
    ]);
    expect(findingDisplayedGoldEmpty(f, draft)).toBeNull();
  });
});

describe("findingActionLabel goldEmpty override", () => {
  it('calibration_match → "Tag match" when goldEmpty is false', () => {
    const f = makeFinding({ issue_code: "calibration_match" });
    expect(findingActionLabel(f)).toBe("Tag match");
    expect(findingActionLabel(f, { goldEmpty: false })).toBe("Tag match");
  });

  it('calibration_match → "Add tag" when goldEmpty is true (the GSE110721 bug)', () => {
    const f = makeFinding({ issue_code: "calibration_match" });
    expect(findingActionLabel(f, { goldEmpty: true })).toBe("Add tag");
  });

  it('calibration_factor_match_exact → "Add factor" when goldEmpty is true', () => {
    const f = makeFinding({
      target_kind: "factor",
      target_id: "factor:treatment",
      issue_code: "calibration_factor_match_exact",
    });
    expect(findingActionLabel(f, { goldEmpty: true })).toBe("Add factor");
  });

  it('calibration_factor_match_near → "Add factor" when goldEmpty is true', () => {
    const f = makeFinding({
      target_kind: "factor",
      target_id: "factor:treatment",
      issue_code: "calibration_factor_match_near",
    });
    expect(findingActionLabel(f, { goldEmpty: true })).toBe("Add factor");
  });

  it('calibration_tag_match_near → "Tag near-match" (was the generic "TAG" fallthrough)', () => {
    const f = makeFinding({ issue_code: "calibration_tag_match_near" });
    expect(findingActionLabel(f)).toBe("Tag near-match");
    expect(findingActionLabel(f, { goldEmpty: true })).toBe("Add tag");
  });

  it('calibration_tag_match_exact → "Tag match"', () => {
    const f = makeFinding({ issue_code: "calibration_tag_match_exact" });
    expect(findingActionLabel(f)).toBe("Tag match");
    expect(findingActionLabel(f, { goldEmpty: true })).toBe("Add tag");
  });

  it('alignment_kind "exact" tag → "Add tag" when goldEmpty is true', () => {
    const f = makeFinding({
      alignment_kind: "exact",
      issue_code: "calibration_match",
    } as Partial<AuditFinding>);
    expect(findingActionLabel(f, { goldEmpty: true })).toBe("Add tag");
  });

  it('non-match findings ignore goldEmpty entirely', () => {
    const f = makeFinding({
      issue_code: "calibration_agent_extra",
    });
    expect(findingActionLabel(f, { goldEmpty: true })).toBe("Add tag");
    expect(findingActionLabel(f, { goldEmpty: false })).toBe("Add tag");
  });
});
