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
  if (cleanS2i.length < 2) return rollupFreeTextValidator(dedupedExact);
  const summary: SubtaskDecision = {
    ...cleanS2i[0],
    verdict: `${cleanS2i.length} factor-pair confounding checks all clean — every pair is fully crossed; the S2i skip rule does not apply for any.`,
  };
  return rollupFreeTextValidator(
    dedupedExact
      .filter(
        (d) =>
          !(
            d.subtask === "S2i_confounding_check" &&
            /skip rule does not apply/i.test(d.verdict)
          ),
      )
      .concat([summary]),
  );
}

/** S10 term-validator free-text rollup. The validator emits one note
 *  per unresolved object — ``object "T372E" is free-text — not in
 *  Gemma vocabulary`` — and they get ``·``-joined into a single verdict
 *  (or arrive as several decisions). The repetition adds no signal once
 *  a curator has read one; collapse to ``Left as free text: T372E,
 *  T372A``. Per Paul 2026-06-19. Decisions whose verdict mixes
 *  free-text notes with other prose are left untouched.
 */
const FREE_TEXT_SEGMENT =
  /^object\s+"([^"]+)"\s+is\s+free[-\s]?text\b.*?not in gemma vocabulary\.?$/i;

export function rollupFreeTextValidator(
  decisions: SubtaskDecision[],
): SubtaskDecision[] {
  const out: SubtaskDecision[] = [];
  const names: string[] = [];
  let carrier: SubtaskDecision | null = null;
  let summaryIndex = -1;
  for (const d of decisions) {
    const segments = (d.verdict || "")
      .split("·")
      .map((s) => s.trim())
      .filter(Boolean);
    const objects: string[] = [];
    const allFreeText =
      segments.length > 0 &&
      segments.every((seg) => {
        const m = seg.match(FREE_TEXT_SEGMENT);
        if (m) {
          objects.push(m[1]);
          return true;
        }
        return false;
      });
    if (allFreeText) {
      if (!carrier) {
        carrier = d;
        summaryIndex = out.length;
        out.push(d); // placeholder, overwritten below
      }
      for (const o of objects) if (!names.includes(o)) names.push(o);
    } else {
      out.push(d);
    }
  }
  if (names.length === 0 || !carrier) return decisions;
  out[summaryIndex] = {
    ...carrier,
    verdict: `Left as free text: ${names.join(", ")}`,
  };
  return out;
}
