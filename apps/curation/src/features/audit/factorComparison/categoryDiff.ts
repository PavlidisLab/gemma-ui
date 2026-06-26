/** Factor-identity category-diff test for the comparison grid header.
 *
 *  The grid renders the left (current/gold) and right (agent/auditor)
 *  factor categories as independent chips. When they disagree the
 *  header must flag it as an amber diff — the same signal the per-FV
 *  chips use — instead of two quietly-different green chips. A
 *  near-match factor whose category drifted (e.g. ``disease``
 *  EFO:0000408 on the current side vs ``disease model`` TGEMO:00101 on
 *  the agent side) was rendering with no visual cue at all.
 *
 *  Rules:
 *    - Both sides must carry a category label. A one-sided add / remove
 *      (one label absent) is not a category *mismatch* to highlight.
 *    - Different labels (case/space-insensitive) always count.
 *    - Same label but two *present-and-different* URIs counts too —
 *      same name, different concept.
 *    - A URI present on one side and absent on the other is NOT a diff:
 *      that's resolution noise (one side unresolved), not a category
 *      disagreement, and toning it amber would be a false alarm.
 */
export interface CategoryRef {
  label: string | null;
  uri: string | null;
}

export function categoriesDiffer(
  a: CategoryRef | null | undefined,
  b: CategoryRef | null | undefined,
): boolean {
  const al = (a?.label ?? "").trim().toLowerCase();
  const bl = (b?.label ?? "").trim().toLowerCase();
  if (!al || !bl) return false;
  if (al !== bl) return true;
  const au = (a?.uri ?? "").trim();
  const bu = (b?.uri ?? "").trim();
  return !!(au && bu && au !== bu);
}
