import type { CellValue, Palette, ResolvedConfig } from './types';

/**
 * Build a `value -> css color` sampler from a resolved config.
 *
 * Nearest-neighbor binning (no inter-stop interpolation) matches the legacy
 * Gemma heatmap and keeps adjacent cells visually distinct. If continuous
 * interpolation is wanted later, swap in a lerp here without changing callers.
 */
export function makeColorScale(config: ResolvedConfig): (v: CellValue) => string {
  const { palette, clip, domain, nanColor } = config;
  if (palette.kind === 'diverging') {
    return divergingScale(palette, clip, nanColor);
  }
  const [lo, hi] = domain ?? [0, 1];
  return sequentialScale(palette, lo, hi, nanColor);
}

function divergingScale(palette: Palette, clip: number, nanColor: string) {
  const stops = palette.stops;
  const n = stops.length;
  // Total ramp width is 2*clip (from -clip to +clip), divided into n equal bins.
  const binSize = (2 * clip) / n;
  return (v: CellValue): string => {
    if (v === null || Number.isNaN(v)) return nanColor;
    const clipped = v > clip ? clip : v < -clip ? -clip : v;
    const idx = Math.floor((clipped + clip) / binSize);
    return stops[idx >= n ? n - 1 : idx < 0 ? 0 : idx];
  };
}

function sequentialScale(palette: Palette, lo: number, hi: number, nanColor: string) {
  const stops = palette.stops;
  const n = stops.length;
  const range = hi - lo;
  // Degenerate domain → always the midpoint stop.
  if (range <= 0) {
    const mid = stops[Math.floor(n / 2)];
    return (v: CellValue) => (v === null || Number.isNaN(v) ? nanColor : mid);
  }
  const binSize = range / n;
  return (v: CellValue): string => {
    if (v === null || Number.isNaN(v)) return nanColor;
    const clipped = v > hi ? hi : v < lo ? lo : v;
    const idx = Math.floor((clipped - lo) / binSize);
    return stops[idx >= n ? n - 1 : idx < 0 ? 0 : idx];
  };
}

/** Z-score each row over its non-null cells.
 *
 *  Rows with zero variance collapse to all-zero (palette midpoint —
 *  visually "no signal"). NaN / null cells stay missing. The standard
 *  expression-heatmap normalization: each gene becomes relative to its
 *  own range, so high-expression and low-expression genes share a
 *  common contrast scale. */
export function rowStandardize(values: CellValue[][]): CellValue[][] {
  return values.map((row) => {
    let sum = 0;
    let n = 0;
    for (const v of row) {
      if (v == null || Number.isNaN(v)) continue;
      sum += v;
      n++;
    }
    if (n === 0) return row.slice();
    const mean = sum / n;
    let ss = 0;
    for (const v of row) {
      if (v == null || Number.isNaN(v)) continue;
      const d = v - mean;
      ss += d * d;
    }
    const sd = Math.sqrt(ss / Math.max(1, n - 1));
    if (sd === 0) return row.map((v) => (v == null || Number.isNaN(v) ? null : 0));
    return row.map((v) =>
      v == null || Number.isNaN(v) ? null : (v - mean) / sd,
    );
  });
}

/** Compute the data min/max ignoring null/NaN. Used as a fallback domain. */
export function dataExtent(values: CellValue[][]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const row of values) {
    for (const v of row) {
      if (v === null || Number.isNaN(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  return [lo, hi];
}
