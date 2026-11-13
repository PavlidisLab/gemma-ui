/**
 * Geometry for the cell-detail sparkline (`SidePanel.tsx`): a row's
 * values in displayed column order, missing ones left as gaps.
 *
 * The line used to be one path through the finite values only, so a
 * missing sample was bridged by a straight segment between its
 * neighbours — a run of NAs read as a smooth slope. The pen now lifts
 * at every gap, and a value with a gap on both sides, which no segment
 * can show, is drawn as a dot.
 */

export interface SparklineGeometry {
  /** SVG path data; one `M…L…` subpath per run of finite values. */
  d: string;
  /** Finite values with no finite neighbour — drawn as dots. */
  dots: Array<[number, number]>;
  /** x position of column `i`. */
  sx: (i: number) => number;
  /** y position of value `v`. */
  sy: (v: number) => number;
}

const isFiniteValue = (v: number | null | undefined): v is number =>
  v != null && Number.isFinite(v);

/** `null` when fewer than two values are finite — nothing to plot. */
export function sparklineGeometry(
  values: Array<number | null>,
  width: number,
  height: number,
): SparklineGeometry | null {
  let lo = Infinity;
  let hi = -Infinity;
  let n = 0;
  for (const v of values) {
    if (!isFiniteValue(v)) continue;
    n++;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (n < 2) return null;
  const range = hi - lo || 1;
  const sx = (i: number) => (i / Math.max(1, values.length - 1)) * width;
  const sy = (v: number) => height - ((v - lo) / range) * height;

  const parts: string[] = [];
  const dots: Array<[number, number]> = [];
  values.forEach((v, i) => {
    if (!isFiniteValue(v)) return;
    const x = sx(i);
    const y = sy(v);
    const prev = isFiniteValue(values[i - 1]);
    const next = isFiniteValue(values[i + 1]);
    if (!prev && !next) {
      dots.push([x, y]);
      return;
    }
    parts.push(`${prev ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`);
  });
  return { d: parts.join(' '), dots, sx, sy };
}
