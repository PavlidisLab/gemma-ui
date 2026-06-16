/**
 * Regression tests for MATCH_DOWNGRADE_ACTION_HANDOFF (2026-06-16).
 *
 * Companion to ``findingDisplayedGoldEmpty.test.ts`` which pinned the
 * TITLE downgrade (ed4f25f). This file pins the ACTION-ROW + dismiss
 * vocab + apply-path propagation: when a stored ``*_match`` finding
 * is viewed against a baseline that lacks the entity, every surface
 * keyed off the match code should read as an Add — shape, labels,
 * dismiss chips, and the apply mutator.
 */
import { describe, expect, it } from "vitest";
import type { AuditFinding } from "@/api/auditTypes";
import type { Design } from "@/features/experiment/types";
import { findingActionShape } from "./actionLabels";
import {
  findingDispositionButtonLabels,
} from "./findingHelpers";
import { dismissChipsFor } from "./dispositionChips";
import { resolveApplyAction } from "./applyHandlers";

function tagMatchFinding(overrides: Partial<AuditFinding> = {}): AuditFinding {
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
    proposer_term: { label: "astrocyte", uri: "http://CL/0000127" },
    ...overrides,
  } as AuditFinding;
}

function factorMatchFinding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return {
    target_kind: "factor",
    target_id: "factor:treatment",
    severity: "ok",
    issue_code: "calibration_factor_match_exact",
    rationale: "",
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

function emptyDraft(): Design {
  return {
    tags: [],
    factors: [],
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

describe("findingActionShape — goldEmpty downgrade", () => {
  it('calibration_match shape is "match" when goldEmpty is false / unset', () => {
    const f = tagMatchFinding();
    expect(findingActionShape(f)).toBe("match");
    expect(findingActionShape(f, { goldEmpty: false })).toBe("match");
  });

  it('calibration_match shape downgrades to "add" when goldEmpty is true', () => {
    const f = tagMatchFinding();
    expect(findingActionShape(f, { goldEmpty: true })).toBe("add");
  });

  it('calibration_factor_match_exact downgrades to "add" when goldEmpty', () => {
    const f = factorMatchFinding();
    expect(findingActionShape(f, { goldEmpty: true })).toBe("add");
  });

  it('calibration_factor_match_near downgrades to "add" when goldEmpty', () => {
    const f = factorMatchFinding({
      issue_code: "calibration_factor_match_near",
    });
    expect(findingActionShape(f, { goldEmpty: true })).toBe("add");
  });

  it("non-match codes are unaffected by goldEmpty", () => {
    const f = tagMatchFinding({ issue_code: "calibration_agent_extra" });
    expect(findingActionShape(f, { goldEmpty: true })).toBe("add");
    expect(findingActionShape(f, { goldEmpty: false })).toBe("add");
  });
});

describe("findingDispositionButtonLabels — goldEmpty downgrade", () => {
  it("calibration_match returns Add labels when goldEmpty", () => {
    const f = tagMatchFinding();
    const lbls = findingDispositionButtonLabels(f, { goldEmpty: true });
    expect(lbls.acceptLabel).toBe("Add");
    expect(lbls.dismissLabel).toBe("Don't add");
    expect(lbls.dismissDialogTitle).toBe("Don't add tag");
  });

  it("calibration_factor_match_exact returns Add labels (factor) when goldEmpty", () => {
    const f = factorMatchFinding();
    const lbls = findingDispositionButtonLabels(f, { goldEmpty: true });
    expect(lbls.acceptLabel).toBe("Add");
    expect(lbls.dismissDialogTitle).toBe("Don't add factor");
  });

  it("no goldEmpty → original Confirm/Not a match labels stand", () => {
    const f = tagMatchFinding();
    const lbls = findingDispositionButtonLabels(f);
    expect(lbls.acceptLabel).toBe("Confirm");
    expect(lbls.dismissLabel).toBe("Not a match");
  });
});

describe("dismissChipsFor — goldEmpty downgrade", () => {
  it("calibration_match returns add-side dismiss chips when goldEmpty", () => {
    const f = tagMatchFinding();
    const chips = dismissChipsFor(f, { goldEmpty: true });
    const keys = chips.map((c) => c.key);
    // CAL_EXTRA_TAG_DISMISS_CHIPS' signature key is
    // ``redundant_with_bm_source`` (the "Redundant — already captured
    // elsewhere" reason). The match-side TAG_MATCH_DISMISS_CHIPS
    // doesn't carry it; presence proves the downgrade routed to the
    // add-side set.
    expect(keys).toContain("redundant_with_bm_source");
  });

  it("factor match returns add-side factor dismiss chips when goldEmpty", () => {
    const f = factorMatchFinding();
    const chips = dismissChipsFor(f, { goldEmpty: true });
    expect(chips.length).toBeGreaterThan(0);
  });

  it("non-goldEmpty match returns the match-side vocab", () => {
    const f = tagMatchFinding();
    const chips = dismissChipsFor(f);
    // Add-side ``redundant_with_bm_source`` must NOT appear on the
    // match-side set — proves the original vocab survives when
    // goldEmpty is absent.
    const keys = chips.map((c) => c.key);
    expect(keys).not.toContain("redundant_with_bm_source");
  });
});

describe("resolveApplyAction — calibration_match + goldEmpty → add_tag mutator", () => {
  it("returns a mutating add-tag action when goldEmpty=true on calibration_match", () => {
    const f = tagMatchFinding();
    const action = resolveApplyAction(f, {
      design: emptyDraft(),
      goldEmpty: true,
    });
    expect(action).not.toBeNull();
    expect(action!.mutates).toBe(true);
    expect(action!.label.toLowerCase()).toContain("add");
    expect(action!.appliedFix?.toLowerCase()).toContain("add");
  });

  it("the mutate fn actually adds the tag to the draft", () => {
    const f = tagMatchFinding();
    const action = resolveApplyAction(f, {
      design: emptyDraft(),
      goldEmpty: true,
    });
    expect(action?.mutate).toBeDefined();
    const next = action!.mutate!(emptyDraft());
    expect(next.tags.length).toBe(1);
    expect(next.tags[0].category.label.toLowerCase()).toContain("cell type");
    expect(next.tags[0].value.label.toLowerCase()).toContain("astrocyte");
  });

  it("calibration_match without goldEmpty returns no mutating action", () => {
    const f = tagMatchFinding();
    const action = resolveApplyAction(f, { design: emptyDraft() });
    // Either null or a focus-only (non-mutating) action — the
    // critical guarantee is that the add mutator does NOT fire.
    if (action) expect(action.mutates).toBe(false);
  });
});
