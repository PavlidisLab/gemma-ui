/**
 * Tracks the first time the curator saw each audit finding so we
 * can attach `first_seen_at` to the first PATCH for that finding
 * (per `AUDIT_DISPOSITIONS.md` Ask #5). Lets the agents side subtract
 * from `reviewed_at` for triage-time analytics — separates 1s
 * click-dismisses from minute-long considerations.
 *
 * Module-level state, keyed on `target_id`. Survives re-renders
 * inside the same session. Doesn't reset on experiment switch
 * because target_ids are scoped per-experiment (the slugs include
 * factor / FV / tag identifiers that don't collide across
 * experiments). A page reload starts the map fresh — acceptable;
 * the analytics target is "did the curator linger on this finding"
 * and the meaningful signal is within a single triage session.
 *
 * `consume()` returns the stored timestamp the first time it's
 * called for a target, then null on subsequent calls. The card
 * code calls `mark()` on render and `consume()` on the first
 * patch; later patches naturally omit `first_seen_at`.
 */

const seenAt = new Map<string, string>();
const consumed = new Set<string>();

/** Stamp the current time as the first-seen for this target if
 *  we don't already have one. Idempotent — safe to call on every
 *  render. */
export function markFirstSeen(targetId: string): void {
  if (seenAt.has(targetId)) return;
  seenAt.set(targetId, new Date().toISOString());
}

/** Return the first-seen timestamp for this target, but only on
 *  the first call. Subsequent calls return null so later PATCHes
 *  omit the field. */
export function consumeFirstSeen(targetId: string): string | null {
  if (consumed.has(targetId)) return null;
  const ts = seenAt.get(targetId);
  if (!ts) return null;
  consumed.add(targetId);
  return ts;
}
