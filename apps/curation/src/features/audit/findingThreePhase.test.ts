/**
 * Tests for the three-phase finding-card adapters
 * (``findingThreePhase.tsx``).
 *
 * Spec: ``Gemma/handoffs/FINDING_CARD_THREE_PHASE_SPEC_2026_06_15.md``.
 * Principle memory: ``[[feedback_finding_three_phase_contract]]``.
 *
 * We cover the pure projection functions —
 * ``verdictLabel`` / ``deriveWhy`` / ``deriveReviews`` — since they
 * carry the wire-shape contract. The visual components
 * (``WhyPhase`` / ``ReviewsPhase`` / ``ComparisonPhase``) are exercised
 * in integration via ``AgentSuggestionPanel`` / ``ComparisonFactorCard``;
 * not duplicated here.
 */

import { describe, expect, it } from "vitest";
import type {
  AttachedDefenderVerdict,
  AuditFinding,
  AuditReport,
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
    rationale: "Agent proposes a new cell-type tag macrophage.",
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
// verdictLabel
// ---------------------------------------------------------------------------

describe("verdictLabel", () => {
  it("maps the canonical agent_missed_gold variants", () => {
    expect(verdictLabel("AGENT_MISSED_GOLD")).toBe("gold has, agent missed");
    expect(verdictLabel("agent_missed_gold")).toBe("gold has, agent missed");
  });

  it("maps factor-extra family verdicts", () => {
    expect(verdictLabel("extra_genuine_new")).toBe("real new factor / tag");
    expect(verdictLabel("extra_confounded")).toBe("confounded with another");
    expect(verdictLabel("extra_unsupported")).toBe("weak evidence");
  });

  it("maps FV-pair equivalence flavors", () => {
    expect(verdictLabel("synonym")).toBe("same concept, different wording");
    expect(verdictLabel("concept_mismatch")).toBe("different concept");
    expect(verdictLabel("partition_mismatch")).toBe(
      "same factor, samples differ",
    );
  });

  it("forwards unknown verdicts unchanged (escape hatch)", () => {
    expect(verdictLabel("novel_verdict_xyz")).toBe("novel_verdict_xyz");
  });

  it("returns empty string for nullish input", () => {
    expect(verdictLabel("")).toBe("");
    expect(verdictLabel(null)).toBe("");
    expect(verdictLabel(undefined)).toBe("");
  });

  it("trims whitespace", () => {
    expect(verdictLabel("  AGENT_MISSED_GOLD  ")).toBe(
      "gold has, agent missed",
    );
  });
});

// ---------------------------------------------------------------------------
// deriveWhy
// ---------------------------------------------------------------------------

describe("deriveWhy", () => {
  it("returns the new ``why`` block when present and non-empty", () => {
    const why: WhyBlock = {
      brief: "Macrophage is constant.",
      rationale: "Macrophage cell-type tag matches every sample.",
      evidence: [],
      citation: "",
    };
    const finding = makeFinding({ why });
    expect(deriveWhy(finding)).toEqual(why);
  });

  it("falls back to legacy proposer_defense + evidence + citation", () => {
    const finding = makeFinding({
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
      citation_url: "https://example.com/02",
    });
    const why = deriveWhy(finding);
    expect(why).not.toBeNull();
    expect(why?.rationale).toBe("Tag is real per the BM characteristic.");
    expect(why?.evidence).toHaveLength(1);
    expect(why?.citation).toBe("rules/02.md");
    expect(why?.citation_url).toBe("https://example.com/02");
  });

  it("returns null when neither block nor legacy fields have content", () => {
    const finding = makeFinding({
      proposer_defense: "",
      supporting_evidence: [],
      citation: "",
      citation_url: "",
    });
    expect(deriveWhy(finding)).toBeNull();
  });

  it("returns null when the new block exists but is empty", () => {
    const why: WhyBlock = {
      brief: "",
      rationale: "",
      evidence: [],
      citation: "",
      citation_url: "",
    };
    const finding = makeFinding({ why });
    expect(deriveWhy(finding)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// deriveReviews
// ---------------------------------------------------------------------------

describe("deriveReviews", () => {
  it("returns the new ``reviews`` list verbatim when present", () => {
    const reviews = [
      {
        reviewer: "defender",
        verdict: "real new factor / tag",
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

  it("projects defender_verdict into a single review row", () => {
    const dv: AttachedDefenderVerdict = {
      side: "agent_extra",
      verdict: "extra_genuine_new",
      rationale: "Real new property; curator should have tagged.",
    } as AttachedDefenderVerdict;
    const finding = makeFinding({ defender_verdict: dv });
    const result = deriveReviews(finding, emptyReport());
    expect(result).toHaveLength(1);
    expect(result[0].reviewer).toBe("defender");
    expect(result[0].verdict).toBe("extra_genuine_new"); // raw — UI translates at render
    expect(result[0].rationale).toBe(
      "Real new property; curator should have tagged.",
    );
  });

  it("returns empty list when there's nothing to project", () => {
    const finding = makeFinding({ defender_verdict: null });
    expect(deriveReviews(finding, emptyReport())).toEqual([]);
  });

  it("drops defender verdicts without a rationale (renders no row)", () => {
    const dv: AttachedDefenderVerdict = {
      side: "agent_extra",
      verdict: "extra_genuine_new",
      rationale: "",
    } as AttachedDefenderVerdict;
    const finding = makeFinding({ defender_verdict: dv });
    expect(deriveReviews(finding, emptyReport())).toEqual([]);
  });

  it("respects the side->reviewer mapping for arbiter / boss legacy verdicts", () => {
    const arbiterSide: AttachedDefenderVerdict = {
      side: "arbiter",
      verdict: "kept",
      rationale: "Arbiter ran.",
    } as AttachedDefenderVerdict;
    const result = deriveReviews(
      makeFinding({ defender_verdict: arbiterSide }),
      emptyReport(),
    );
    expect(result[0].reviewer).toBe("arbiter");
  });
});
