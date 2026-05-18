/**
 * Helpers for rendering ``calibration_factor_match_*`` findings.
 *
 * Two responsibilities:
 *
 *   1. Classify the three issue codes a builder may emit for a
 *      gold ↔ agent factor pairing:
 *        - ``calibration_factor_match_exact``  (severity ok)
 *        - ``calibration_factor_match_close``  (severity minor)
 *        - ``calibration_factor_match``        (legacy, pre-2026-05-18
 *          builds — treat conservatively as ``_close``)
 *      ``calibration_factor_rename`` is its own code and handled by
 *      the rename-specific path in ``AuditSidebarPanel``; this module
 *      only covers the match codes.
 *
 *   2. Look up the agent ``FactorProposal`` the builder committed to
 *      for a given gold-side match finding. Uses ``agent_target_index``
 *      (calibration package v12+) when present, with a label-based
 *      fallback for older audits that pre-date the field.
 *
 * Sibling code in ``AuditSidebarPanel.tsx`` and ``AuditReportView.tsx``
 * imports from here so the classification stays in one place — adding
 * a new code, or changing the fallback policy, is a one-file edit.
 *
 * Wire contract: agents-repo commit ``f313770``,
 * eval-repo ``docs/HANDOFF_2026-05-18_UI_FACTOR_MATCH_PAIRING.md``.
 */
import type { AuditFinding } from "@/api/auditTypes";
import type { FactorProposal, Proposal } from "@/api/types";

/** Match-code variant. ``legacy`` is the pre-split
 *  ``calibration_factor_match`` code that older builds still emit. */
export type FactorMatchVariant = "exact" | "close" | "legacy";

/** Classify a finding's ``issue_code`` against the factor-match codes.
 *  Returns ``null`` for anything else (including the rename code,
 *  which has its own rendering path). */
export function factorMatchVariant(
  issue_code: string | null | undefined,
): FactorMatchVariant | null {
  if (!issue_code) return null;
  if (issue_code === "calibration_factor_match_exact") return "exact";
  if (issue_code === "calibration_factor_match_close") return "close";
  if (issue_code === "calibration_factor_match") return "legacy";
  return null;
}

/** Any factor-match issue code (exact / close / legacy). Convenience
 *  predicate used by call sites that need to differentiate
 *  factor-match findings from extras / misses / renames. */
export function isFactorMatchCode(
  issue_code: string | null | undefined,
): boolean {
  return factorMatchVariant(issue_code) !== null;
}

/** Whether the finding should render with the green-check "exact"
 *  affordance (no curator action needed; severity ok). The split
 *  landed 2026-05-18: only ``_exact`` is truly skippable; ``_close``
 *  and the legacy code carry minor severity ("peek to confirm"). */
export function isExactFactorMatch(f: AuditFinding): boolean {
  return f.issue_code === "calibration_factor_match_exact";
}

/** Whether the finding is a "close — peek to confirm" match. Covers
 *  both the new ``_close`` code and the legacy ``calibration_factor_
 *  match`` code (the conservative default per the 2026-05-18 handoff:
 *  older builds didn't distinguish exact from close, so treating the
 *  legacy code as ``_close`` errs on the side of curator attention).
 *
 *  Excludes the rename case (legacy code with non-ok severity is a
 *  rename, not a close match — see ``isRenameMatch`` in
 *  ``AuditSidebarPanel.tsx``). */
export function isCloseFactorMatch(f: AuditFinding): boolean {
  if (f.issue_code === "calibration_factor_match_close") return true;
  if (f.issue_code === "calibration_factor_match" && f.severity === "ok") {
    // Legacy ok-severity match: treat as close (peek to confirm).
    return true;
  }
  return false;
}

/** Resolve the agent ``FactorProposal`` the builder paired with this
 *  gold match finding.
 *
 *  Priority order:
 *
 *   1. ``finding.agent_target_index`` — direct index into
 *      ``comparison_proposal.factors``. Calibration package v12+
 *      (agents-repo ``f313770``). The builder guarantees a one-to-one
 *      agent → gold pairing here so the same agent factor never
 *      surfaces on two cards.
 *
 *   2. Label-based lookup — older audits pre-date
 *      ``agent_target_index``. Falls back to finding the agent factor
 *      whose ``category.label`` matches ``labelFallback`` (typically
 *      pulled from the rename payload, the parsed rationale, or the
 *      first backticked token in the rationale). Multi-factor-same-
 *      category designs can collide here (the bug
 *      ``agent_target_index`` was introduced to fix) but the fallback
 *      keeps behaviour stable for pre-v12 audit.json files.
 *
 *  Returns ``null`` when neither path produces a hit (no comparison
 *  proposal, out-of-range index, or no label match). */
export function resolveAgentFactor(
  finding: Pick<AuditFinding, "agent_target_index">,
  comparisonProposal: Proposal | null | undefined,
  labelFallback: string | null | undefined,
): FactorProposal | null {
  const factors = comparisonProposal?.factors ?? null;
  if (!factors || factors.length === 0) return null;

  const idx = finding.agent_target_index;
  if (typeof idx === "number" && Number.isInteger(idx)) {
    if (idx >= 0 && idx < factors.length) {
      return factors[idx] ?? null;
    }
    // Out-of-range index — the wire is malformed. Don't fall back
    // silently to a different factor; surface as "no embed" so the
    // mismatch is visible rather than displaying the wrong factor.
    return null;
  }

  // Pre-v12 audit: use the caller's label hint.
  const label = (labelFallback || "").toLowerCase().trim();
  if (!label) return null;
  return (
    factors.find(
      (f) => (f.category.label || "").toLowerCase().trim() === label,
    ) ?? null
  );
}
