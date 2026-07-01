/**
 * Mapping-driven pair-derivation helpers.
 *
 * When the audit report carries an ``audit_dict.mapping`` (the
 * structured graph-alignment Mapping shipped by bro 2026-06-12 per
 * ``UIB_HANDOFF_2026_06_12_ANNOTATION_SET_AND_ALIGNMENT_RENDER.md``),
 * the UI prefers the wire's pairing over the legacy biomaterial-
 * Jaccard heuristic in ``pairFvs``. Same output shape, more
 * authoritative source.
 *
 * Convention used here — A = baseline / gold (polished curator
 * side, left column), B = comparator / agent (proposed side, right
 * column). The bro handoff says "indices reference existing
 * ``comparisonProposal.factors[i]`` / ``.tags[i]`` shapes" for B,
 * and the gold side carries the parallel index space (the same
 * convention as ``finding.gold_target_index`` / ``finding.agent_
 * target_index``). If the wire flips the convention down the road,
 * the one-place flip lives in ``factorPairForFinding`` —
 * ``ComparisonFactorCard``'s call site doesn't have to know.
 *
 * Posture — when the report doesn't carry ``mapping``, every helper
 * returns ``null`` so the caller falls through to the legacy
 * ``pairFvs`` heuristic. Additive migration, no rip-out.
 */
import type {
  AlignmentFactorPair,
  AlignmentFvPair,
  AuditFinding,
  AuditReport,
} from "@/api/auditTypes";
import type { Factor } from "@/features/experiment/types";
import type { FactorProposal } from "@/api/types";
import type { FactorComparisonPair } from "./FactorComparisonGrid";

/** Find the ``AlignmentFactorPair`` in the report's mapping that a
 *  given finding refers to. Two paths:
 *
 *   1. When the finding has both ``gold_target_index`` (a_idx) and
 *      ``agent_target_index`` (b_idx) populated, look for the exact
 *      (a_idx, b_idx) pair in ``mapping.factor_pairs``.
 *   2. When only one side has an index (extras / misses), the pair
 *      doesn't exist — caller renders the unmatched side standalone.
 *
 *  Returns ``null`` when the report has no mapping, or no factor
 *  pair matches the finding's indices. */
export function factorPairForFinding(
  report: AuditReport | null | undefined,
  finding: AuditFinding,
): AlignmentFactorPair | null {
  const mapping = report?.evidence?.mapping ?? null;
  if (!mapping) return null;
  const aIdx = finding.gold_target_index;
  const bIdx = finding.agent_target_index;
  if (aIdx == null || bIdx == null) return null;
  for (const pair of mapping.factor_pairs) {
    if (pair.a_idx === aIdx && pair.b_idx === bIdx) return pair;
  }
  return null;
}

/** Compute the per-FV ``FactorComparisonPair[]`` rows for a given
 *  factor pair, driven by the report's ``mapping.fv_pairs``. Returns
 *  the same shape the grid consumes from legacy ``pairFvs``.
 *
 *  Status mapping from alignment kind:
 *    - ``"exact"`` → ``"same"``  (labels match)
 *    - ``"near"``  → ``"drift"`` (paired by partition; labels differ)
 *
 *  Unmatched FVs on either side fill out as ``left_only`` /
 *  ``right_only`` rows so the grid still surfaces them. Returns
 *  ``null`` when the report has no mapping (caller falls through to
 *  legacy ``pairFvs``).
 *
 *  ID-first gold resolution: when an fv_pair carries the gold
 *  ``FactorValue``'s stable Gemma id (``b_fv_id``), resolve the
 *  gold/left FV by matching ``factor_value.id === b_fv_id`` instead of
 *  trusting the positional ``a_fv_idx`` — the id survives FV
 *  reordering between the audit-time snapshot and the live design the
 *  card renders against. Falls back to the positional index when no id
 *  is present (older packages) or the id isn't found. */
export function fvPairsViaMapping(
  report: AuditReport | null | undefined,
  factorPair: AlignmentFactorPair,
  leftFactor: Factor | FactorProposal | null,
  rightFactor: Factor | FactorProposal | null,
): FactorComparisonPair[] | null {
  const mapping = report?.evidence?.mapping ?? null;
  if (!mapping) return null;
  const leftFvs = leftFactor?.factor_values ?? [];
  const rightFvs = rightFactor?.factor_values ?? [];
  const relevant: AlignmentFvPair[] = mapping.fv_pairs.filter(
    (p) =>
      p.factor_pair[0] === factorPair.a_idx &&
      p.factor_pair[1] === factorPair.b_idx,
  );
  const pairs: FactorComparisonPair[] = [];
  const claimedLeft = new Set<number>();
  const claimedRight = new Set<number>();
  for (const fv of relevant) {
    // Gold/left FV: prefer the stable-id join off ``b_fv_id`` (survives
    // reordering); fall back to the positional ``a_fv_idx``.
    let leftIdx = fv.a_fv_idx;
    if (fv.b_fv_id != null) {
      const byId = leftFvs.findIndex(
        (g) => g != null && (g as { id?: number }).id === fv.b_fv_id,
      );
      if (byId >= 0) leftIdx = byId;
    }
    const left = leftFvs[leftIdx] ?? null;
    const right = rightFvs[fv.b_fv_idx] ?? null;
    if (left) claimedLeft.add(leftIdx);
    if (right) claimedRight.add(fv.b_fv_idx);
    pairs.push({
      left,
      right,
      status: fv.kind === "exact" ? "same" : "drift",
    });
  }
  // Stragglers — FVs on either side the mapping didn't pair render
  // as left_only / right_only so the grid surfaces them. Mirrors
  // legacy pairFvs' final-pass shape so a viewer can't tell which
  // pairing path produced the output.
  for (let i = 0; i < leftFvs.length; i++) {
    if (!claimedLeft.has(i)) {
      pairs.push({ left: leftFvs[i], right: null, status: "left_only" });
    }
  }
  for (let i = 0; i < rightFvs.length; i++) {
    if (!claimedRight.has(i)) {
      pairs.push({ left: null, right: rightFvs[i], status: "right_only" });
    }
  }
  return pairs;
}
