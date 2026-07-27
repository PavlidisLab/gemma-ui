/**
 * Pure helpers for the Auditor Details panel render rules.
 *
 * Curator feedback (the reviewer, 2026-05-21):
 *
 *   1. "Too long & redundant" — for findings whose headline already
 *      shows the action ("Add factor — timepoint: 6 months post-ICU
 *      discharge") AND whose FV list is rendered as chips above
 *      (RenameFactorEmbed / GoldFactorMissEmbed / editor comparator
 *      chips), the details panel was restating both: a
 *      ``rationale`` line that said "Add factor `timepoint` to the
 *      design.", a ``suggested_fix`` line that said the same thing
 *      in different prose, and a ``proposer_suggestion`` line that
 *      flattened the FV list ("timepoint: [a, b]"). The signal
 *      ("WHY this factor?") was buried below.
 *
 *   2. "Too brief / no signal" — for findings whose details panel
 *      was reduced to just an action one-liner (e.g. "Remove factor
 *      `age` from the design."), the curator had no WHY to act on.
 *      We couldn't tell from this view whether the agent emitted
 *      no details or whether the renderer dropped them.
 *
 * Producer-side companion (gemma-curation-agents commit 6451c39):
 * empty ``proposer_suggestion`` and ``proposer_defense`` now ship
 * the literal ``"[agent emitted no details]"`` so the UI can
 * distinguish "no agent reasoning available" from "renderer dropped
 * it". The sentinel is rendered explicitly here so the reviewer gets the
 * visual signal.
 *
 * All helpers are pure so they can be tested without a DOM. Wiring
 * lives in AuditSidebarPanel.tsx (AgentSuggestionPanel + the
 * agent-details body of CompactFindingCard).
 */

/** Sentinel string the producer side stamps onto empty
 *  ``proposer_suggestion`` / ``proposer_defense`` fields so the UI
 *  can render an explicit "no details" affordance. Kept as a
 *  constant so future producer-side wording changes are a one-line
 *  edit. */
export const AGENT_NO_DETAILS_SENTINEL = "[agent emitted no details]";

/** True when a rationale string is just restating the action that's
 *  already shown by the header chip. The agent emits these as
 *  imperative one-liners ("Add factor `treatment` to the design.",
 *  "Remove tag `cell type: neuron`.", "Swap factor `genotype` for
 *  `treatment`.", etc.). Case-insensitive prefix match — we don't
 *  try to be clever about the rest of the sentence; if it leads
 *  with one of the known action verbs, the header carries the
 *  payload.
 *
 *  Kept conservative so substantive rationales that happen to start
 *  with a phrase like "Add evidence for..." still pass through
 *  (the verb must be followed by ``factor`` / ``tag``). */
export function isActionPrefixRationale(
  text: string | null | undefined,
): boolean {
  if (!text) return false;
  const s = text.trim().toLowerCase();
  if (!s) return false;
  // "Add factor X", "Remove factor X", "Add tag X", "Remove tag X",
  // "Swap X for Y", "Rename X to Y", "Keep factor X".
  return (
    /^add\s+(?:factor|tag)\b/.test(s) ||
    /^remove\s+(?:factor|tag)\b/.test(s) ||
    /^swap\s+/.test(s) ||
    /^rename\s+/.test(s) ||
    /^keep\s+(?:factor|tag)\b/.test(s)
  );
}

/** Trim + lowercase for the duplicate-text equality checks below.
 *  Strips trailing punctuation so "Add factor X." and "Add factor X"
 *  collapse to the same key. */
function normaliseForEquality(s: string | null | undefined): string {
  if (!s) return "";
  return s.trim().replace(/[.!?\s]+$/u, "").toLowerCase();
}

/** True when ``suggested_fix`` is a verbatim restatement of either
 *  the rationale or the header-action text. The header chip already
 *  spells out the action (see ``findingActionLabel`` +
 *  ``findingSubjectLabel`` in AuditSidebarPanel.tsx) so showing
 *  ``suggested_fix`` again is pure duplication. */
export function isSuggestedFixRedundant(
  suggestedFix: string | null | undefined,
  headerAction: string | null | undefined,
  rationale: string | null | undefined,
): boolean {
  const fix = normaliseForEquality(suggestedFix);
  if (!fix) return true; // empty → nothing to render anyway
  if (fix === normaliseForEquality(headerAction)) return true;
  if (fix === normaliseForEquality(rationale)) return true;
  return false;
}

/** Parsed ``proposer_suggestion`` of the form ``"<cat>: <values>"``
 *  or ``"<cat>: [v1, v2]"``. Used to suppress the suggestion line
 *  when the FV chips above already render the same content. */
export interface ProposerSuggestionShape {
  category: string;
  values: string[];
}

/** Parse a one-line ``proposer_suggestion`` into its category +
 *  value tokens. Recognised shapes (from the LLM judges in
 *  ``gemma_curation_agents/agents/audit/judges/``):
 *
 *    "timepoint: [7 days post-ICU discharge, 6 months post-ICU discharge]"
 *    "timepoint: 7 days post-ICU discharge, 6 months post-ICU discharge"
 *    "cell type: neuron"
 *
 *  Returns ``null`` when the string doesn't fit the shape (no colon,
 *  empty category, etc.). The caller treats ``null`` as "can't tell
 *  if this is redundant — render it". */
export function parseProposerSuggestion(
  text: string | null | undefined,
): ProposerSuggestionShape | null {
  if (!text) return null;
  const s = text.trim();
  if (!s) return null;
  const colon = s.indexOf(":");
  if (colon <= 0) return null;
  const category = s.slice(0, colon).trim();
  if (!category) return null;
  let rest = s.slice(colon + 1).trim();
  // Strip optional [ ... ] wrapper that the factor / fv judges emit.
  if (rest.startsWith("[") && rest.endsWith("]")) {
    rest = rest.slice(1, -1).trim();
  }
  if (!rest) return { category, values: [] };
  const values = rest
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return { category, values };
}

/** True when the parsed ``proposer_suggestion`` is just restating
 *  the FV labels the curator can already see in the FV chips above.
 *  Matches on the multiset of value labels (case-insensitive,
 *  trimmed) — we don't require value order to agree because the
 *  agent-side judges don't guarantee an ordering and the FV blocks
 *  use their own deterministic order.
 *
 *  Returns ``false`` when ``visibleFvLabels`` is empty (there's
 *  nothing to compare against — render the suggestion as a fallback
 *  so the curator doesn't lose the signal) or when the parsed
 *  suggestion has no values (the suggestion is just a bare category,
 *  which the header already shows). */
export function isProposerSuggestionRedundant(
  parsed: ProposerSuggestionShape | null,
  visibleFvLabels: string[],
): boolean {
  if (!parsed) return false; // unparseable → render as-is
  if (parsed.values.length === 0) return true; // bare category — header has this
  if (visibleFvLabels.length === 0) return false; // nothing above to dedup against
  const norm = (s: string) => s.trim().toLowerCase();
  const visible = new Set(visibleFvLabels.map(norm));
  // All suggestion values must be already visible. If even one is
  // novel, render the suggestion so the curator sees the new label.
  return parsed.values.every((v) => visible.has(norm(v)));
}

/** Pick the text for the "Judge:" row. Preference order:
 *
 *    1. ``defenderVerdict.rationale`` — the judge pass's reasoning,
 *       freshest signal.
 *    2. ``proposer_defense`` — the proposer's one-sentence why,
 *       used as fallback when no judge run attached.
 *    3. ``AGENT_NO_DETAILS_SENTINEL`` — explicit "agent emitted
 *       nothing" placeholder. Distinct from rendering nothing so the
 *       curator can tell agent-side absence from renderer-side bug.
 *
 *  The sentinel branch is what the caller renders in muted slate
 *  italic. */
export function pickJudgeRowText(
  defenderRationale: string | null | undefined,
  proposerDefense: string | null | undefined,
): { text: string; isSentinel: boolean } {
  const dv = (defenderRationale ?? "").trim();
  if (dv && dv !== AGENT_NO_DETAILS_SENTINEL) {
    return { text: dv, isSentinel: false };
  }
  const pd = (proposerDefense ?? "").trim();
  if (pd && pd !== AGENT_NO_DETAILS_SENTINEL) {
    return { text: pd, isSentinel: false };
  }
  return { text: AGENT_NO_DETAILS_SENTINEL, isSentinel: true };
}

/** True when an S10_term_validator subtask decision is just
 *  echoing the URI already shown on the header term chip. The
 *  validator emits its URI as a short form (e.g.
 *  ``UBERON:0000044``) inside the verdict prose; checking by
 *  substring against the short form of the header URI catches
 *  every shape S10 uses today (free-text, novel, canonical-label
 *  mismatch). Returns ``false`` for non-S10 subtasks so the caller
 *  keeps them. */
export function s10MatchesHeaderUri(
  decision: { subtask: string; verdict: string },
  headerUri: string | null | undefined,
): boolean {
  if (decision.subtask !== "S10_term_validator") return false;
  if (!headerUri) return false;
  // Same shortening rule as term_validator._short_uri / the UI's
  // Term chip: strip the namespace prefix to a CURIE-ish suffix.
  // Patterns covered:
  //   - http://purl.obolibrary.org/obo/UBERON_0000044  → UBERON:0000044
  //   - http://purl.obolibrary.org/obo/CL_0000540      → CL:0000540
  //   - http://example.com/ns#GO_0006915               → GO:0006915
  const tail = headerUri.split(/[#/]/).pop() ?? headerUri;
  const m = tail.match(/^([A-Za-z]+)[_:]([A-Za-z0-9]+)$/);
  const curie = m ? `${m[1]}:${m[2]}` : tail;
  return decision.verdict.includes(curie) || decision.verdict.includes(headerUri);
}
