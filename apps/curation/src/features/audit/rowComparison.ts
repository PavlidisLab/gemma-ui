/**
 * Pure agreement / equality helpers for the per-element editor's
 * comparator rows.
 *
 * Pulled out of ``FindingDetailsEditor.tsx`` so the
 * "does everyone agree on this row" check is unit-testable. The
 * 2026-05-20 "everyone agrees ✓" bug — agent_extra tags showing as
 * agreement even though gold explicitly didn't have the proposed
 * tag — lived in here.
 */

export interface SideValue {
  label: string;
  uri: string | null;
}

export function lc(s: string | null | undefined): string {
  return (s || "").toLowerCase().trim();
}

/** Conservative label normalizer used by ``sidesAgree`` so trivial
 *  number-and-unit pluralizations don't surface as disagreements.
 *  ``"2 month"`` and ``"2 months"`` collapse to the same canonical
 *  form; ``"prime adult stage"`` and similar non-quantitative labels
 *  pass through unchanged. The scoped pattern (digits + a single
 *  alphabetic word + optional ``s``) is safe — it won't fold
 *  ``"5 doctors"`` vs ``"5 doctor"`` style cases either, since both
 *  forms collapse to the same canonical anyway. Per design review 2026-06-02:
 *  ``"2 month"`` / ``"2 months"`` were showing as FV-level diffs
 *  on developmental stage objects in the holdout-50 audit. */
export function normalizeLiteralLabel(s: string): string {
  const trimmed = lc(s);
  const m = trimmed.match(/^(\d+(?:\.\d+)?)\s+([a-z]+?)s?$/);
  if (m) return `${m[1]} ${m[2]}`;
  return trimmed;
}

export function isSideEmpty(s: SideValue | null): boolean {
  if (!s) return true;
  return !s.label && !s.uri;
}

/** Two comparator-row sides agree iff they describe the same
 *  ontology term — by URI when both carry one, by label otherwise.
 *  Empty-on-both-sides also counts as agreement.
 *
 *  The 2026-05-20 bug fix: empty-on-one-side-only is a real
 *  *disagreement*. Earlier code filtered empty sides out before
 *  comparing, which made "agent proposed adding X; gold doesn't
 *  have X" look like agreement. */
export function sidesAgree(
  a: SideValue | null,
  b: SideValue | null,
): boolean {
  if (a === null && b === null) return true;
  if (!a || !b) return false;
  const aEmpty = isSideEmpty(a);
  const bEmpty = isSideEmpty(b);
  if (aEmpty && bEmpty) return true;
  if (aEmpty !== bEmpty) return false;
  if (a.uri && b.uri && a.uri === b.uri) return true;
  if (lc(a.label) === lc(b.label)) return true;
  // Last chance: literal-label normalization for the URI-less object
  // side (e.g. "2 month" vs "2 months" on a developmental stage FV).
  // Only fires for the number+unit shape; everything else is identity.
  if (normalizeLiteralLabel(a.label) === normalizeLiteralLabel(b.label)) {
    return true;
  }
  return false;
}

/** True when every present comparator (proposal + currently +
 *  reference) describes the same value. ``null`` means "no data
 *  sourced for this side" and is skipped; an empty-but-present
 *  SideValue (``{label: "", uri: null}``) counts as "explicitly
 *  empty" and triggers disagreement against a non-empty other side.
 *
 *  The proposal side is always present. Currently / reference are
 *  optional. When only the proposal is present (no other side to
 *  compare against), the row trivially "agrees" since there's
 *  nothing to disagree with. */
export function rowAgreement(
  proposal: SideValue,
  currently: SideValue | null,
  reference: SideValue | null,
): boolean {
  const sides: (SideValue | null)[] = [proposal];
  if (currently !== null) sides.push(currently);
  if (reference !== null) sides.push(reference);
  if (sides.length <= 1) return true;
  for (let i = 1; i < sides.length; i++) {
    if (!sidesAgree(sides[0], sides[i])) return false;
  }
  return true;
}
