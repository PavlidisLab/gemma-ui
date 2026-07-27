import { describe, expect, it } from "vitest";
import type {
  AttachedDefenderVerdict,
  AuditFinding,
  FactorRenamePayload,
} from "@/api/auditTypes";
import { isNearMatchFinding } from "./factorMatch";
import { AGENT_NO_DETAILS_SENTINEL, pickJudgeRowText } from "./auditorDetails";
import { findingLean, leanSuggestionLabel } from "./defenderLean";

/** Tests covering the two-chip header redesign for finding cards
 *  (design review 2026-05-21 — reference case GSE93824 genotype near-match
 *  in the hardcase10-r6 calibration package).
 *
 *  These predicates are the source of truth for two layout flips:
 *
 *    1. AgentSuggestionPanel (factor-card-level): on near-match
 *       findings the single-axis strength label
 *       (``leanSuggestionLabel``) and the "Judge:" rationale row
 *       are SUPPRESSED — the two header chips (green disc +
 *       yellow N badge) carry the same signal more cleanly, and
 *       the WHY moves into the FV expansion block. On
 *       extra / gold-only-miss / partition-mismatch findings the
 *       strength label STAYS — those are whole-factor decisions
 *       where the "STRONG SUGGESTION / NOT SUGGESTED" framing is
 *       the right one.
 *
 *    2. DisagreementBlock (FV-level): when the parent passes a
 *       ``judgeText`` prop on a near-match finding, the block
 *       renders it inline so the rationale binds to the exact FV
 *       being corrected.
 *
 *  The actual JSX rendering is inline so these tests pin down the
 *  decisions feeding it. Predecessor commits: ``21f7f17`` (unified
 *  card template + header chips) and ``86bdf78`` (per-FV row mirrors
 *  outer lean — the "split bug" regression-prevent). */

const term = (label: string) => ({
  label,
  uri: null,
  resolver: null,
  score: null,
});

function makeFinding(partial: Partial<AuditFinding> = {}): AuditFinding {
  return {
    target_kind: "factor",
    target_id: "factor:0",
    severity: "minor",
    issue_code: "calibration_factor_match_near",
    rationale: "",
    citation: "",
    citation_url: "",
    suggested_fix: "",
    proposer_suggestion: "",
    ...partial,
  };
}

function makeVerdict(
  rationale: string | null,
  strength?: "weak" | "moderate" | "strong",
): AttachedDefenderVerdict {
  return {
    // ``side`` narrowed to agent_extra / agent_missed_gold on the
    // wire (auditTypes.ts:394). Older fixture used "fv_concept_diff"
    // which no longer matches the type. Pick agent_extra here — this
    // test exercises layout, not side-specific branches.
    side: "agent_extra",
    verdict: "concept_gold_right" as AttachedDefenderVerdict["verdict"],
    strength,
    rationale: rationale ?? "",
    citation: "https://gemma.example/cite",
  };
}

function makeRename(): FactorRenamePayload {
  return {
    agent: { category: term("genotype") },
    gold: { category: term("genotype") },
    fv_pairs: [],
    direction: "gold_correct",
    concept_diff_kind: "wrong_subject",
  };
}

// ---------------------------------------------------------------------------
// Near-match findings — strength label dropped, judge moves to FV block
// ---------------------------------------------------------------------------

describe("near-match finding layout", () => {
  it("``_match_near`` finding is gated as near-match → strength label SUPPRESSED at factor-card level", () => {
    // GSE93824 shape: factor-level proposal is a good call
    // (genotype matches), but the gene URI species + missing
    // overexpression facet differ. AgentSuggestionPanel reads
    // ``isNearMatchFinding(finding)`` to decide whether to hide
    // the single-axis strength label. The label still gets
    // computed (leanSuggestionLabel returns a non-empty string),
    // but the panel skips rendering it.
    const f = makeFinding({
      issue_code: "calibration_factor_match_near",
      defender_verdict: makeVerdict(
        "Mouse APP gene URI on a human-transgene Arctic-AD model.",
        "strong",
      ),
    });
    expect(isNearMatchFinding(f)).toBe(true);
    // The label itself still computes — we're testing the
    // SUPPRESSION decision, not the label content.
    const lean = findingLean(f);
    expect(leanSuggestionLabel(lean, "strong")).not.toBe("");
  });

  it("rename-payload finding is also gated as near-match (concept-diff routing)", () => {
    const f = makeFinding({
      issue_code: "calibration_factor_rename",
      rename: makeRename(),
      defender_verdict: makeVerdict("Label drift — same concept."),
    });
    expect(isNearMatchFinding(f)).toBe(true);
  });

  it("threaded judge text resolves from defender_verdict.rationale (preferred source)", () => {
    // ``DisagreementBlock`` receives the result of
    // ``pickJudgeRowText`` as a prop; the parent computes it only
    // for near-match findings + only on the first block.
    const f = makeFinding({
      issue_code: "calibration_factor_match_near",
      defender_verdict: makeVerdict(
        "Mouse APP gene URI on a human-transgene Arctic-AD model.",
      ),
      proposer_defense: "ignored fallback",
    });
    expect(isNearMatchFinding(f)).toBe(true);
    const judge = pickJudgeRowText(
      f.defender_verdict?.rationale,
      f.proposer_defense,
    );
    expect(judge.isSentinel).toBe(false);
    expect(judge.text).toBe(
      "Mouse APP gene URI on a human-transgene Arctic-AD model.",
    );
  });

  it("threaded judge text falls back to proposer_defense when defender rationale empty", () => {
    const f = makeFinding({
      issue_code: "calibration_factor_match_near",
      defender_verdict: makeVerdict(""),
      proposer_defense: "Agent's defense: human transgene per Arctic mutation.",
    });
    const judge = pickJudgeRowText(
      f.defender_verdict?.rationale,
      f.proposer_defense,
    );
    expect(judge.isSentinel).toBe(false);
    expect(judge.text).toContain("human transgene");
  });

  it("threaded judge text shows sentinel when both sources empty (no UI gap, just a marker)", () => {
    const f = makeFinding({
      issue_code: "calibration_factor_match_near",
      defender_verdict: makeVerdict(""),
      proposer_defense: "",
    });
    const judge = pickJudgeRowText(
      f.defender_verdict?.rationale,
      f.proposer_defense,
    );
    expect(judge.isSentinel).toBe(true);
    expect(judge.text).toBe(AGENT_NO_DETAILS_SENTINEL);
  });
});

// ---------------------------------------------------------------------------
// Whole-factor findings — strength label STAYS (regression-prevent)
// ---------------------------------------------------------------------------

describe("whole-factor finding layout (regression-prevent)", () => {
  // These three issue codes are the asymmetric branch — they're
  // about full-factor decisions where the "STRONG / WEAK / NOT
  // SUGGESTED" framing matches the curator's mental model. The
  // tests pin that they DON'T get gated as near-match, so the
  // factor-card-level strength label keeps rendering.

  it("``_factor_extra`` keeps the strength label at the factor-card level", () => {
    const f = makeFinding({
      issue_code: "calibration_factor_extra",
      defender_verdict: makeVerdict("Gold has no such factor.", "strong"),
    });
    expect(isNearMatchFinding(f)).toBe(false);
    // The label is the one the AgentSuggestionPanel renders.
    const lean = findingLean(f);
    const label = leanSuggestionLabel(lean, "strong");
    // Non-empty + recognisable single-axis text.
    expect(label).toMatch(/SUGGESTION|NOT SUGGESTED|NO RECOMMENDATION/);
  });

  it("``_factor_gold_only_miss`` keeps the strength label", () => {
    const f = makeFinding({
      issue_code: "calibration_factor_gold_only_miss",
      defender_verdict: makeVerdict("Agent failed to spot this factor.", "moderate"),
    });
    expect(isNearMatchFinding(f)).toBe(false);
  });

  it("``_factor_partition_mismatch`` keeps the strength label", () => {
    const f = makeFinding({
      issue_code: "calibration_factor_partition_mismatch",
      defender_verdict: makeVerdict("Partition shape differs.", "weak"),
    });
    expect(isNearMatchFinding(f)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deriveLeftFactorCategory — baseline-side category lookup for rename findings
//
// Regression guard for the GSE67136 2026-06-15 case the reviewer reported:
// the agent proposes ``treatment`` factor, gold has ``timepoint``,
// matcher correctly emits a calibration_factor_match_near finding
// with a rename payload (gold.category = timepoint). The UI was
// looking up the baseline factor by the AGENT category ("treatment")
// → missed timepoint → rendered "(not in Live Gemma)" even though
// live Gemma clearly had timepoint. Fix: pick rename.gold.category
// for the baseline lookup, fall back to findingCategory otherwise.
// ---------------------------------------------------------------------------

import { deriveLeftFactorCategory } from "./ComparisonFactorCard";

describe("deriveLeftFactorCategory", () => {
  it("returns rename.gold.category when finding carries a rename payload (GSE67136 case)", () => {
    const finding = makeFinding({
      issue_code: "calibration_factor_match_near",
      rename: {
        agent: { category: term("treatment") },
        gold: { category: term("timepoint") },
        fv_pairs: [],
        direction: "gold_correct",
      },
    });
    const findingCat = { label: "treatment", uri: null };
    const result = deriveLeftFactorCategory(finding, findingCat);
    expect(result?.label).toBe("timepoint");
  });

  it("falls back to findingCategory when no rename payload", () => {
    const finding = makeFinding({
      issue_code: "calibration_factor_extra",
    });
    const findingCat = { label: "treatment", uri: null };
    const result = deriveLeftFactorCategory(finding, findingCat);
    expect(result?.label).toBe("treatment");
  });

  it("falls back to findingCategory when rename payload has empty gold category", () => {
    const finding = makeFinding({
      issue_code: "calibration_factor_match_near",
      rename: {
        agent: { category: term("treatment") },
        gold: { category: { label: "", uri: null, resolver: null, score: null } },
        fv_pairs: [],
        direction: "gold_correct",
      },
    });
    const findingCat = { label: "treatment", uri: null };
    const result = deriveLeftFactorCategory(finding, findingCat);
    expect(result?.label).toBe("treatment");
  });

  it("prefers rename.gold even when finding.rename.gold.category has only a URI", () => {
    const finding = makeFinding({
      issue_code: "calibration_factor_match_near",
      rename: {
        agent: { category: term("treatment") },
        gold: {
          category: {
            label: null as unknown as string,
            uri: "http://www.ebi.ac.uk/efo/EFO_0000724",
            resolver: null,
            score: null,
          },
        },
        fv_pairs: [],
        direction: "gold_correct",
      },
    });
    const findingCat = { label: "treatment", uri: null };
    const result = deriveLeftFactorCategory(finding, findingCat);
    expect(result?.uri).toBe("http://www.ebi.ac.uk/efo/EFO_0000724");
  });

  it("returns null when there is nothing to pick from", () => {
    const finding = makeFinding({
      issue_code: "calibration_factor_extra",
    });
    const result = deriveLeftFactorCategory(finding, null);
    expect(result).toBeNull();
  });
});
