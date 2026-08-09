/**
 * "Hide free-text" at the VALUE level.
 *
 * One inherited tag renders one chip per comma-split value: a
 * BM-synth tag is a whole characteristic's distinct values joined
 * together — ``source: "ATCC cell line cell, generated at DKFZ,
 * isolated at DKFZ"``. The tag-level free-text test asks "does
 * ANYTHING on this tag resolve", which is the right question for
 * dropping a tag whose every value is raw, and the wrong one for a
 * mixed tag: one CLO term made the whole tag "resolved" and its two
 * ungrounded values rendered straight through a checked box
 * (GSE104849, reported 2026-08-09).
 *
 * Scope is unchanged and deliberate: inherited chips only. An
 * ungrounded DIRECT tag is the curator's own work item and carries
 * the Δ needs-grounding marker instead of being filtered away.
 */

interface UriBearing {
  uri: string | null;
}

/**
 * Values to render for one inherited tag group.
 *
 * When nothing in the group resolves, the values are returned
 * untouched — such a group only reaches the renderer when a
 * statement resolved its entities, and blanking it would leave an
 * empty chip sitting in the category row.
 */
export function visibleTagValues<V extends UriBearing>(
  values: V[],
  hideFreeText: boolean,
): V[] {
  if (!hideFreeText) return values;
  if (!values.some((v) => !!v.uri)) return values;
  return values.filter((v) => !!v.uri);
}

/**
 * How many chips "Hide free-text" removes for one inherited tag —
 * the number next to the checkbox, in the units the curator counts
 * on screen.
 *
 * ``rescuedByStatement``: the tag has no URI on any rendered value
 * but a statement subject / object does resolve, so the tag is kept
 * whole and nothing is hidden.
 */
export function hiddenFreeTextValueCount<V extends UriBearing>(
  values: V[],
  rescuedByStatement: boolean,
): number {
  const free = values.filter((v) => !v.uri).length;
  if (values.some((v) => !!v.uri)) return free;
  return rescuedByStatement ? 0 : free;
}
