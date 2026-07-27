import { describe, expect, it } from "vitest";
import {
  findingLean,
  leanSuggestionLabel,
  verdictLean,
} from "./defenderLean";
import type {
  AttachedDefenderVerdict,
  AuditFinding,
} from "@/api/auditTypes";

/** Pins down the verdict→lean mapping (mirror of agents-repo
 *  `_LEGACY_LEANS` / `_ARBITER_LEANS`) and the single-axis header
 *  label the UI renders. Drives the GSE93824 Arctic-APP fix (the reviewer
 *  2026-05-21): "STRONG SUGGESTION" used to highlight `adopt
 *  Auditor's` even when the judge said `concept_gold_right` (agent
 *  is wrong). With the single-axis label, that finding now reads
 *  "NOT SUGGESTED" and the `keep current` button is the primary
 *  action on both the outer and per-FV rows.
 */

function makeFinding(
  overrides: Partial<AuditFinding> = {},
): AuditFinding {
  return {
    target_id: "tgt",
    target_kind: "factor_value",
    issue_code: "calibration_factor_match_near",
    severity: "minor",
    rationale: "test",
    ...overrides,
  } as AuditFinding;
}

function makeVerdict(
  verdict: string,
  strength?: "weak" | "moderate" | "strong",
): AttachedDefenderVerdict {
  return {
    side: "agent_extra",
    verdict: verdict as AttachedDefenderVerdict["verdict"],
    strength,
    rationale: "test rationale",
    citation: "",
  };
}

// ---------------------------------------------------------------------------
// verdictLean
// ---------------------------------------------------------------------------

describe("verdictLean", () => {
  // FV concept-diff verdicts (2026-05-21 — the GSE93824 case)
  it("concept_agent_right → pro_agent", () => {
    expect(verdictLean("concept_agent_right")).toBe("pro_agent");
  });

  it("concept_gold_right → pro_gold (GSE93824 case)", () => {
    expect(verdictLean("concept_gold_right")).toBe("pro_gold");
  });

  it("concept_equivalent → neutral", () => {
    expect(verdictLean("concept_equivalent")).toBe("neutral");
  });

  it("concept_both_wrong → pro_gold", () => {
    expect(verdictLean("concept_both_wrong")).toBe("pro_gold");
  });

  it("concept_borderline → neutral", () => {
    expect(verdictLean("concept_borderline")).toBe("neutral");
  });

  // Tag-side
  it("extra_genuine_new → pro_agent", () => {
    expect(verdictLean("extra_genuine_new")).toBe("pro_agent");
  });

  it("extra_unsupported → pro_gold", () => {
    expect(verdictLean("extra_unsupported")).toBe("pro_gold");
  });

  it("agent_miss_genuine → pro_gold", () => {
    expect(verdictLean("agent_miss_genuine")).toBe("pro_gold");
  });

  // Factor-side
  it("miss_genuine → pro_gold", () => {
    expect(verdictLean("miss_genuine")).toBe("pro_gold");
  });

  it("miss_overzealous_gold → pro_agent", () => {
    expect(verdictLean("miss_overzealous_gold")).toBe("pro_agent");
  });

  it("extra_confounded → pro_gold", () => {
    expect(verdictLean("extra_confounded")).toBe("pro_gold");
  });

  // Arbiter
  it("gold_correct_per_rule → pro_gold", () => {
    expect(verdictLean("gold_correct_per_rule")).toBe("pro_gold");
  });

  it("agent_correct_per_rule → pro_agent", () => {
    expect(verdictLean("agent_correct_per_rule")).toBe("pro_agent");
  });

  it("judgment_genuine_miss → pro_gold", () => {
    expect(verdictLean("judgment_genuine_miss")).toBe("pro_gold");
  });

  // Unknowns + missing
  it("unknown verdict → neutral", () => {
    expect(verdictLean("future_verdict_we_havent_seen")).toBe("neutral");
  });

  it("null verdict → neutral", () => {
    expect(verdictLean(null)).toBe("neutral");
  });

  it("undefined verdict → neutral", () => {
    expect(verdictLean(undefined)).toBe("neutral");
  });
});

// ---------------------------------------------------------------------------
// findingLean — combines defender_verdict + proposer_flags
// ---------------------------------------------------------------------------

describe("findingLean", () => {
  it("uses verdict label when present (concept_gold_right → pro_gold)", () => {
    const finding = makeFinding({
      defender_verdict: makeVerdict("concept_gold_right", "strong"),
    });
    expect(findingLean(finding)).toBe("pro_gold");
  });

  it("uses verdict label when present (concept_agent_right → pro_agent)", () => {
    const finding = makeFinding({
      defender_verdict: makeVerdict("concept_agent_right", "strong"),
    });
    expect(findingLean(finding)).toBe("pro_agent");
  });

  it("falls back to proposer_flags=judge_agrees_agent when verdict unknown", () => {
    // Unknown verdict (forward-compat) but flag set → still pro_agent.
    const finding = makeFinding({
      defender_verdict: makeVerdict("future_investigator_verdict", "moderate"),
      proposer_flags: ["judge_agrees_agent"],
    });
    expect(findingLean(finding)).toBe("pro_agent");
  });

  it("falls back to proposer_flags when no defender_verdict at all", () => {
    const finding = makeFinding({
      proposer_flags: ["judge_agrees_agent"],
    });
    expect(findingLean(finding)).toBe("pro_agent");
  });

  it("verdict pro_gold beats proposer_flags=judge_agrees_agent", () => {
    // If the producer somehow emits both (shouldn't, but be safe),
    // the verdict label is more specific and wins.
    const finding = makeFinding({
      defender_verdict: makeVerdict("concept_gold_right", "strong"),
      proposer_flags: ["judge_agrees_agent"],
    });
    expect(findingLean(finding)).toBe("pro_gold");
  });

  it("no defender_verdict, no flags → neutral", () => {
    const finding = makeFinding();
    expect(findingLean(finding)).toBe("neutral");
  });

  it("neutral verdict + no flags → neutral", () => {
    const finding = makeFinding({
      defender_verdict: makeVerdict("concept_borderline", "moderate"),
    });
    expect(findingLean(finding)).toBe("neutral");
  });
});

// ---------------------------------------------------------------------------
// leanSuggestionLabel — header text in AgentSuggestionPanel.
// Single-axis framing (design review 2026-05-21): the label always describes
// the *strength of the suggestion to change*. Keep / change are
// inverse senses of one axis, not two separate dimensions.
// ---------------------------------------------------------------------------

describe("leanSuggestionLabel (single-axis)", () => {
  // ---- pro_agent: change is suggested; strength tracks confidence ----
  it("pro_agent + strong → 'STRONG SUGGESTION'", () => {
    expect(leanSuggestionLabel("pro_agent", "strong")).toBe(
      "STRONG SUGGESTION",
    );
  });

  it("pro_agent + moderate → 'MODERATE SUGGESTION'", () => {
    expect(leanSuggestionLabel("pro_agent", "moderate")).toBe(
      "MODERATE SUGGESTION",
    );
  });

  it("pro_agent + weak → 'WEAK SUGGESTION'", () => {
    expect(leanSuggestionLabel("pro_agent", "weak")).toBe(
      "WEAK SUGGESTION",
    );
  });

  // ---- pro_gold: judge against the change; flips to NOT SUGGESTED at strong ----
  it("pro_gold + strong → 'NOT SUGGESTED' (GSE93824 case)", () => {
    expect(leanSuggestionLabel("pro_gold", "strong")).toBe("NOT SUGGESTED");
  });

  it("pro_gold + moderate → 'WEAK SUGGESTION'", () => {
    expect(leanSuggestionLabel("pro_gold", "moderate")).toBe(
      "WEAK SUGGESTION",
    );
  });

  it("pro_gold + weak → 'WEAK SUGGESTION'", () => {
    expect(leanSuggestionLabel("pro_gold", "weak")).toBe("WEAK SUGGESTION");
  });

  // ---- neutral: judge graded but didn't pick a side ----
  it("neutral + moderate → 'NO RECOMMENDATION'", () => {
    expect(leanSuggestionLabel("neutral", "moderate")).toBe(
      "NO RECOMMENDATION",
    );
  });

  it("neutral + strong → 'NO RECOMMENDATION'", () => {
    expect(leanSuggestionLabel("neutral", "strong")).toBe(
      "NO RECOMMENDATION",
    );
  });

  // ---- null strength: preserve original fallback text ----
  it("neutral + null strength → 'suggestion' (no defender attached)", () => {
    expect(leanSuggestionLabel("neutral", null)).toBe("suggestion");
  });

  it("pro_gold + null strength → 'suggestion'", () => {
    // No strength info → suppress the directional label even if a
    // lean is computable from elsewhere. Matches the original "what
    // was proposed" fallback.
    expect(leanSuggestionLabel("pro_gold", null)).toBe("suggestion");
  });

  it("pro_agent + undefined strength → 'suggestion'", () => {
    expect(leanSuggestionLabel("pro_agent", undefined)).toBe("suggestion");
  });
});
