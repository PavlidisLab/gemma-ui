import { describe, expect, it } from "vitest";
import type { AuditFinding, FindingEvidence } from "@/api/auditTypes";
import { findingEvidenceRender } from "./paperExcerptsCaption";

/**
 * Contract tests for the AgentDetailsPanel's "render the muted
 * un-grounded caption?" decision. Pins the three-state contract from
 * the agents-side 2026-06-12 schema change so we can't accidentally regress
 * back to either (a) blanket-suppressing the caption when it should
 * appear, or (b) leaking it on structural-only findings that never
 * had a rationale.
 */

function evidence(quote: string): FindingEvidence {
  return {
    source: "paper",
    quote,
  };
}

function finding(
  partial: Partial<AuditFinding>,
): Pick<AuditFinding, "supporting_evidence" | "paper_excerpts_unavailable"> {
  return {
    supporting_evidence: partial.supporting_evidence,
    paper_excerpts_unavailable: partial.paper_excerpts_unavailable,
  };
}

describe("findingEvidenceRender", () => {
  it("renders blockquotes when supporting_evidence is populated", () => {
    expect(
      findingEvidenceRender(
        finding({
          supporting_evidence: [evidence("Treatment was delivered IP daily")],
          paper_excerpts_unavailable: false,
        }),
      ),
    ).toBe("blockquotes");
  });

  it("renders blockquotes even when paper_excerpts_unavailable is true (real evidence wins)", () => {
    // Defensive: if the agent ever ships BOTH a real quote AND the
    // flag (shouldn't happen, but the producer side could regress
    // accidentally), the real quote is the source of truth.
    expect(
      findingEvidenceRender(
        finding({
          supporting_evidence: [evidence("From Methods, page 3")],
          paper_excerpts_unavailable: true,
        }),
      ),
    ).toBe("blockquotes");
  });

  it("renders the muted caption when evidence is empty and paper_excerpts_unavailable is true", () => {
    expect(
      findingEvidenceRender(
        finding({
          supporting_evidence: [],
          paper_excerpts_unavailable: true,
        }),
      ),
    ).toBe("muted_caption");
  });

  it("renders nothing when evidence is empty and paper_excerpts_unavailable is false (structural-only finding)", () => {
    // calibration_factor_gold_only_miss et al — no rationale to
    // ground, no caption needed.
    expect(
      findingEvidenceRender(
        finding({
          supporting_evidence: [],
          paper_excerpts_unavailable: false,
        }),
      ),
    ).toBe("nothing");
  });

  it("renders nothing when both fields are absent (legacy report shape)", () => {
    expect(
      findingEvidenceRender(finding({})),
    ).toBe("nothing");
  });

  it("renders the muted caption when supporting_evidence is absent (undefined) but flag is true", () => {
    expect(
      findingEvidenceRender(
        finding({
          paper_excerpts_unavailable: true,
        }),
      ),
    ).toBe("muted_caption");
  });

  it("treats undefined paper_excerpts_unavailable the same as false", () => {
    expect(
      findingEvidenceRender(
        finding({
          supporting_evidence: [],
          paper_excerpts_unavailable: undefined,
        }),
      ),
    ).toBe("nothing");
  });
});
