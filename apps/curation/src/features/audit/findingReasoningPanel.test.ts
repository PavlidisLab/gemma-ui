/**
 * Tests for FindingReasoningPanel — the unified Reasoning collapsible
 * shared across every finding card type
 * (CompactFindingCard / ComparisonFactorCard / FindingDetailsEditor).
 *
 * Component DOM is exercised by the e2e/_reasoning_panel.spec.ts
 * Playwright spec; here we lock down the pure data-shape helper
 * (``findingHasReasoningContent``) that drives the toggle's enabled
 * / disabled state. The helper IS the single source of truth for
 * "is there anything to show" across both card types — if it
 * regresses, the toggle reads "no reasoning" when it shouldn't (or
 * vice versa).
 */

import { describe, expect, it } from "vitest";
import type {
  AuditFinding,
  ComparisonVerdict,
  ReviewVerdict,
  WhyBlock,
} from "@/api/auditTypes";
import { findingHasReasoningContent } from "./findingReasoningPanel";

function makeFinding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return {
    target_kind: "tag",
    target_id: "tag:0",
    severity: "minor",
    issue_code: "calibration_agent_extra",
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

describe("findingHasReasoningContent", () => {
  it("returns false for an empty finding — toggle should read 'no reasoning'", () => {
    expect(findingHasReasoningContent(makeFinding())).toBe(false);
  });

  it("returns true when finding.why has a brief", () => {
    const why: WhyBlock = {
      brief: "Tag inferred from BM column",
      rationale: "",
      evidence: [],
      citation: "",
      citation_url: "",
    };
    expect(findingHasReasoningContent(makeFinding({ why }))).toBe(true);
  });

  it("returns true when finding.why has a rationale", () => {
    const why: WhyBlock = {
      brief: "",
      rationale: "Sample titles all reference cortical regions.",
      evidence: [],
      citation: "",
      citation_url: "",
    };
    expect(findingHasReasoningContent(makeFinding({ why }))).toBe(true);
  });

  it("returns true when finding.why has any evidence quote", () => {
    const why: WhyBlock = {
      brief: "",
      rationale: "",
      evidence: [
        { quote: "left vs right hemisphere", source: "characteristic" } as never,
      ],
      citation: "",
      citation_url: "",
    };
    expect(findingHasReasoningContent(makeFinding({ why }))).toBe(true);
  });

  it("returns true when finding.reviews has any reviewer entry", () => {
    const reviews: ReviewVerdict[] = [
      { reviewer: "defender", verdict: "kept", rationale: "" } as never,
    ];
    expect(findingHasReasoningContent(makeFinding({ reviews }))).toBe(true);
  });

  it("returns true when finding.comparison has a judge_rationale", () => {
    const comparison: ComparisonVerdict = {
      comparator_label: "polished gold",
      judge_verdict: "",
      judge_rationale: "Partition mismatch (agent_coarser).",
    };
    expect(findingHasReasoningContent(makeFinding({ comparison }))).toBe(true);
  });

  it("returns true when finding.comparison has a judge_verdict (no rationale yet)", () => {
    const comparison: ComparisonVerdict = {
      comparator_label: "polished gold",
      judge_verdict: "agent is right",
      judge_rationale: "",
    };
    expect(findingHasReasoningContent(makeFinding({ comparison }))).toBe(true);
  });

  it("falls back to the legacy proposer_defense field for pre-three-phase findings", () => {
    const f = makeFinding({ proposer_defense: "Inferred from BM data" } as never);
    expect(findingHasReasoningContent(f)).toBe(true);
  });

  it("falls back to the legacy top-level rationale string", () => {
    const f = makeFinding({ rationale: "Partition mismatch" });
    expect(findingHasReasoningContent(f)).toBe(true);
  });

  it("returns true on a citation alone (the curator can at least follow the rule link)", () => {
    expect(
      findingHasReasoningContent(
        makeFinding({ citation: "Curating-Baseline-Factor-Values" }),
      ),
    ).toBe(true);
    expect(
      findingHasReasoningContent(
        makeFinding({ citation_url: "https://example.invalid" }),
      ),
    ).toBe(true);
  });

  it("treats whitespace-only Why fields as empty", () => {
    const why: WhyBlock = {
      brief: "   ",
      rationale: "\n\t",
      evidence: [],
      citation: "",
      citation_url: "",
    };
    expect(findingHasReasoningContent(makeFinding({ why }))).toBe(false);
  });
});
