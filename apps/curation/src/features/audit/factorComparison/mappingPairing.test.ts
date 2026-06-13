import { describe, expect, it } from "vitest";
import type {
  AlignmentMapping,
  AuditFinding,
  AuditReport,
} from "@/api/auditTypes";
import type { Factor } from "@/features/experiment/types";
import { factorPairForFinding, fvPairsViaMapping } from "./mappingPairing";

/**
 * Contract tests for the mapping-driven pair-derivation helpers.
 *
 * The helpers are the migration target for the legacy ``pairFvs``
 * biomaterial-Jaccard heuristic — once the wire carries the
 * structured ``audit_dict.mapping`` (bro's 2026-06-12 ship), the
 * pairing decision moves from "compute from biomaterial sets" to
 * "read from the mapping blob". These tests pin the shape:
 *
 *   - factorPairForFinding returns null when there's no mapping
 *     (legacy fallback path stays in charge).
 *   - factorPairForFinding returns null when the finding has no
 *     paired indices (extras / misses — caller renders standalone).
 *   - fvPairsViaMapping translates ``kind: "exact"`` → ``"same"``
 *     and ``kind: "near"`` → ``"drift"``.
 *   - Unpaired FVs on either side become ``left_only`` /
 *     ``right_only`` so the grid surfaces them.
 */

const mkFinding = (
  gold_target_index: number | null,
  agent_target_index: number | null,
): AuditFinding =>
  ({
    target_kind: "factor",
    target_id: "factor:test",
    severity: "minor",
    issue_code: "calibration_factor_match_near",
    rationale: "",
    citation: "",
    citation_url: "",
    suggested_fix: "",
    proposer_suggestion: "",
    gold_target_index,
    agent_target_index,
  }) as unknown as AuditFinding;

const mkFv = (
  id: number,
  label: string,
  bms: string[],
): Factor["factor_values"][number] =>
  ({
    id,
    free_text_label: label,
    is_baseline: false,
    biomaterial_short_names: bms,
    statements: [],
  }) as unknown as Factor["factor_values"][number];

const mkFactor = (
  id: number,
  fvs: Array<Factor["factor_values"][number]>,
): Factor =>
  ({
    id,
    name: "",
    category: { label: "treatment", uri: null },
    factor_values: fvs,
  }) as unknown as Factor;

const mkReportWithMapping = (mapping: AlignmentMapping | null): AuditReport =>
  ({
    audit_id: null,
    experiment_id: 1,
    experiment_short_name: "GSE-test",
    audited_at: "",
    model: null,
    scope: { include: [] },
    findings: [],
    evidence: {
      preboarding_excerpt: "",
      paper_source: null,
      paper_excerpt: "",
      comparison_proposal: null,
      mapping,
    },
    summary: {
      n_blocker: 0,
      n_major: 0,
      n_minor: 0,
      n_ok: 0,
      overall_verdict: "passes",
    },
    dispositions: [],
  }) as unknown as AuditReport;

const emptyMapping = (): AlignmentMapping => ({
  factor_pairs: [],
  fv_pairs: [],
  tag_pairs: [],
  unmatched_a_factors: [],
  unmatched_b_factors: [],
  unmatched_a_tags: [],
  unmatched_b_tags: [],
  factor_threshold: 0.5,
  tag_threshold: 0.5,
  exact_threshold: 0.95,
  partition_match_threshold: 0.8,
});

describe("factorPairForFinding", () => {
  it("returns null when the report has no mapping (legacy fallback path)", () => {
    const report = mkReportWithMapping(null);
    const finding = mkFinding(0, 0);
    expect(factorPairForFinding(report, finding)).toBeNull();
  });

  it("returns null when the finding lacks paired indices (extras / misses)", () => {
    const mapping = emptyMapping();
    mapping.factor_pairs = [
      {
        a_idx: 0,
        b_idx: 0,
        score: 1,
        kind: "exact",
        features: {
          score: 1,
          category_label: 1,
          fv_partition: 1,
          uri_overlap: 1,
        },
      },
    ];
    const report = mkReportWithMapping(mapping);
    expect(factorPairForFinding(report, mkFinding(null, 0))).toBeNull();
    expect(factorPairForFinding(report, mkFinding(0, null))).toBeNull();
  });

  it("finds the matching factor pair by (a_idx, b_idx)", () => {
    const mapping = emptyMapping();
    mapping.factor_pairs = [
      {
        a_idx: 0,
        b_idx: 1,
        score: 0.8,
        kind: "near",
        features: {
          score: 0.8,
          category_label: 0.9,
          fv_partition: 0.7,
          uri_overlap: 0.8,
        },
      },
    ];
    const report = mkReportWithMapping(mapping);
    const finding = mkFinding(0, 1);
    const pair = factorPairForFinding(report, finding);
    expect(pair).not.toBeNull();
    expect(pair?.kind).toBe("near");
    expect(pair?.score).toBe(0.8);
  });

  it("returns null when no factor pair matches the finding's indices", () => {
    const mapping = emptyMapping();
    mapping.factor_pairs = [
      {
        a_idx: 0,
        b_idx: 0,
        score: 1,
        kind: "exact",
        features: {
          score: 1,
          category_label: 1,
          fv_partition: 1,
          uri_overlap: 1,
        },
      },
    ];
    const report = mkReportWithMapping(mapping);
    expect(factorPairForFinding(report, mkFinding(1, 1))).toBeNull();
  });
});

describe("fvPairsViaMapping", () => {
  it("returns null when the report has no mapping", () => {
    const report = mkReportWithMapping(null);
    const factorPair = {
      a_idx: 0,
      b_idx: 0,
      score: 1,
      kind: "exact" as const,
      features: {
        score: 1,
        category_label: 1,
        fv_partition: 1,
        uri_overlap: 1,
      },
    };
    expect(
      fvPairsViaMapping(report, factorPair, mkFactor(0, []), mkFactor(1, [])),
    ).toBeNull();
  });

  it("translates kind=exact → 'same' and kind=near → 'drift'", () => {
    const mapping = emptyMapping();
    mapping.fv_pairs = [
      {
        factor_pair: [0, 0],
        a_fv_idx: 0,
        b_fv_idx: 0,
        score: 1,
        kind: "exact",
      },
      {
        factor_pair: [0, 0],
        a_fv_idx: 1,
        b_fv_idx: 1,
        score: 0.75,
        kind: "near",
      },
    ];
    const report = mkReportWithMapping(mapping);
    const factorPair = {
      a_idx: 0,
      b_idx: 0,
      score: 1,
      kind: "exact" as const,
      features: {
        score: 1,
        category_label: 1,
        fv_partition: 1,
        uri_overlap: 1,
      },
    };
    const left = mkFactor(0, [mkFv(1, "control", []), mkFv(2, "treated", [])]);
    const right = mkFactor(1, [
      mkFv(3, "control", []),
      mkFv(4, "treatment", []),
    ]);
    const pairs = fvPairsViaMapping(report, factorPair, left, right);
    expect(pairs).not.toBeNull();
    expect(pairs).toHaveLength(2);
    expect(pairs?.[0].status).toBe("same");
    expect(pairs?.[1].status).toBe("drift");
  });

  it("surfaces unpaired FVs as left_only / right_only stragglers", () => {
    const mapping = emptyMapping();
    mapping.fv_pairs = [
      {
        factor_pair: [0, 0],
        a_fv_idx: 0,
        b_fv_idx: 0,
        score: 1,
        kind: "exact",
      },
    ];
    const report = mkReportWithMapping(mapping);
    const factorPair = {
      a_idx: 0,
      b_idx: 0,
      score: 1,
      kind: "near" as const,
      features: {
        score: 0.8,
        category_label: 1,
        fv_partition: 0.6,
        uri_overlap: 0.7,
      },
    };
    const left = mkFactor(0, [
      mkFv(1, "shared", []),
      mkFv(2, "gold-only", []),
    ]);
    const right = mkFactor(1, [
      mkFv(3, "shared", []),
      mkFv(4, "agent-only", []),
    ]);
    const pairs = fvPairsViaMapping(report, factorPair, left, right);
    expect(pairs).toHaveLength(3);
    expect(pairs?.[0].status).toBe("same");
    expect(pairs?.[1].status).toBe("left_only");
    expect(pairs?.[1].left?.free_text_label).toBe("gold-only");
    expect(pairs?.[2].status).toBe("right_only");
    expect(pairs?.[2].right?.free_text_label).toBe("agent-only");
  });

  it("ignores fv_pairs whose factor_pair doesn't match the supplied pair", () => {
    const mapping = emptyMapping();
    mapping.fv_pairs = [
      // Wrong factor pair — should be skipped.
      {
        factor_pair: [9, 9],
        a_fv_idx: 0,
        b_fv_idx: 0,
        score: 1,
        kind: "exact",
      },
    ];
    const report = mkReportWithMapping(mapping);
    const factorPair = {
      a_idx: 0,
      b_idx: 0,
      score: 1,
      kind: "exact" as const,
      features: {
        score: 1,
        category_label: 1,
        fv_partition: 1,
        uri_overlap: 1,
      },
    };
    const left = mkFactor(0, [mkFv(1, "x", [])]);
    const right = mkFactor(1, [mkFv(2, "y", [])]);
    const pairs = fvPairsViaMapping(report, factorPair, left, right);
    // Both FVs surface as straggler-only rows since the mapping
    // didn't pair them under the right factor.
    expect(pairs).toHaveLength(2);
    expect(pairs?.[0].status).toBe("left_only");
    expect(pairs?.[1].status).toBe("right_only");
  });
});
