/**
 * Categorical-strip palette + value building (HEATMAP_SPEC §3.1).
 *
 * Pure functions of `(Factor, columns)`. Produces a
 * `CategoricalAnnotation` the existing canvas renderer already knows
 * how to draw — only the way we *build* the palette is new.
 *
 * Palette policy:
 *  - Hash `(factor.id, fv.id)` to a slot in a fixed 12-color qualitative
 *    Tailwind 500-shade ramp. Stable across reloads.
 *  - Baseline FV (`is_baseline: true`) always gets slot 0 (neutral
 *    gray-400) so the eye reads it as "reference".
 *  - Missing assignment falls through to `nanColor` in the renderer.
 */
import type { CategoricalAnnotation } from '../types';
import type {
  Factor,
  HeatmapPayloadColumn,
} from '../payload';

/** Tailwind 500-shade qualitative ramp (12 hues). */
const QUAL_PALETTE: readonly string[] = [
  '#3b82f6', // blue-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#8b5cf6', // violet-500
  '#f43f5e', // rose-500
  '#14b8a6', // teal-500
  '#6366f1', // indigo-500
  '#84cc16', // lime-500
  '#ec4899', // pink-500
  '#06b6d4', // cyan-500
  '#d946ef', // fuchsia-500
  '#f97316', // orange-500
];

/** Greyscale ramp for nuisance factors (batch / block). Tailwind
 *  slate 300-700 — enough contrast to distinguish groups, low enough
 *  saturation not to compete visually with the biological strips. */
const GREY_PALETTE: readonly string[] = [
  '#cbd5e1', // slate-300
  '#94a3b8', // slate-400
  '#64748b', // slate-500
  '#475569', // slate-600
  '#334155', // slate-700
  '#e2e8f0', // slate-200 (cycle continues if many groups)
  '#1e293b', // slate-800
];

/** Reserved baseline slot — neutral gray-400. */
const BASELINE_COLOR = '#9ca3af';

/** Factors we render compact + greyscale (nuisance / technical). */
const COMPACT_FACTOR_RE = /\b(batch|block)\b/i;

function isCompactFactor(factor: Factor): boolean {
  const cat = factor.category?.label ?? '';
  const name = factor.name ?? '';
  return COMPACT_FACTOR_RE.test(cat) || COMPACT_FACTOR_RE.test(name);
}

/**
 * Stable 32-bit hash over a string. Deterministic; matches no
 * external library — we just need "the same input always lands in
 * the same slot". (FNV-1a, public domain.)
 */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Build a `CategoricalAnnotation` strip from a categorical factor +
 * payload columns. Each strip cell carries the assigned FV's
 * `free_text_label` (or `null` for unassigned columns). The palette
 * maps that label string to the FV's color slot.
 *
 * NOTE: this collapses to the v1 wire shape the canvas already
 * renders. The richer `factorId` is threaded for downstream hit
 * testing.
 */
export function buildCategoricalStrip(
  factor: Factor,
  columns: HeatmapPayloadColumn[],
): CategoricalAnnotation {
  const compact = isCompactFactor(factor);
  const ramp = compact ? GREY_PALETTE : QUAL_PALETTE;
  const palette: Record<string, string> = {};
  for (const fv of factor.factor_values) {
    const key = fv.free_text_label || `fv:${fv.id}`;
    if (fv.is_baseline && !compact) {
      palette[key] = BASELINE_COLOR;
      continue;
    }
    const slot = hash32(`${factor.id}:${fv.id}`) % ramp.length;
    palette[key] = ramp[slot];
  }

  // Build a fast (id -> label) lookup so we don't scan factor_values
  // per column. Missing assignments produce `null`, which the
  // renderer paints as nanColor.
  const fvLabelById = new Map<number, string>();
  for (const fv of factor.factor_values) {
    fvLabelById.set(fv.id, fv.free_text_label || `fv:${fv.id}`);
  }
  const values: Array<string | null> = columns.map((c) => {
    const fvId = c.factorValueIds[factor.id];
    if (fvId == null) return null;
    return fvLabelById.get(fvId) ?? null;
  });

  return {
    kind: 'categorical',
    name: factor.name,
    values,
    palette,
    factorId: factor.id,
    compact,
  };
}
