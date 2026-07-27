import type { AuditFinding } from "@/api/auditTypes";

/**
 * Decide whether to render the muted "no paper excerpt emitted —
 * judge rationale above is un-grounded" caption beneath the Judge
 * row in ``AgentDetailsPanel``.
 *
 * The contract — exactly three states, per the agents-side
 * ``HANDOFF_2026-06-12_AGENT_PARAPHRASE_FALLBACK_AND_ATTRIBUTION_INVARIANT.md``:
 *
 * | supporting_evidence | paper_excerpts_unavailable | render          |
 * |---------------------|----------------------------|-----------------|
 * | populated           | (any)                      | blockquotes     |
 * | `[]`                | `true`                     | muted caption   |
 * | `[]`                | `false` / absent           | nothing         |
 *
 * The caption answers "why is the evidence box empty?" — when
 * ``paper_excerpts_unavailable`` is true the judge ran but couldn't
 * anchor anything; when it's false there was simply no rationale to
 * ground (structural-only findings like
 * ``calibration_factor_gold_only_miss``).
 *
 * Extracted from ``AgentDetailsPanel`` so the decision is unit-
 * testable in isolation (the panel itself depends on the React tree
 * which is out of scope for vitest without @testing-library/react).
 */
export type FindingEvidenceRender = "blockquotes" | "muted_caption" | "nothing";

export function findingEvidenceRender(
  finding: Pick<AuditFinding, "supporting_evidence" | "paper_excerpts_unavailable">,
): FindingEvidenceRender {
  const evidence = finding.supporting_evidence ?? [];
  if (evidence.length > 0) return "blockquotes";
  if (finding.paper_excerpts_unavailable) return "muted_caption";
  return "nothing";
}
