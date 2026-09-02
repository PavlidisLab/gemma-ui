/**
 * The statistics behind Gemma's PC × factor chart, ported from
 * `gemma-core` so the two surfaces answer with the same number instead
 * of two defensible-but-different ones.
 *
 * Sources (read at `af69508a9c`):
 *   SVDServiceImpl.getSvdFactorAnalysis   — the per-factor decision rule
 *   Distance.spearmanRankCorrelation      — rank, then Pearson
 *   Rank.rankTransform                    — ties take the average rank
 *   CorrelationStats.spearmanPvalue       — AS 89, Edgeworth branch
 *   CorrelationStats.correlationForPvalue — the p → r inversion
 *   KruskalWallis.test                    — chi-squared, no tie correction
 *
 * 🛑 Two deliberate departures, both recorded here rather than in a
 * comment nobody finds:
 *
 * 1. `spearmanPvalue` has an EXACT permutation branch for n <= 9 that
 *    is not ported; the Edgeworth series is used at every n. The
 *    p-value is only ever compared against another p-value or inverted
 *    (see `pcFactorAssociation`), so the difference cannot change which
 *    branch is taken except in a tie at tiny n.
 * 2. Gemma codes a categorical level by its FACTOR VALUE ID cast to a
 *    double. A draft factor value does not reliably carry one, so the
 *    caller supplies a code and the level's position in the factor is
 *    the natural choice. Both are arbitrary orderings of an unordered
 *    factor; the Kruskal–Wallis branch below is what exists to catch
 *    the case where the ordering carries no signal, and it fires on
 *    either coding.
 */

/** Ranks from 1, ties taking the average of the ranks they span. */
export function rankTransform(xs: number[]): number[] {
  const order = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
  const out = new Array<number>(xs.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && xs[order[j + 1]] === xs[order[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k]] = avg;
    i = j + 1;
  }
  return out;
}

function pearsonOf(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return NaN;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return 0;
  return sxy / Math.sqrt(sxx * syy);
}

/** Pairs where either side is NaN are dropped, as in `Distance`. */
export function spearmanRankCorrelation(xs: number[], ys: number[]): number {
  const mx: number[] = [];
  const my: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (Number.isNaN(xs[i]) || Number.isNaN(ys[i])) continue;
    mx.push(xs[i]);
    my.push(ys[i]);
  }
  if (mx.length < 2) return NaN;
  return pearsonOf(rankTransform(mx), rankTransform(my));
}

// --- normal distribution -----------------------------------------------

/** Upper tail, 1 - Phi(x). Written via erfc so the far tail does not
 *  lose every significant digit to `1 - 0.99999…`. */
export function normalUpperTail(x: number): number {
  return 0.5 * erfc(x / Math.SQRT2);
}

/** Numerical Recipes' erfc — a Chebyshev fit, relative error < 1.2e-7,
 *  and it keeps working where `1 - erf` underflows. */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 2 / (2 + z);
  const ty = 4 * t - 2;
  const cof = [
    -1.3026537197817094, 6.4196979235649026e-1, 1.9476473204185836e-2,
    -9.561514786808631e-3, -9.46595344482036e-4, 3.66839497852761e-4,
    4.2523324806907e-5, -2.0278578112534e-5, -1.624290004647e-6,
    1.303655835580e-6, 1.5626441722e-8, -8.5238095915e-8, 6.529054439e-9,
    5.059343495e-9, -9.91364156e-10, -2.27365122e-10, 9.6467911e-11,
    2.394038e-12, -6.886027e-12, 8.94487e-13, 3.13092e-13, -1.12708e-13,
    3.81e-16, 7.106e-15,
  ];
  let d = 0;
  let dd = 0;
  for (let j = cof.length - 1; j > 0; j--) {
    const tmp = d;
    d = ty * d - dd + cof[j];
    dd = tmp;
  }
  const ans = t * Math.exp(-z * z + 0.5 * (cof[0] + ty * d) - dd);
  return x >= 0 ? ans : 2 - ans;
}

/** Inverse standard normal CDF (Acklam's rational approximation). The
 *  tail branch is what carries p ~ 1e-40, which is exactly the range
 *  `correlationForPvalue` is handed. */
export function normalInverse(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const plow = 0.02425;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > 1 - plow) return -normalInverse(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

// --- chi-squared upper tail --------------------------------------------

function lnGamma(x: number): number {
  const g = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += g[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Regularized upper incomplete gamma Q(a, x). Series below a+1,
 *  continued fraction above — the standard split. */
function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) {
    // Series for P(a, x), then complement.
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 0; n < 1000; n++) {
      ap++;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  }
  // Lentz's continued fraction for Q(a, x).
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

/** P(chi-squared with `dof` df > `x`). */
export function chiSquareComplemented(dof: number, x: number): number {
  if (!(x > 0) || dof <= 0) return 1;
  return gammaQ(dof / 2, x / 2);
}

// --- the two CorrelationStats entry points ------------------------------

/** Two-tailed p for a Spearman rho at `n` complete observations. */
export function spearmanPvalue(rho: number, n: number): number {
  const a = Math.abs(rho);
  if (n - 2 <= 0) return 1;
  let p: number;
  if (n > 1290) {
    // Gemma's own large-n branch: the t approximation, as R does.
    const dof = n - 2;
    const t = a * Math.sqrt(dof / (1 - a * a));
    p = studentTUpperTail(dof, t);
  } else {
    p = spearmanPvalueEdgeworth(a, n);
  }
  return Math.min(1, 2 * p);
}

/** AS 89's Edgeworth series, via R's `prho.c`. Returns the tail <= 0.5. */
function spearmanPvalueEdgeworth(rho: number, n: number): number {
  const c = [
    0.2274, 0.2531, 0.1745, 0.0758, 0.1033, 0.3932, 0.0879, 0.0151, 0.0072,
    0.0831, 0.0131, 4.6e-4,
  ];
  const sStat = Math.round((Math.pow(n, 3) - n) * (1 - Math.abs(rho)) / 6);
  if (sStat <= 0) return rho > 0 ? 0 : 1;
  const b = 1 / n;
  // The back-computation of rho is Gemma's, mirroring R's implementation.
  const x = ((6 * (sStat - 1) * b) / (n * n - 1) - 1) * Math.sqrt(n - 1);
  let y = x * x;
  const u =
    x *
    b *
    (c[0] +
      b * (c[1] + c[2] * b) +
      y *
        (-c[3] +
          b * (c[4] + c[5] * b) -
          y * b * (c[6] + c[7] * b - y * (c[8] - c[9] * b + y * b * (c[10] - c[11] * y)))));
  y = u / Math.exp(y / 2);
  let pv = y + normalUpperTail(x);
  if (pv > 0.5) pv = 1 - pv;
  return Math.min(1, Math.max(0, pv));
}

function studentTUpperTail(dof: number, t: number): number {
  // Regularized incomplete beta at the standard t transform; only the
  // n > 1290 branch reaches it, so a modest implementation suffices.
  const x = dof / (dof + t * t);
  return 0.5 * incompleteBeta(dof / 2, 0.5, x);
}

function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  // Lentz on the standard continued fraction.
  let f = 1;
  let cc = 1;
  let d = 0;
  for (let i = 0; i <= 300; i++) {
    const m = Math.floor(i / 2);
    let num: number;
    if (i === 0) num = 1;
    else if (i % 2 === 0) num = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    else num = (-((a + m) * (a + b + m)) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + num * d;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    d = 1 / d;
    cc = 1 + num / cc;
    if (Math.abs(cc) < 1e-300) cc = 1e-300;
    const cd = cc * d;
    f *= cd;
    if (Math.abs(1 - cd) < 1e-14) break;
  }
  return (front * (f - 1)) / a;
}

/** The correlation that would have produced `pval` at `count` points —
 *  Gemma's "a bit like turning pvalues into prob" step. */
export function correlationForPvalue(pval: number, count: number): number {
  if (pval >= 1) return 0;
  if (pval <= 0) return 1;
  if (count < 3) return 0;
  const z = Math.abs(normalInverse(pval));
  const v = z / Math.sqrt(count - 3);
  return Math.min(unFisherTransform(v), 1);
}

function unFisherTransform(z: number): number {
  if (Math.abs(z) < 1e-10) return 0;
  if (Math.abs(z) > 20) return 1;
  const e = Math.exp(2 * z);
  return (e - 1) / (e + 1);
}

/** Chi-squared p for a one-way ANOVA on ranks. As in Gemma, ties take
 *  the average rank but the statistic carries NO tie correction, and
 *  the grouped ranks are truncated to integers on the way in. */
export function kruskalWallisTest(scores: number[], groupings: number[]): number {
  const ranks = rankTransform(scores);
  const grouped = new Map<number, number[]>();
  for (let i = 0; i < groupings.length; i++) {
    const g = Math.trunc(groupings[i]);
    if (!grouped.has(g)) grouped.set(g, []);
    grouped.get(g)!.push(Math.trunc(ranks[i]));
  }
  const numGroups = grouped.size;
  if (numGroups < 2) return 1;
  const n = scores.length;
  const scale = 12 / (n * (n + 1));
  let sum = 0;
  for (const gr of grouped.values()) {
    const m = gr.length;
    let meanRank = 0;
    for (const r of gr) meanRank += r;
    meanRank /= m;
    sum += m * Math.pow(meanRank - (n + 1) / 2, 2);
  }
  return chiSquareComplemented(numGroups - 1, scale * sum);
}

/**
 * One factor against one principal component, by Gemma's rule.
 *
 * `codes[i]` is the covariate for sample `i` — a measurement for a
 * continuous factor or a date, and an arbitrary per-level code for a
 * categorical one. `scores[i]` is that sample's score on the component.
 *
 * Continuous, and categorical with exactly two levels: the Spearman
 * correlation, full stop. Three or more levels: Spearman, UNLESS the
 * Kruskal–Wallis test finds more than the level ordering did, in which
 * case the correlation that matches the Kruskal–Wallis p-value is used
 * instead. That branch is what keeps a strong five-level factor from
 * scoring near zero because its levels happen to be listed in an order
 * uncorrelated with the component.
 */
export function pcFactorAssociation(
  scores: number[],
  codes: number[],
  kind: "continuous" | "categorical",
): number {
  const rho = spearmanRankCorrelation(scores, codes);
  if (Number.isNaN(rho)) return NaN;
  if (kind === "continuous") return Math.abs(rho);

  const present: { score: number; code: number }[] = [];
  for (let i = 0; i < codes.length; i++) {
    if (Number.isNaN(codes[i]) || Number.isNaN(scores[i])) continue;
    present.push({ score: scores[i], code: codes[i] });
  }
  const levels = new Set(present.map((p) => Math.trunc(p.code)));
  if (levels.size < 2) return NaN;
  if (levels.size === 2) return Math.abs(rho);

  const kwP = kruskalWallisTest(
    present.map((p) => p.score),
    present.map((p) => p.code),
  );
  const corrP = spearmanPvalue(rho, present.length);
  if (corrP <= kwP) return Math.abs(rho);
  return Math.abs(correlationForPvalue(kwP, present.length));
}
