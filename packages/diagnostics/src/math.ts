/**
 * Math helpers shared across the diagnostics chart bodies. Lifted
 * verbatim from the curation + browser cards (they were identical).
 */

/** Pick "nice" axis ticks (1-2-5 × 10^n) covering [min, max] with
 *  roughly `count` divisions. */
export function niceTicks(min: number, max: number, count: number): number[] {
  const step = (max - min) / count;
  if (!Number.isFinite(step) || step === 0) return [min];
  const mag = Math.pow(10, Math.floor(Math.log10(step)));
  const norm = step / mag;
  const niceStep = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  const finalStep = niceStep * mag;
  const start = Math.ceil(min / finalStep) * finalStep;
  const ticks: number[] = [];
  for (let v = start; v <= max + finalStep * 0.5; v += finalStep) {
    ticks.push(Number(v.toPrecision(6)));
  }
  return ticks;
}

/** Robust range — drop the lowest qLo and highest (1 - qHi) fraction
 *  of the values so a couple of outliers don't blow up the axes. */
export function quantileRange(
  arr: number[],
  qLo: number,
  qHi: number,
): [number, number] {
  if (arr.length === 0) return [0, 1];
  const sorted = [...arr].sort((a, b) => a - b);
  const iLo = Math.floor(qLo * (sorted.length - 1));
  const iHi = Math.ceil(qHi * (sorted.length - 1));
  return [sorted[iLo], sorted[iHi]];
}

/** Linear scaler from data-space to pixel-space. */
export function scaler(
  [d0, d1]: [number, number],
  [r0, r1]: [number, number],
): (v: number) => number {
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

export function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** Pearson correlation coefficient. Returns 0 when either input has
 *  variance zero or fewer than 2 points. */
export function pearson(xs: number[], ys: number[]): number {
  if (xs.length < 2) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  return den > 0 ? num / den : 0;
}

/** Percent formatter for axis tick labels (covers 0, sub-percent,
 *  small percentages, larger percentages). */
export function fmtPct(v: number): string {
  if (v === 0) return "0";
  if (v < 0.01) return v.toFixed(3);
  if (v < 0.1) return v.toFixed(2);
  return v.toFixed(1);
}

/** Compact axis tick formatter. */
export function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return "";
  if (Number.isInteger(v)) return String(v);
  return Number(v.toPrecision(3)).toString();
}

/** Truncate a label to `n` chars with a trailing ellipsis. */
export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
