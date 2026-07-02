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
  dedupeReviews,
  deriveReviews,
  deriveWhy,
  reviewerPhase,
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

  it("passes through upper-case wire-debug strings unchanged", () => {
    // Upper-case codes don't match the snake_case humanizer (which
    // only fires on lower-case codes) so they surface verbatim and
    // the wire issue stays visible.
    expect(verdictLabel("AGENT_MISSED_GOLD")).toBe("AGENT_MISSED_GOLD");
  });

  it("maps proposer-reasoning codes to a confidence read (no gold ref)", () => {
    // No-gold codes: the proposer's confidence in its OWN reasoning.
    expect(verdictLabel("extra_genuine_new")).toBe("strongly supported");
    expect(verdictLabel("extra_borderline")).toBe("borderline");
    expect(verdictLabel("extra_unsupported")).toBe("weakly supported");
    expect(verdictLabel("miss_borderline")).toBe("borderline");
    expect(verdictLabel("agent_correct_inherited")).toBe(
      "supported (inherited)",
    );
    // None of the proposer-reasoning labels reference current/gold.
    for (const code of [
      "extra_genuine_new",
      "extra_borderline",
      "extra_unsupported",
      "extra_confounded",
      "extra_inherited_redundant",
      "agent_correct_inherited",
      "agent_miss_genuine",
      "miss_genuine",
      "miss_inherited_from_design",
      "miss_borderline",
    ]) {
      expect(verdictLabel(code).toLowerCase()).not.toContain("gold");
      expect(verdictLabel(code).toLowerCase()).not.toContain("current");
      expect(verdictLabel(code).toLowerCase()).not.toContain("ruling");
    }
  });

  it("maps arbiter-ruling codes to a comparison ruling", () => {
    expect(verdictLabel("gold_correct_per_rule")).toBe(
      "Ruling: the current curation is correct",
    );
    expect(verdictLabel("agent_correct_per_rule")).toBe(
      "Ruling: the proposal is correct",
    );
    expect(verdictLabel("equivalent_per_rule")).toBe("Ruling: equivalent");
    expect(verdictLabel("cannot_judge")).toBe("Couldn't judge");
    // Gold-naming codes the producer files under the "legacy
    // defender" dict are still arbiter rulings.
    expect(verdictLabel("concept_gold_right")).toBe(
      "Ruling: the current curation is correct",
    );
    expect(verdictLabel("miss_overzealous_gold")).toBe(
      "Ruling: the proposal is correct (current curation overzealous)",
    );
  });

  it("humanizes unknown lower-case snake_case codes (no raw debug)", () => {
    expect(verdictLabel("some_future_code")).toBe("Some future code");
    // Result never contains a raw underscore.
    expect(verdictLabel("foo_bar_baz")).not.toContain("_");
  });

  it("returns empty string for nullish input", () => {
    expect(verdictLabel("")).toBe("");
    expect(verdictLabel(null)).toBe("");
    expect(verdictLabel(undefined)).toBe("");
  });

  it("trims whitespace", () => {
    expect(verdictLabel("  Real new factor  ")).toBe("Real new factor");
    // Known codes resolve after trimming too.
    expect(verdictLabel("  extra_genuine_new  ")).toBe("strongly supported");
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

// ---------------------------------------------------------------------------
// reviewerPhase — the fv-concept adjudicator is GOLD-SEEING and must
// route to the Gold-comparison phase, never the gold-blind Proposer
// phase (bug: it was tagged "defender" and duplicated its ruling into
// both phases).
// ---------------------------------------------------------------------------

describe("reviewerPhase", () => {
  it("routes the fv-concept (vs gold) reviewer to the gold phase", () => {
    expect(reviewerPhase("fv-concept (vs gold)")).toBe("gold");
    expect(reviewerPhase("FV-Concept (vs gold)")).toBe("gold");
  });

  it("routes the arbiter / comparison judge to the gold phase", () => {
    expect(reviewerPhase("arbiter")).toBe("gold");
    expect(reviewerPhase("comparison judge")).toBe("gold");
  });

  it("routes defender / factor_defender to the gold phase (they read gold.jsonl)", () => {
    // Corrected 2026-07-01: the defender pass is gold-AWARE (audit mode),
    // so its advocacy belongs in the sees-gold group, not the gold-blind
    // proposer voice (whose reasoning is the separate WHY block).
    expect(reviewerPhase("defender")).toBe("gold");
    expect(reviewerPhase("factor_defender")).toBe("gold");
  });

  it("routes the boss and unknown reviewers to the internal-critic phase", () => {
    expect(reviewerPhase("boss")).toBe("critic");
    expect(reviewerPhase("boss-critic")).toBe("critic");
  });
});

// ---------------------------------------------------------------------------
// dedupeReviews — collapse the fv-concept full text vs the arbiter's
// brief restatement of the same ruling (near-duplicate: one rationale a
// normalised prefix of / contained in the other). Keep the longer row.
// ---------------------------------------------------------------------------

describe("dedupeReviews", () => {
  function rv(reviewer: string, rationale: string): ReviewVerdict {
    return { reviewer, verdict: "", brief: rationale, rationale } as ReviewVerdict;
  }

  it("collapses full-vs-brief near-duplicates, keeping the longer row", () => {
    const full =
      "The current curation binds `genotype` to Cre-driver line; the " +
      "proposal binds the floxed allele. Both describe the same conditional " +
      "knockout — equivalent per rule.";
    const brief = "Both describe the same conditional knockout";
    const out = dedupeReviews([
      rv("fv-concept (vs gold)", full),
      rv("arbiter", brief),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].rationale).toBe(full);
    expect(out[0].reviewer).toBe("fv-concept (vs gold)");
  });

  it("collapses regardless of row order (brief first)", () => {
    const full = "Alpha beta gamma delta epsilon.";
    const brief = "Alpha beta gamma";
    const out = dedupeReviews([rv("arbiter", brief), rv("fv-concept (vs gold)", full)]);
    expect(out).toHaveLength(1);
    expect(out[0].rationale).toBe(full);
  });

  it("ignores whitespace / case differences", () => {
    const a = "Same   Concept,   different WORDING.";
    const b = "same concept, different wording.";
    const out = dedupeReviews([rv("fv-concept (vs gold)", a), rv("arbiter", b)]);
    expect(out).toHaveLength(1);
  });

  it("keeps genuinely distinct rationales", () => {
    const out = dedupeReviews([
      rv("defender", "The proposed factor is a real new property."),
      rv("arbiter", "Ruling: the current curation is correct; agent missed it."),
    ]);
    expect(out).toHaveLength(2);
  });
});
