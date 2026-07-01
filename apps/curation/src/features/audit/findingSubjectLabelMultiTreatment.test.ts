import { describe, expect, it } from "vitest";
import type { AuditFinding, AuditReport } from "@/api/auditTypes";
import { findingSubjectLabel } from "./findingHelpers";

/**
 * Regression test for the multi-same-category add-factor header bug
 * (GSE301405 / exp 85336 / ticket 82).
 *
 * The design has THREE factors, two of them ``treatment`` and
 * genuinely distinct in the data:
 *   - decitabine (DNMTi) — FVs: DMSO vehicle (baseline), decitabine 100 nM 5 d
 *   - RG2833 (HDACi)     — FVs: DMSO vehicle (baseline), RG2833 2.5 uM 72 h
 *
 * Both surface as ``calibration_factor_extra`` add-factor cards. The
 * header subject was computed via ``resolveAgentFactor`` which, when
 * ``agent_target_index`` is absent or doesn't disambiguate, falls
 * through to a category-label lookup that silently returns the FIRST
 * ``treatment`` factor — so BOTH cards rendered
 * "treatment: decitabine 100 nM 5 d +/-".
 *
 * The fix reads each finding's OWN ``apply_action.new_factor_payload``
 * (``factorProposalFromApplyAction``) — the authoritative description of
 * what "Agree (add)" creates, carrying the right FVs regardless of the
 * comparison-proposal index. The two cards must now read distinct
 * titles.
 *
 * The fixtures deliberately leave ``agent_target_index`` null AND supply
 * a comparison_proposal whose factors[0] is the decitabine factor — the
 * exact conditions under which the old code collapsed both cards. If a
 * future refactor drops the payload-first resolution and reverts to
 * ``resolveAgentFactor``, this test fails.
 */

const addFactorFinding = (
  nonBaselineLabel: string,
): AuditFinding =>
  ({
    target_kind: "factor",
    // Both treatment factors slug to the same factor target — part of
    // why the category-label fallback collapses them.
    target_id: "factor:treatment",
    severity: "minor",
    issue_code: "calibration_factor_extra",
    rationale: "Add factor `treatment`?",
    agent_target_index: null,
    apply_action: {
      kind: "add_factor",
      new_category: "treatment",
      new_factor_payload: {
        category: { label: "treatment", uri: null },
        name_in_design: "treatment",
        factor_values: [
          { free_text_label: "DMSO vehicle", is_baseline: true },
          { free_text_label: nonBaselineLabel, is_baseline: false },
        ],
      },
    },
  }) as unknown as AuditFinding;

// comparison_proposal whose FIRST treatment factor is decitabine —
// what the buggy category-label fallback would return for BOTH cards.
const report = {
  evidence: {
    comparison_proposal: {
      factors: [
        {
          category: { label: "treatment", uri: null },
          name_in_design: "decitabine (DNMTi)",
          factor_values: [
            { free_text_label: "DMSO vehicle", is_baseline: true },
            { free_text_label: "decitabine 100 nM 5 d", is_baseline: false },
          ],
        },
        {
          category: { label: "treatment", uri: null },
          name_in_design: "RG2833 (HDACi)",
          factor_values: [
            { free_text_label: "DMSO vehicle", is_baseline: true },
            { free_text_label: "RG2833 2.5 uM 72 h", is_baseline: false },
          ],
        },
      ],
    },
  },
} as unknown as AuditReport;

describe("findingSubjectLabel — multi-treatment add-factor cards (GSE301405)", () => {
  it("renders the decitabine card with its own FV", () => {
    const finding = addFactorFinding("decitabine 100 nM 5 d");
    expect(findingSubjectLabel(finding, report, null)).toBe(
      "treatment: decitabine 100 nM 5 d +/-",
    );
  });

  it("renders the RG2833 card with its own FV — not the first treatment factor's", () => {
    const finding = addFactorFinding("RG2833 2.5 uM 72 h");
    expect(findingSubjectLabel(finding, report, null)).toBe(
      "treatment: RG2833 2.5 uM 72 h +/-",
    );
  });

  it("the two cards render DISTINCT titles", () => {
    const a = findingSubjectLabel(
      addFactorFinding("decitabine 100 nM 5 d"),
      report,
      null,
    );
    const b = findingSubjectLabel(
      addFactorFinding("RG2833 2.5 uM 72 h"),
      report,
      null,
    );
    expect(a).not.toBe(b);
  });
});
