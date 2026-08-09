/**
 * Defender-verdict → curator-action-lean mapping.
 *
 * Each defender / arbiter verdict carries an implicit *direction*:
 * does the judge think the agent's emission is correct, or does the
 * judge think the curator should keep what's already there (gold)?
 * Until this module, the audit UI assumed every "SUGGESTION" panel
 * pointed pro-agent — the curator was nudged toward `adopt
 * Auditor's` even when the judge had concluded "agent is wrong, gold
 * is right".
 *
 * Canonical bug case (2026-05-21, GSE93824, hardcase10-r6):
 * Arctic AD mouse model. Agent emitted `App NCBI:11820` (mouse
 * gene); reference is `APP NCBI:351` (human transgene). The judge
 * ran the transgene-species rule, returned `concept_gold_right`
 * (verdict says "agent is wrong"), but the UI still showed
 * "STRONG SUGGESTION" with `adopt Auditor's` highlighted — pointing
 * the curator at the wrong answer.
 *
 * The lean mapping below mirrors the producer-side source of truth
 * in `gemma-curation-agents/scripts/build_calibration_batch.py`
 * (`_LEGACY_LEANS`, `_ARBITER_LEANS`). When that file grows new
 * verdict labels, mirror them here.
 *
 * Three signals feed into the lean:
 *
 *   1. `defender_verdict.verdict` — the direct verdict label (most
 *      authoritative; future investigator verdicts surface here too)
 *   2. `proposer_flags` including `judge_agrees_agent` — producer-
 *      side flag set when at least one judge leans pro_agent AND no
 *      judge leans pro_gold (commits 052756a + 95baddc). When this
 *      flag is set but the verdict label is missing or unrecognised,
 *      treat as pro_agent.
 *   3. Strength (`weak`/`moderate`/`strong`) drives label TEXT, not
 *      direction.
 *
 * The lean tells the editor which button to mark as PRIMARY
 * (highlighted, default action) vs SECONDARY (still available, just
 * not the recommended one). It does NOT change wire shape — the
 * curator can still click either button.
 */

import type { AuditFinding } from "@/api/auditTypes";

/** Which side the judge leans toward. */
export type DefenderLean = "pro_agent" | "pro_gold" | "neutral";

/** Verdict → lean mapping. Mirrors
 *  `scripts/build_calibration_batch.py::_LEGACY_LEANS` +
 *  `_ARBITER_LEANS`. Unknown labels collapse to `"neutral"` — the UI
 *  then falls through to the "no recommendation" rendering. */
const VERDICT_LEANS: Record<string, DefenderLean> = {
  // ----- Tag-side defender (original six) -----
  extra_genuine_new: "pro_agent",
  extra_unsupported: "pro_gold",
  extra_borderline: "neutral",
  agent_correct_inherited: "pro_agent",
  agent_correct_overzealous_gold: "pro_agent",
  agent_miss_genuine: "pro_gold",
  extra_inherited_redundant: "pro_gold",

  // ----- Factor-side defender -----
  // (extra_genuine_new / extra_unsupported shared with tag side above)
  extra_confounded: "pro_gold",
  miss_genuine: "pro_gold",
  miss_inherited_from_design: "pro_agent",
  miss_overzealous_gold: "pro_agent",
  miss_borderline: "neutral",

  // ----- FV concept-diff defender (2026-05-21) -----
  // Same-category, same-partition FV-subject disagreement (the
  // GSE93824 case). The verdict names which side is biologically
  // correct; the lean follows directly.
  concept_agent_right: "pro_agent",
  concept_gold_right: "pro_gold",
  concept_equivalent: "neutral",
  concept_both_wrong: "pro_gold",
  concept_borderline: "neutral",

  // ----- Arbiter verdicts -----
  agent_correct_per_rule: "pro_agent",
  gold_correct_per_rule: "pro_gold",
  equivalent_per_rule: "neutral",
  equivalent_by_judgment: "neutral",
  judgment_genuine_miss: "pro_gold",
  judgment_unclear: "neutral",
  guideline_omission: "neutral",
  cannot_judge: "neutral",
};

/** Map a single verdict string to a lean direction. Returns
 *  `"neutral"` for unknown / missing verdicts. */
export function verdictLean(
  verdict: string | null | undefined,
): DefenderLean {
  if (!verdict) return "neutral";
  return VERDICT_LEANS[verdict] ?? "neutral";
}

/** Compute the lean for a finding from its defender_verdict +
 *  proposer_flags.
 *
 *  Precedence:
 *    1. If `defender_verdict.verdict` maps to pro_agent / pro_gold,
 *       use it.
 *    2. Otherwise, if `proposer_flags` includes `judge_agrees_agent`,
 *       lean pro_agent. The flag is the producer's distilled
 *       any-judge-agrees-and-none-disagrees signal — useful when
 *       the verdict label is unrecognised (future investigator
 *       verdicts) but the flag is still set.
 *    3. Otherwise neutral.
 *
 *  Returns `"neutral"` when no defender_verdict is attached AND no
 *  judge_agrees_agent flag is set. The caller renders the "no
 *  recommendation" state in that case (both buttons equally
 *  weighted).
 */
export function findingLean(finding: AuditFinding): DefenderLean {
  const dv = finding.defender_verdict ?? null;
  const verdictBased = verdictLean(dv?.verdict);
  if (verdictBased !== "neutral") return verdictBased;
  const flags = finding.proposer_flags ?? [];
  if (flags.includes("judge_agrees_agent")) return "pro_agent";
  return "neutral";
}

/** Strength bucket used by the single-axis label mapping. */
export type LeanStrength = "weak" | "moderate" | "strong" | null | undefined;

/** Curator-facing label for the SUGGESTION-header in
 *  `AgentSuggestionPanel`.
 *
 *  Single-axis framing (design review 2026-05-21): the label always describes
 *  the *strength of the suggestion to change*. Keep / change are
 *  inverse senses of one axis, not two separate dimensions; the prior
 *  "STRONG SUGGESTION" vs "STRONG: keep current" two-axis text made
 *  "strong-to-keep = weak-to-change" intuitive but read as confusing
 *  on the card. The new mapping always frames the proposed change
 *  action:
 *
 *  | lean      | strength | label                |
 *  |-----------|----------|----------------------|
 *  | pro_agent | strong   | STRONG SUGGESTION    |
 *  | pro_agent | moderate | MODERATE SUGGESTION  |
 *  | pro_agent | weak     | WEAK SUGGESTION      |
 *  | pro_gold  | weak     | WEAK SUGGESTION      |
 *  | pro_gold  | moderate | WEAK SUGGESTION      |
 *  | pro_gold  | strong   | NOT SUGGESTED        |
 *  | neutral   | any      | NO RECOMMENDATION    |
 *  | any       | null     | suggestion           |
 *
 *  Severity-strip colour (amber/emerald) still tracks raw strength —
 *  only the label TEXT changes here. Lower-case `"suggestion"` is the
 *  unchanged fallback when no strength is attached. */
export function leanSuggestionLabel(
  lean: DefenderLean,
  strength: LeanStrength,
): string {
  if (!strength) return "suggestion";
  if (lean === "pro_agent") {
    if (strength === "strong") return "STRONG SUGGESTION";
    if (strength === "moderate") return "MODERATE SUGGESTION";
    return "WEAK SUGGESTION";
  }
  if (lean === "pro_gold") {
    if (strength === "strong") return "NOT SUGGESTED";
    // pro_gold + moderate collapses with pro_gold + weak: the change
    // is weakly motivated. (Differentiating "MODERATE AGAINST" was
    // considered but rejected as still implying a second axis.)
    return "WEAK SUGGESTION";
  }
  // neutral — judge graded the finding but didn't pick a side.
  return "NO RECOMMENDATION";
}
