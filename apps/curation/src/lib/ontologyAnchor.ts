/**
 * Visual convention: "anchored in an ontology" — a thick rounded
 * emerald bookmark on the left edge of a value chip / cell. Reads
 * as "hooked into" the canonical vocabulary, distinct from a plain
 * free-text label.
 *
 * Apply via `cn(..., ONTOLOGY_ANCHOR_CLS)` on any emerald-themed
 * chip whose value carries an ontology URI. Skip on free-text
 * siblings even when they share the chip frame — the bookmark is
 * what the curator scans for.
 *
 * Three vars exported so callers can pick the right padding for
 * their chip's existing horizontal padding (the bookmark inset
 * needs a slight left-padding bump to stay readable):
 *
 *   ONTOLOGY_ANCHOR_CLS         — bookmark only
 *   ONTOLOGY_ANCHOR_CLS_PL2     — bookmark + pl-2  (chips with px-1.5 or tighter)
 *   ONTOLOGY_ANCHOR_CLS_PL3     — bookmark + pl-3  (cells with px-3)
 */
export const ONTOLOGY_ANCHOR_CLS =
  "border-l-[3px] border-l-emerald-500 rounded-l-md";

export const ONTOLOGY_ANCHOR_CLS_PL2 =
  `${ONTOLOGY_ANCHOR_CLS} pl-2`;

export const ONTOLOGY_ANCHOR_CLS_PL3 =
  `${ONTOLOGY_ANCHOR_CLS} pl-3`;
