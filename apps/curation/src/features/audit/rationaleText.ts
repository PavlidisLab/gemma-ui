/**
 * Rationale-text helpers shared between the sidebar's CompactFindingCard
 * body render and the editor's per-card surfaces. Extracted from
 * AuditSidebarPanel so the editor can reuse the same boilerplate
 * trimming + trail splitting without duplicating regexes.
 */

/** Strip the well-known boilerplate phrases agents append to every
 *  finding rationale:
 *
 *  1. "Accept if … dismiss if …" trailing clauses — the curator
 *     already has Accept/Dismiss buttons; the prose is redundant.
 *  2. "(see the supporting-evidence panel)" parentheticals and the
 *     "Agent emitted with the evidence quote on file" frame — both
 *     point at panels the curator can already see.
 *
 *  Returns the trimmed string. Leaves the substantive rationale text
 *  alone. */
export function trimRationaleBoilerplate(s: string | null | undefined): string {
  if (!s) return s ?? "";
  let out = s;
  out = out.replace(
    /\s*(?:^|\.\s+)Accept\s+(?:if|this)\b[^.]*?\bdismiss\s+if\b[^.]*?\.?\s*$/i,
    "",
  );
  out = out.replace(
    /\s*\(\s*see\s+the\s+supporting[- ]evidence\s+panel\.?\s*\)\s*\.?/gi,
    "",
  );
  out = out.replace(
    /\s*(?:^|\.\s+)Agent\s+emitted\s+with\s+the\s+evidence\s+quote\s+on\s+file\.?/i,
    "",
  );
  return out.trim();
}

/** Extract the first backticked token from a rationale string.
 *
 *  Agents emit the load-bearing label of a finding as the first
 *  backticked token in the rationale (e.g. "Remove factor
 *  `timepoint`?", "Should `cell type: microglial cell` be removed
 *  from the curation?"). The UI uses this label as a
 *  curator-friendly fallback wherever a structured target field
 *  isn't available.
 *
 *  Returns ``null`` when the rationale has no backticked token, or
 *  is null/undefined/empty. */
export function firstBacktick(
  rationale: string | null | undefined,
): string | null {
  if (!rationale) return null;
  const m = rationale.match(/`([^`]+)`/);
  return m ? m[1] : null;
}

/** Split a rationale into the headline summary and the optional
 *  "Agent reasoning trail" suffix. The agent emits the trail as a
 *  long-form chain-of-thought paragraph after a "— Agent reasoning
 *  trail —" delimiter. The UI shows the summary inline and tucks the
 *  trail behind a Reasoning ▸ popup so the card stays compact.
 *
 *  Returns ``trail = null`` when the delimiter doesn't appear. */
export function splitRationaleTrail(
  s: string,
): { summary: string; trail: string | null } {
  if (!s) return { summary: s, trail: null };
  const re = /\s*—\s*(?:Full\s+)?Agent\s+reasoning\s+trail\s*—\s*/i;
  const m = s.match(re);
  if (!m || m.index === undefined) return { summary: s, trail: null };
  const summary = s.slice(0, m.index).trim();
  const trail = s.slice(m.index + m[0].length).trim();
  return { summary, trail: trail || null };
}
