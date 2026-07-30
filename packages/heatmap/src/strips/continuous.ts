/**
 * Continuous-strip scale + palette building.
 *
 * Pure functions of `(Factor, columns)`. Returns a
 * `ContinuousAnnotation` with a `scale` (linear / log10 / diverging)
 * + a `Palette` (`blackbody` sequential for non-negative,
 * `ambsky` diverging for signed).
 */
import { PALETTES } from '../palettes';
import { continuousValueOf, parseFactorUnit } from '../payload';
import type { ContinuousAnnotation, ContinuousScale, Palette } from '../types';
import type { Factor, HeatmapPayloadColumn } from '../payload';

/**
 * Pick a scale (linear / log10 / diverging) from the observed numeric
 * range per the spec rules.
 *
 *  - Diverging when values include zero OR are symmetric around zero
 *    (i.e. the range straddles zero — `min < 0 && max > 0`).
 *  - Log10 when `max/min > 100` AND `min > 0` (positive, large-dynamic-
 *    range).
 *  - Otherwise linear over `[min, max]`.
 */
export function pickContinuousScale(values: number[]): ContinuousScale {
  if (values.length === 0) {
    return { kind: 'linear', domain: [0, 1] };
  }
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  // Diverging: straddles zero.
  if (min < 0 && max > 0) {
    const a = Math.max(Math.abs(min), Math.abs(max));
    return { kind: 'diverging', absMax: a === 0 ? 1 : a };
  }
  // Log10 candidate: strictly positive, wide dynamic range.
  if (min > 0 && max / min > 100) {
    return { kind: 'log10', domain: [min, max] };
  }
  // Linear (covers non-negative-with-zero, all-negative, and narrow ranges).
  // Avoid a zero-width domain.
  if (min === max) {
    return { kind: 'linear', domain: [min - 0.5, max + 0.5] };
  }
  return { kind: 'linear', domain: [min, max] };
}

/** Pick the palette that goes with a scale. Diverging -> ambsky;
 *  everything else -> blackbody (sequential). */
export function paletteFor(scale: ContinuousScale): Palette {
  return scale.kind === 'diverging' ? PALETTES.ambsky : PALETTES.blackbody;
}

/**
 * Project a numeric value into the palette's domain `[lo, hi]` using
 * the strip's scale. Used by the canvas renderer to convert a
 * continuous-strip value to a normalized scalar that the
 * `makeColorScale` machinery can sample.
 *
 * Output is in:
 *   - `[-1, 1]` for diverging (sampled through the diverging palette
 *     with `clip = 1`).
 *   - `[lo, hi]` for sequential — caller passes those as the domain.
 *
 * Returns null for null / NaN.
 */
export function projectContinuous(
  v: number | null,
  scale: ContinuousScale,
): number | null {
  if (v == null || Number.isNaN(v)) return null;
  if (scale.kind === 'diverging') {
    // Map to [-1, 1]; the diverging-palette sampler clips at ±1.
    return v / scale.absMax;
  }
  if (scale.kind === 'log10') {
    // Guard non-positive (shouldn't happen given the scale-picker
    // gate, but defensive).
    if (v <= 0) return Math.log10(scale.domain[0]);
    return Math.log10(v);
  }
  return v;
}

/** Sequential palette domain after the scale's projection. For log10
 *  the renderer needs the log-space bounds (not the raw domain) so
 *  the sampler bins values correctly. */
export function projectedDomain(scale: ContinuousScale): [number, number] {
  if (scale.kind === 'diverging') return [-1, 1];
  if (scale.kind === 'log10') {
    return [Math.log10(scale.domain[0]), Math.log10(scale.domain[1])];
  }
  return scale.domain;
}

/**
 * Build a continuous strip from a `Factor` of `type: 'continuous'`
 * + payload columns. Resolves per-sample values via
 * `continuousValueOf` (which prefers `factor.continuousMeasurements`
 * and falls back to `FactorValue.numeric_value`).
 */
export function buildContinuousStrip(
  factor: Factor,
  columns: HeatmapPayloadColumn[],
): ContinuousAnnotation {
  const values: Array<number | null> = columns.map((c) =>
    continuousValueOf(factor, c),
  );
  const finite = values.filter(
    (v): v is number => v != null && Number.isFinite(v),
  );
  const scale = pickContinuousScale(finite);
  const palette = paletteFor(scale);
  return {
    kind: 'continuous',
    name: factor.name,
    values,
    scale,
    palette,
    factorId: factor.id,
    unit: parseFactorUnit(factor.name),
  };
}
