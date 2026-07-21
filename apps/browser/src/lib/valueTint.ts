/**
 * Deterministic per-value tint + natural-sort comparator for categorical
 * table cells. Ported from the curation UI (``apps/curation/src/lib/
 * valueTint.ts``) so the browser's design crosstab reads the same as the
 * curator-ui's design breakdown. Pure, dependency-free — kept as a local
 * port rather than a cross-app import, matching curie.ts / OntologyTermChip.
 */

/**
 * Maps a per-column first-seen-value index to an HSL colour. Index 0 is
 * the same starting hue across every column, so two factor columns that
 * partition the samples the same way show matching colour stripes. Hue
 * advances by the golden angle (≈137.5°) so neighbours stay distinct;
 * alpha 0.18 reads on both light and dark backgrounds. Returns
 * ``undefined`` for negative / non-finite indices (cell keeps the theme
 * background).
 */
export function tintForIndex(idx: number): string | undefined {
  if (!Number.isFinite(idx) || idx < 0) return undefined;
  const hue = (220 + idx * 137.508) % 360;
  return `hsla(${hue.toFixed(0)}, 70%, 50%, 0.18)`;
}

/**
 * Natural / numeric-aware comparator for categorical cell labels, so
 * "3 h" < "8 h" < "24 h" rather than the lexical "24 h" < "3 h".
 */
export function compareValuesNatural(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}
