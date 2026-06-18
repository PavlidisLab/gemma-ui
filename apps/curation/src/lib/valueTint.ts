/**
 * Deterministic per-value tint for categorical table cells. Helps the
 * curator visually spot patterns ("all controls are this blue, all
 * treated this green") without reading every label.
 *
 * Maps a per-column first-seen-value index to an HSL colour. Index 0
 * is the same starting hue across every column, index 1 is the same
 * second hue, etc. — so columns that partition samples the same way
 * end up with matching colour stripes regardless of label text. Two
 * columns laid side-by-side reveal agreement at a glance.
 *
 * Saturation 70%, lightness 50%, alpha 0.18 — semi-transparent so the
 * same colour reads correctly on the light-mode white background AND
 * the dark-mode slate-900 background. Hue advances by the golden angle
 * (≈137.5°) so neighbouring indices stay visually distinct.
 *
 * Returns `undefined` for negative / non-finite indices so the cell
 * falls back to the surrounding theme background.
 */
export function tintForIndex(idx: number): string | undefined {
  if (!Number.isFinite(idx) || idx < 0) return undefined;
  // Start at a calm blue (220°) and walk by the golden angle.
  const hue = (220 + idx * 137.508) % 360;
  return `hsla(${hue.toFixed(0)}, 70%, 50%, 0.18)`;
}

/**
 * Natural / numeric-aware comparator for categorical cell labels.
 * Plain `localeCompare` sorts lexically, so "24 h" lands before "3 h"
 * before "8 h". The `numeric` collator option compares embedded digit
 * runs by value, giving "3 h" < "8 h" < "24 h", while still ordering
 * non-numeric labels alphabetically.
 */
export function compareValuesNatural(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}
