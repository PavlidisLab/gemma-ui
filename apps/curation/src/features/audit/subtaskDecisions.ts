/**
 * Subtask-decision helpers shared between the audit report view and
 * sidebar panel. Lives outside ``AuditReportView.tsx`` so the
 * component module exports only React components — Vite Fast
 * Refresh can't hot-swap modules that mix components with
 * non-component exports, and re-shuffling utility code shouldn't
 * force a full page reload.
 */
import type { SubtaskDecision } from "@/api/types";

/** The ``(subtask, target_id)`` pairs that appear more than once in a
 *  subtask-analysis list, as ``"<subtask>||<target_id>"`` keys (empty
 *  when every pair is unique).
 *
 *  A curation-agent audit trail is expected to record each design-chain
 *  decision exactly ONCE per target: the shipped design's chain is the
 *  single source of truth. A duplicated ``(subtask, target_id)`` pair —
 *  e.g. twin ``S2u_uri_bind_validation`` "reject Heterozygous" rows for
 *  one binding — is a data defect from the producer (the boss re-run
 *  accumulating round-1 + re-run chains instead of replacing; fixed in
 *  agents ``db8d580``), NOT something the UI should paper over. The
 *  reasoning-trail panel groups decisions by target, so a duplicated
 *  pair renders the same verdict twice. This detector lets a test assert
 *  the invariant the panel relies on.
 *
 *  Note: this keys on ``(subtask, target_id)`` — a stricter invariant
 *  than ``dedupeSubtaskDecisions`` (which collapses only byte-identical
 *  ``(subtask, verdict)`` rows). Two rows with the SAME target but
 *  DIFFERENT verdict prose (exactly the boss re-run accumulation shape)
 *  survive the display dedup, so the panel would show both — hence the
 *  data must never contain them.
 */
export function duplicateSubtaskTargetPairs(
  decisions: SubtaskDecision[],
): string[] {
  const counts = new Map<string, number>();
  for (const d of decisions) {
    const key = `${d.subtask}||${d.target_id || ""}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n > 1)
    .map(([key]) => key);
}

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
 *  T372A``. Per design review 2026-06-19. Decisions whose verdict mixes
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
