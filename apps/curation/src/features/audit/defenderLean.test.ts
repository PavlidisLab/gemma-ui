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
 *  `_LEGACY_LEANS` / `_ARBITER_LEANS`) and the header-label
 *  strings the UI renders. Drives the GSE93824 Arctic-APP fix
 *  (Paul 2026-05-21): "STRONG SUGGESTION" used to highlight
 *  `adopt Auditor's` even when the judge said `concept_gold_right`
 *  (agent is wrong). With the lean-aware label, that finding now
 *  reads "STRONG: keep current" and the `keep current` button is
 *  the primary action.
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
// leanSuggestionLabel — header text in AgentSuggestionPanel
// ---------------------------------------------------------------------------

describe("leanSuggestionLabel", () => {
  // ---- Case 1: GSE93824 — concept_gold_right + strong ----
  it("pro_gold + STRONG → 'STRONG: keep current' (GSE93824 case)", () => {
    expect(leanSuggestionLabel("pro_gold", "STRONG")).toBe(
      "STRONG: keep current",
    );
  });

  // ---- Case 2: pro_agent — today's behaviour preserved ----
  it("pro_agent + STRONG → 'STRONG SUGGESTION' (today's behaviour)", () => {
    expect(leanSuggestionLabel("pro_agent", "STRONG")).toBe(
      "STRONG SUGGESTION",
    );
  });

  it("pro_agent + MODERATE → 'MODERATE SUGGESTION'", () => {
    expect(leanSuggestionLabel("pro_agent", "MODERATE")).toBe(
      "MODERATE SUGGESTION",
    );
  });

  it("pro_agent + WEAK → 'WEAK SUGGESTION'", () => {
    expect(leanSuggestionLabel("pro_agent", "WEAK")).toBe(
      "WEAK SUGGESTION",
    );
  });

  // ---- Case 3: neutral / no defender ----
  it("neutral + null strength → 'suggestion' (no recommendation)", () => {
    expect(leanSuggestionLabel("neutral", null)).toBe("suggestion");
  });

  it("pro_gold + null strength → 'suggestion' (no recommendation)", () => {
    // No strength info → suppress the label even if a lean is
    // computable from elsewhere. Matches the original "what was
    // proposed" fallback.
    expect(leanSuggestionLabel("pro_gold", null)).toBe("suggestion");
  });

  // ---- Edge: neutral + strength (e.g. moderate borderline) ----
  it("neutral + MODERATE → 'MODERATE (no recommendation)'", () => {
    expect(leanSuggestionLabel("neutral", "MODERATE")).toBe(
      "MODERATE (no recommendation)",
    );
  });

  // ---- Case 4: pro_gold weak (e.g. extra_unsupported, miss_genuine) ----
  it("pro_gold + WEAK → 'WEAK: keep current'", () => {
    expect(leanSuggestionLabel("pro_gold", "WEAK")).toBe(
      "WEAK: keep current",
    );
  });
});
