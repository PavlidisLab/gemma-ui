/**
 * Subtask-decision helpers shared between the audit report view and
 * sidebar panel. Lives outside ``AuditReportView.tsx`` so the
 * component module exports only React components — Vite Fast
 * Refresh can't hot-swap modules that mix components with
 * non-component exports, and re-shuffling utility code shouldn't
 * force a full page reload.
 */
import type { SubtaskDecision } from "@/api/types";

/** Collapse near-duplicate ``SubtaskDecision`` rows for the
 *  ReasoningTrail panel.
 *
 *  Two passes:
 *
 *  1. Exact-pair dedup keyed on ``(subtask, verdict)`` — covers the
 *     common "same subtask, same conclusion, multiple targets"
 *     shape where the per-target prose is byte-identical.
 *
 *  2. ``S2i_confounding_check`` "skip rule does NOT apply" rollup —
 *     one entry per factor pair, all near-identical modulo factor
 *     names + tiny crosstab numbers. With 3+ factors the panel
 *     blew up with N(N-1)/2 paragraphs that all say "nothing's
 *     wrong"; collapses to a single "K factor-pair confounding
 *     checks all clean" summary line.
 */
export function dedupeSubtaskDecisions(
  decisions: SubtaskDecision[],
): SubtaskDecision[] {
  const seen = new Set<string>();
  const dedupedExact = decisions.filter((d) => {
    const key = `${d.subtask}||${d.verdict}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const cleanS2i = dedupedExact.filter(
    (d) =>
      d.subtask === "S2i_confounding_check" &&
      /skip rule does not apply/i.test(d.verdict),
  );
  if (cleanS2i.length < 2) return dedupedExact;
  const summary: SubtaskDecision = {
    ...cleanS2i[0],
    verdict: `${cleanS2i.length} factor-pair confounding checks all clean — every pair is fully crossed; the S2i skip rule does not apply for any.`,
  };
  return dedupedExact
    .filter(
      (d) =>
        !(
          d.subtask === "S2i_confounding_check" &&
          /skip rule does not apply/i.test(d.verdict)
        ),
    )
    .concat([summary]);
}
