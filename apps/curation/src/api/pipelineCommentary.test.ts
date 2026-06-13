import { describe, expect, it } from "vitest";
import {
  findArbiterForFinding,
  findBossForFinding,
  parseFindingTargetForJudgeLookup,
  readCommentaryString,
  readEscalationRequests,
} from "./pipelineCommentary";
import type {
  ArbiterVerdict,
  AuditEvidence,
  AuditFinding,
  BossPassVerdict,
  EscalationRequest,
} from "./auditTypes";

/**
 * Contract tests for the dual-state adapter + judge-chain lookup.
 *
 * Dual-state rules:
 *   - Proposal-canonical wins when populated.
 *   - AuditEvidence mirror is the fallback.
 *   - Empty / null on both sides -> null result (slot suppresses).
 *
 * Judge lookup:
 *   - Tuple matches via permissive alphanumeric-only key (slug /
 *     underscore / dash / space drift collapses).
 *   - Side disambiguates when both sides supply one; empty side
 *     falls through (legacy packages without populated side still
 *     match).
 */

const evidenceShell = (overrides: Partial<AuditEvidence>): AuditEvidence =>
  ({
    preboarding_excerpt: "",
    paper_source: null,
    paper_excerpt: "",
    comparison_proposal: null,
    ...overrides,
  }) as AuditEvidence;

const mkFinding = (overrides: Partial<AuditFinding>): AuditFinding =>
  ({
    target_kind: "tag",
    target_id: "calibration:miss:developmental-stage/juvenile-stage",
    severity: "major",
    issue_code: "calibration_gold_only_miss",
    rationale: "",
    citation: "",
    citation_url: "",
    suggested_fix: "",
    proposer_suggestion: "",
    ...overrides,
  }) as AuditFinding;

describe("readCommentaryString — dual-state preference", () => {
  it("returns the proposal-canonical value when present", () => {
    const ev = evidenceShell({
      comparison_proposal: {
        experiment_summary: "proposal-side",
      } as never,
      experiment_summary: "mirror-side",
    } as Partial<AuditEvidence>);
    expect(readCommentaryString(ev, "experiment_summary")).toBe(
      "proposal-side",
    );
  });

  it("falls back to AuditEvidence mirror when proposal-side is empty", () => {
    const ev = evidenceShell({
      comparison_proposal: { experiment_summary: "" } as never,
      experiment_summary: "mirror-side",
    } as Partial<AuditEvidence>);
    expect(readCommentaryString(ev, "experiment_summary")).toBe("mirror-side");
  });

  it("returns null when both sides are empty / missing", () => {
    expect(readCommentaryString(evidenceShell({}), "experiment_summary")).toBe(
      null,
    );
    expect(readCommentaryString(null, "experiment_summary")).toBe(null);
    expect(readCommentaryString(undefined, "experiment_summary")).toBe(null);
  });

  it("treats whitespace-only strings as empty", () => {
    const ev = evidenceShell({
      experiment_summary: "   \n  ",
    } as Partial<AuditEvidence>);
    expect(readCommentaryString(ev, "experiment_summary")).toBe(null);
  });
});

describe("readEscalationRequests — dual-state preference", () => {
  const esc = (kind: string): EscalationRequest => ({
    kind,
    rationale: "",
    suggested_action: "",
    blocks_correction: false,
    aggregation_key: "",
  });

  it("returns the proposal-canonical list when populated", () => {
    const ev = evidenceShell({
      comparison_proposal: {
        escalation_requests: [esc("fetch_paper")],
      } as never,
      escalation_requests: [esc("ontology_fix")],
    });
    expect(readEscalationRequests(ev).map((e) => e.kind)).toEqual([
      "fetch_paper",
    ]);
  });

  it("falls back to mirror when proposal-side is empty", () => {
    const ev = evidenceShell({
      comparison_proposal: { escalation_requests: [] } as never,
      escalation_requests: [esc("ontology_fix")],
    });
    expect(readEscalationRequests(ev).map((e) => e.kind)).toEqual([
      "ontology_fix",
    ]);
  });

  it("returns [] when both sides are empty / missing", () => {
    expect(readEscalationRequests(evidenceShell({}))).toEqual([]);
    expect(readEscalationRequests(null)).toEqual([]);
  });
});

describe("parseFindingTargetForJudgeLookup", () => {
  it("parses calibration:<status>:<cat>/<val> as a tag tuple", () => {
    const f = mkFinding({
      target_id: "calibration:miss:developmental-stage/juvenile-stage",
      target_kind: "tag",
      issue_code: "calibration_gold_only_miss",
    });
    expect(parseFindingTargetForJudgeLookup(f)).toEqual({
      target_kind: "tag",
      target_category: "developmental-stage",
      target_value: "juvenile-stage",
      side: "agent_missed_gold",
    });
  });

  it("parses calibration:<status>:<cat> (no slash) as a factor tuple", () => {
    const f = mkFinding({
      target_id: "calibration:factor_extra:treatment",
      target_kind: "factor",
      issue_code: "calibration_factor_extra",
    });
    expect(parseFindingTargetForJudgeLookup(f)).toEqual({
      target_kind: "factor",
      target_category: "treatment",
      target_value: "",
      side: "agent_extra",
    });
  });

  it("parses tag:<cat-slug>/<val-slug> from the entity-frame proposer", () => {
    const f = mkFinding({
      target_id: "tag:disease/alzheimer-disease",
      target_kind: "tag",
      issue_code: "calibration_agent_extra",
    });
    expect(parseFindingTargetForJudgeLookup(f)).toEqual({
      target_kind: "tag",
      target_category: "disease",
      target_value: "alzheimer-disease",
      side: "agent_extra",
    });
  });

  it("parses factor:<slug>", () => {
    const f = mkFinding({
      target_id: "factor:genotype",
      target_kind: "factor",
      issue_code: "calibration_factor_match_exact",
    });
    expect(parseFindingTargetForJudgeLookup(f)).toEqual({
      target_kind: "factor",
      target_category: "genotype",
      target_value: "",
      side: "", // no clean extra / missed_gold mapping; side falls through to verdict-level
    });
  });

  it("returns null for unrecognised target_id shapes", () => {
    expect(
      parseFindingTargetForJudgeLookup(
        mkFinding({ target_id: "weird-shape" }),
      ),
    ).toBe(null);
  });
});

describe("findArbiterForFinding", () => {
  const mkArbiter = (
    overrides: Partial<ArbiterVerdict>,
  ): ArbiterVerdict => ({
    gse: "GSE-test",
    target_kind: "tag",
    side: "agent_missed_gold",
    target_category: "developmental stage",
    target_value: "juvenile stage",
    target_uri: "",
    verdict: "agent_correct_per_rule",
    mode: "rule",
    citation: "",
    rationale: "Agent's removal is correct.",
    confidence: "high",
    ...overrides,
  });

  it("returns null when the report has no arbiter_verdicts", () => {
    const ev = evidenceShell({});
    expect(findArbiterForFinding({ evidence: ev } as never, mkFinding({}))).toBe(
      null,
    );
  });

  it("matches by target tuple via permissive key (dash vs space)", () => {
    const arbiter = mkArbiter({});
    const ev = evidenceShell({ arbiter_verdicts: [arbiter] });
    const f = mkFinding({
      target_id: "calibration:miss:developmental-stage/juvenile-stage",
    });
    expect(
      findArbiterForFinding({ evidence: ev } as never, f)?.verdict,
    ).toBe("agent_correct_per_rule");
  });

  it("returns null when no row matches the target", () => {
    const arbiter = mkArbiter({});
    const ev = evidenceShell({ arbiter_verdicts: [arbiter] });
    const f = mkFinding({
      target_id: "calibration:miss:different-category/different-value",
    });
    expect(findArbiterForFinding({ evidence: ev } as never, f)).toBe(null);
  });

  it("disambiguates by side when both sides supply one", () => {
    const a = mkArbiter({ side: "agent_extra" });
    const b = mkArbiter({ side: "agent_missed_gold" });
    const ev = evidenceShell({ arbiter_verdicts: [a, b] });
    const missedFinding = mkFinding({
      issue_code: "calibration_gold_only_miss",
    });
    expect(
      findArbiterForFinding({ evidence: ev } as never, missedFinding)?.side,
    ).toBe("agent_missed_gold");
  });

  it("falls through when one side has an empty side string", () => {
    // Legacy package — arbiter row carries no side; lookup should
    // still match the only candidate.
    const a = mkArbiter({ side: "" });
    const ev = evidenceShell({ arbiter_verdicts: [a] });
    expect(
      findArbiterForFinding({ evidence: ev } as never, mkFinding({})),
    ).not.toBe(null);
  });
});

describe("findBossForFinding", () => {
  const mkBoss = (overrides: Partial<BossPassVerdict>): BossPassVerdict => ({
    gse: "GSE-test",
    target_kind: "tag",
    side: "agent_missed_gold",
    target_category: "developmental stage",
    target_value: "juvenile stage",
    target_uri: "",
    verdict: "agent_correct_per_judgment",
    mode: "judgment",
    citation: "",
    arbiter_rationale: "Arbiter said X.",
    rationale: "Boss agrees with arbiter; this is a clean miss.",
    confidence: "medium",
    ...overrides,
  });

  it("returns null when the report has no boss_verdicts", () => {
    expect(
      findBossForFinding(
        { evidence: evidenceShell({}) } as never,
        mkFinding({}),
      ),
    ).toBe(null);
  });

  it("matches via the same targeting tuple as arbiter", () => {
    const ev = evidenceShell({ boss_verdicts: [mkBoss({})] });
    expect(
      findBossForFinding({ evidence: ev } as never, mkFinding({}))?.verdict,
    ).toBe("agent_correct_per_judgment");
  });
});
