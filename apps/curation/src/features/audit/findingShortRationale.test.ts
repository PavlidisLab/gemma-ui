/**
 * Regression tests for the short-rationale precedence flip
 * (FINDING_SHORT_RATIONALE_BM_AWARE_2026_06_16).
 *
 * Pre-flip: ``calibration_gold_only_miss`` findings unconditionally
 * returned the curated "Agent did not propose" copy, overriding any
 * richer ``suggested_fix`` the agent shipped (e.g. "Already captured
 * by biomaterial characteristic").
 *
 * Post-flip: ``suggested_fix`` wins when populated; the curated copy
 * stays as a fallback for the empty case so the curator never sees a
 * blank caption.
 */
import { describe, expect, it } from "vitest";
import type { AuditFinding } from "@/api/auditTypes";
import { findingShortRationale, isEchoRationale } from "./findingHelpers";

function missFinding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return {
    target_kind: "tag",
    target_id: "tag:organism-part/liver",
    severity: "minor",
    issue_code: "calibration_gold_only_miss",
    rationale: "",
    rationale_summary: "",
    rationale_bin: "",
    citation: "",
    citation_url: "",
    supporting_evidence: [],
    suggested_fix: "",
    why: null,
    reviews: [],
    comparison: null,
    ...overrides,
  } as AuditFinding;
}

describe("findingShortRationale — gold_only_miss precedence", () => {
  it("returns suggested_fix when populated (BM-aware caption)", () => {
    const f = missFinding({
      suggested_fix: "Already captured by biomaterial characteristic",
    });
    expect(findingShortRationale(f)).toBe(
      "Already captured by biomaterial characteristic",
    );
  });

  it('falls back to "Agent did not propose" when suggested_fix is empty', () => {
    const f = missFinding();
    expect(findingShortRationale(f)).toBe("Agent did not propose");
  });

  it("same fallback rule on the factor-side gold_only_miss code", () => {
    const f = missFinding({
      issue_code: "calibration_factor_gold_only_miss",
      target_kind: "factor",
    });
    expect(findingShortRationale(f)).toBe("Agent did not propose");
  });

  it("prefers suggested_fix over rationale even on gold_only_miss", () => {
    const f = missFinding({
      suggested_fix: "Already captured by biomaterial characteristic",
      rationale:
        "Some long rationale paragraph that would otherwise win.",
    });
    expect(findingShortRationale(f)).toBe(
      "Already captured by biomaterial characteristic",
    );
  });

  it("skips a rationale that just echoes the existing curation back", () => {
    // Design review 2026-06-21: "The existing curation has `cell type: …`" just
    // restates the chips already on the row. Drop it and show the
    // curated reason instead of the noise.
    const f = missFinding({
      rationale:
        "The existing curation has `cell type: lymphoblastoid cell line`",
    });
    expect(findingShortRationale(f)).toBe("Agent did not propose");
  });

  it("keeps a rationale that actually explains why", () => {
    const f = missFinding({
      rationale: "Redundant with the cell line factor in the design",
    });
    expect(findingShortRationale(f)).toBe(
      "Redundant with the cell line factor in the design",
    );
  });
});

describe("isEchoRationale", () => {
  it("flags pure restatements of the current curation", () => {
    expect(
      isEchoRationale("The existing curation has `disease: Down syndrome`"),
    ).toBe(true);
    expect(isEchoRationale("Curation already includes this tag")).toBe(true);
    expect(isEchoRationale("Gemma already carries `cell type: x`")).toBe(true);
    expect(isEchoRationale("The design already contains the factor")).toBe(
      true,
    );
  });

  it("does NOT flag rationales that explain a reason", () => {
    expect(isEchoRationale("Redundant with the cell line factor")).toBe(false);
    expect(isEchoRationale("Agent did not propose this tag")).toBe(false);
    expect(isEchoRationale("")).toBe(false);
    expect(isEchoRationale(null)).toBe(false);
  });
});
