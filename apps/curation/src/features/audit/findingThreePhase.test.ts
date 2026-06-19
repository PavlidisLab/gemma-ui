/**
 * Tests for the three-phase finding-card adapters
 * (``findingThreePhase.tsx``) — Phase 3 of the rollout.
 *
 * Spec: ``Gemma/handoffs/FINDING_CARD_THREE_PHASE_SPEC_2026_06_15.md``.
 * Principle: ``[[feedback_finding_three_phase_contract]]``.
 *
 * Phase 3 (Paul 2026-06-15): UI reads the new wire blocks
 * (``finding.why`` / ``finding.reviews`` / ``finding.comparison``)
 * directly. No legacy-field fallback. Vocabulary translation is
 * producer-side; ``verdictLabel`` is a thin pass-through.
 */

import { describe, expect, it } from "vitest";
import type {
  AuditFinding,
  AuditReport,
  ReviewVerdict,
  WhyBlock,
} from "@/api/auditTypes";
import {
  deriveReviews,
  deriveWhy,
  verdictLabel,
} from "./findingThreePhase";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
    suggested_fix: "",
    proposer_suggestion: "",
    apply_action: null,
    proposer_term: null,
    proposer_statements: [],
    proposer_defense: "",
    debate_badge: "",
    proposer_flags: [],
    supporting_evidence: [],
    paper_excerpts_unavailable: false,
    defender_verdict: null,
    rename: null,
    partition_mismatch: null,
    gold_target_index: null,
    gold_curation_id: null,
    agent_target_index: null,
    consequent_of: null,
    consequents: [],
    paired_finding_id: null,
    ...overrides,
  } as AuditFinding;
}

function emptyReport(): AuditReport | null {
  return null;
}

// ---------------------------------------------------------------------------
// verdictLabel — Phase 3: producer ships curator-friendly strings,
// UI just trims + passes through. Translation table is gone.
// ---------------------------------------------------------------------------

describe("verdictLabel", () => {
  it("passes through curator-friendly strings verbatim", () => {
    expect(verdictLabel("Gold has, agent missed")).toBe(
      "Gold has, agent missed",
    );
    expect(verdictLabel("Real new factor")).toBe("Real new factor");
    expect(verdictLabel("Same concept, different wording")).toBe(
      "Same concept, different wording",
    );
  });

  it("passes through wire-debug strings unchanged (no translation)", () => {
    // Phase 3: producer is responsible for shipping the right
    // string. If a finding still has a raw debug label, the UI
    // surfaces it as-is so we can see the wire issue.
    expect(verdictLabel("AGENT_MISSED_GOLD")).toBe("AGENT_MISSED_GOLD");
  });

  it("returns empty string for nullish input", () => {
    expect(verdictLabel("")).toBe("");
    expect(verdictLabel(null)).toBe("");
    expect(verdictLabel(undefined)).toBe("");
  });

  it("trims whitespace", () => {
    expect(verdictLabel("  Real new factor  ")).toBe("Real new factor");
  });
});

// ---------------------------------------------------------------------------
// deriveWhy — Phase 3: reads finding.why directly, no legacy
// fallback.
// ---------------------------------------------------------------------------

describe("deriveWhy", () => {
  it("returns the wire ``why`` block when populated", () => {
    const why: WhyBlock = {
      brief: "Macrophage is constant.",
      rationale: "Macrophage cell-type tag matches every sample.",
      evidence: [],
      citation: "",
    };
    const finding = makeFinding({ why });
    expect(deriveWhy(finding)).toEqual(why);
  });

  it("returns null when finding.why is absent (no legacy fallback)", () => {
    const finding = makeFinding({
      // Legacy fields populated but no `why` block → null. The
      // producer-side migration ought to have projected these into
      // a why block; if it didn't, the section is omitted.
      proposer_defense: "Tag is real per the BM characteristic.",
      supporting_evidence: [
        {
          quote: "cell type=macrophage",
          source: "characteristic" as const,
          location: "BM column",
          highlights: [],
        },
      ],
      citation: "rules/02.md",
    });
    expect(deriveWhy(finding)).toBeNull();
  });

  it("returns null when finding.why is present but empty", () => {
    const finding = makeFinding({
      why: {
        brief: "",
        rationale: "",
        evidence: [],
        citation: "",
        citation_url: "",
      },
    });
    expect(deriveWhy(finding)).toBeNull();
  });

  it("returns the block when only brief is populated", () => {
    const why: WhyBlock = {
      brief: "Short summary only.",
      rationale: "",
      evidence: [],
      citation: "",
    };
    const finding = makeFinding({ why });
    expect(deriveWhy(finding)).toEqual(why);
  });

  it("returns the block when only citation is populated", () => {
    const why: WhyBlock = {
      brief: "",
      rationale: "",
      evidence: [],
      citation: "rules/02.md",
    };
    const finding = makeFinding({ why });
    expect(deriveWhy(finding)).toEqual(why);
  });
});

// ---------------------------------------------------------------------------
// deriveReviews — Phase 3: returns finding.reviews directly, empty
// when absent.
// ---------------------------------------------------------------------------

describe("deriveReviews", () => {
  it("returns the wire ``reviews`` list verbatim", () => {
    const reviews: ReviewVerdict[] = [
      {
        reviewer: "defender",
        verdict: "Real new factor",
        rationale: "Real new property.",
      },
      {
        reviewer: "boss",
        verdict: "kept",
        rationale: "Holistic check passes.",
      },
    ];
    const finding = makeFinding({ reviews });
    expect(deriveReviews(finding, emptyReport())).toEqual(reviews);
  });

  it("returns empty array when reviews is absent (no legacy fallback)", () => {
    // Legacy defender_verdict populated but no `reviews` list →
    // caller renders the "no review was done" placeholder.
    const finding = makeFinding({
      defender_verdict: {
        side: "agent_extra",
        verdict: "extra_genuine_new",
        rationale: "Real new property.",
      } as never,
    });
    expect(deriveReviews(finding, emptyReport())).toEqual([]);
  });

  it("returns empty array when reviews is undefined", () => {
    const finding = makeFinding();
    expect(deriveReviews(finding, emptyReport())).toEqual([]);
  });

  it("returns empty array when reviews is an empty array (still empty)", () => {
    const finding = makeFinding({ reviews: [] });
    expect(deriveReviews(finding, emptyReport())).toEqual([]);
  });
});
