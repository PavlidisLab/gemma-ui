/** The 5 sources that can populate the baseline / comparator slots
 *  of the curation comparison view. Spec:
 *  ``docs/CURATION_COMPARISON_VIEW_2026_05_27.md`` (project root).
 *
 *  The empty sentinel models "this slot is unselected" — combined with
 *  the other slot's state, it drives the bare / proposal / audit /
 *  degenerate modes the spec enumerates.
 *
 *  Wire form (URL ``?base=`` and ``?cmp=``): the bare token strings
 *  below. Stable across sessions; renaming requires a migration step.
 */
export type Source =
  | "empty"
  | "preboard"
  | "cy_polished"
  | "am_polished"
  | "agent_proposal";

export const ALL_SOURCES: readonly Source[] = [
  "empty",
  "preboard",
  "cy_polished",
  "am_polished",
  "agent_proposal",
] as const;

/** Human-facing label, used in chip dropdown items + the chip face. */
export const SOURCE_LABEL: Record<Source, string> = {
  empty: "(empty)",
  preboard: "Gemma preboard",
  cy_polished: "Cy polished",
  am_polished: "Am polished",
  agent_proposal: "agent original proposal",
};

/** Slot identifier — drives validity rules + default selection. */
export type SlotKind = "baseline" | "comparator";

/** Which sources may legitimately occupy each slot. Mirrors the
 *  slot-validity table in the spec.
 *
 *  Returns ``true`` if the source is *intrinsically* valid for the
 *  slot — i.e. independent of what the other slot holds. The
 *  ``comparator = preboard`` case is conditional on the other slot
 *  being non-empty; that constraint is enforced by
 *  ``isPairAllowed``, not here. */
export function isSourceValidInSlot(slot: SlotKind, source: Source): boolean {
  if (slot === "baseline") {
    // The agent's proposal is a proposal, not a canonical state —
    // never a legitimate baseline. Everything else is.
    return source !== "agent_proposal";
  }
  // Comparator slot: empty | preboard | polished | proposal all OK.
  // The preboard-only-as-baseline rule for the special
  // empty-baseline-preboard-comparator combination is enforced via
  // isPairAllowed.
  return true;
}

/** Are these two slot occupants allowed to co-exist? Catches the
 *  ``baseline=empty + comparator=preboard`` case the spec calls out
 *  as conceptually muddled (preboard isn't a *proposal*; it's a
 *  *state*, and pure-proposal mode is for proposed changes only).
 *  All other pairs are accepted — including identity pairs (which
 *  are the regression-test corollary). */
export function isPairAllowed(baseline: Source, comparator: Source): boolean {
  if (baseline === "empty" && comparator === "preboard") return false;
  return true;
}

/** Modes the spec derives from slot population. Used purely for
 *  card-framing / panel-header text; not load-bearing for chip logic. */
export type ComparisonMode =
  | "proposal"   // baseline empty,  comparator populated
  | "bare"       // baseline populated, comparator empty
  | "audit"      // both populated, different sources
  | "identity"   // both populated, same source (regression-test mode)
  | "degenerate"; // both empty

export function modeOf(baseline: Source, comparator: Source): ComparisonMode {
  const b = baseline !== "empty";
  const c = comparator !== "empty";
  if (!b && !c) return "degenerate";
  if (!b && c) return "proposal";
  if (b && !c) return "bare";
  if (baseline === comparator) return "identity";
  return "audit";
}

/** Default slot occupants by curation-flow context. Spec ``Defaults``
 *  section.
 *
 *  - ``review``: post-curation evaluation. Open into "where did the
 *    agent go wrong" → Cy polished vs agent proposal.
 *  - ``edit``: curator working their assigned calibration package.
 *    Open into "agent's proposal against the bare Gemma preboard".
 *
 *  Defaults are advisory — the URL ``?base=``/``?cmp=`` params win
 *  if set. */
export type FlowKind = "review" | "edit";

export function defaultSlots(
  flow: FlowKind,
): { baseline: Source; comparator: Source } {
  if (flow === "edit") {
    return { baseline: "preboard", comparator: "agent_proposal" };
  }
  return { baseline: "cy_polished", comparator: "agent_proposal" };
}

/** Token → Source parser. Returns ``null`` on unknown input so the
 *  URL layer can fall back to the default rather than crash. */
export function parseSource(s: string | null | undefined): Source | null {
  if (!s) return null;
  if ((ALL_SOURCES as readonly string[]).includes(s)) return s as Source;
  return null;
}
