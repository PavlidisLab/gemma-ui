import { describe, expect, it } from "vitest";

import type { AuditFinding, AuditReport } from "@/api/auditTypes";

import { consequentHint } from "./consequentHint";

function finding(over: Partial<AuditFinding>): AuditFinding {
  return {
    target_kind: "factor",
    target_id: "factor:treatment",
    severity: "minor",
    issue_code: "calibration_factor_extra",
    rationale: "`treatment`",
    citation: "",
    citation_url: "",
    suggested_fix: "",
    proposer_suggestion: "",
    ...over,
  } as unknown as AuditFinding;
}

function report(
  findings: AuditFinding[],
  dispositions: Array<{ target_id: string; status: string }> = [],
): AuditReport {
  return { findings, dispositions } as unknown as AuditReport;
}

/**
 * A factor SWAP — the agent proposes a factor the curator prefers —
 * arrives as two findings: remove the current one
 * (`_factor_gold_only_miss`) and add the agent's (`_factor_extra`).
 * The matcher stamps both halves with one `paired_finding_id`.
 *
 * Before this, the pair was only a JUMP (`PairedFindingBadge`), not a
 * cue: a curator could accept one half and reject the other with
 * nothing pointing out the inconsistency — and because the halves
 * score independently (FN on the removal, FP on the addition), an
 * inconsistent pair corrupts calibration twice for one decision.
 */
describe("consequentHint — paired_finding_id (the swap case)", () => {
  const removeHalf = finding({
    target_id: "factor:cell-line",
    issue_code: "calibration_factor_gold_only_miss",
    paired_finding_id: "pair-1",
  });
  const addHalf = finding({
    target_id: "factor:cell-type",
    issue_code: "calibration_factor_extra",
    paired_finding_id: "pair-1",
  });

  it("suggests the consistent verdict once the other half is decided", () => {
    const r = report([removeHalf, addHalf], [
      { target_id: addHalf.target_id, status: "accepted" },
    ]);
    const hint = consequentHint(removeHalf, r);
    expect(hint?.kind).toBe("implied");
    expect(hint?.linked.target_id).toBe(addHalf.target_id);
  });

  it("resolves symmetrically from either half", () => {
    const r = report([removeHalf, addHalf], [
      { target_id: removeHalf.target_id, status: "accepted" },
    ]);
    expect(consequentHint(addHalf, r)?.linked.target_id).toBe(
      removeHalf.target_id,
    );
  });

  it("stays silent while neither half is decided — nothing to suggest from", () => {
    expect(consequentHint(removeHalf, report([removeHalf, addHalf]))).toBeNull();
  });

  // A UUID with no sibling in this report is not a link.
  it("returns null when the pair's other half isn't present", () => {
    expect(consequentHint(removeHalf, report([removeHalf]))).toBeNull();
  });

  it("never pairs a finding with itself", () => {
    const solo = finding({ paired_finding_id: "pair-9" });
    expect(consequentHint(solo, report([solo]))).toBeNull();
  });

  // consequent_of is the primary decision (the partition mismatch);
  // paired_finding_id must not shadow it.
  it("prefers consequent_of over paired_finding_id when both are set", () => {
    const upstream = finding({ target_id: "factor:upstream" });
    const both = finding({
      target_id: "factor:both",
      consequent_of: "factor:upstream",
      paired_finding_id: "pair-1",
    });
    const r = report([upstream, both, addHalf], [
      { target_id: "factor:upstream", status: "accepted" },
    ]);
    expect(consequentHint(both, r)?.linked.target_id).toBe("factor:upstream");
  });
});
