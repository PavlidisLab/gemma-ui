/**
 * Row ordering for the heatmap — clustering, expression level, or
 * label, as a permutation rather than a re-sorted matrix.
 *
 * Everything here returns `number[]`, display index → SOURCE row
 * index. The widget permutes its own arrays with it and maps the index
 * back before it calls anything the caller gave it, so a caller's
 * `rowLabelTooltip(i)` still receives the row it thinks it does.
 *
 * 🛑 No dendrogram. Clustering here is only a row ORDER — Paul,
 * 2026-09-15: *"no tree should be shown"*. The tree exists during the
 * merge and is thrown away at the end.
 *
 * On cost: average-linkage on 1 − Pearson, measured in node on random
 * matrices of 417 columns — 56 rows 23ms, 107 rows 19ms, 200 rows
 * 65ms, 500 rows 741ms. The heatmaps this ships in render ≤ ~110 rows
 * (the Visualize tab caps a GO term at 100 genes; a DE contrast shows
 * 50), so the real cost is ~20ms, once, memoized. Past
 * {@link ROW_CLUSTER_MAX_ROWS} the curve is steep enough that it would
 * be felt, so clustering declines and hands back the expression order.
 */

import type { CellValue } from './types';

export type RowOrderMode = 'none' | 'cluster' | 'expression' | 'label';

/** Above this many rows, `cluster` falls back to `expression`. Set from
 *  the measurements above: 500 rows is ~740ms, which is a visible
 *  freeze on the render path. */
export const ROW_CLUSTER_MAX_ROWS = 400;

export const ROW_ORDER_LABELS: Record<RowOrderMode, string> = {
  none: 'As given',
  cluster: 'Cluster',
  expression: 'Expression',
  label: 'Name',
};

/** Identity permutation. */
function identity(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

/** Row mean over finite cells; NaN-only rows sort last. */
function rowMeans(values: CellValue[][]): number[] {
  return values.map((row) => {
    let sum = 0;
    let n = 0;
    for (const v of row) {
      const x = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(x)) {
        sum += x;
        n++;
      }
    }
    return n === 0 ? Number.NEGATIVE_INFINITY : sum / n;
  });
}

/**
 * Row-standardize into Float64Arrays for the distance step.
 *
 * Separate from `color.ts`'s `rowStandardize` on purpose: that one
 * feeds the colour scale and has to preserve the `CellValue | null`
 * shape, while this one wants packed floats and treats a null as the
 * row mean (distance 0 contribution) so one missing cell doesn't
 * poison a whole correlation.
 */
function standardizeForDistance(values: CellValue[][]): Float64Array[] {
  return values.map((row) => {
    const n = row.length;
    const out = new Float64Array(n);
    let sum = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const v = row[i];
      const x = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(x)) {
        out[i] = x;
        sum += x;
        count++;
      } else {
        out[i] = Number.NaN;
      }
    }
    const mean = count === 0 ? 0 : sum / count;
    let ss = 0;
    for (let i = 0; i < n; i++) {
      if (Number.isNaN(out[i])) out[i] = mean;
      const d = out[i] - mean;
      ss += d * d;
    }
    const sd = Math.sqrt(ss / Math.max(1, n)) || 1;
    for (let i = 0; i < n; i++) out[i] = (out[i] - mean) / sd;
    return out;
  });
}

/**
 * Average-linkage agglomerative clustering, leaf order out.
 *
 * Distances are recomputed from cluster membership on each merge
 * rather than carried through a Lance-Williams update. That is the
 * slower of the two, and deliberately so at these sizes: it is a dozen
 * lines instead of a distance-matrix bookkeeping problem, and at 107
 * rows it costs ~20ms. The cap above is what keeps that trade honest.
 */
function clusterOrder(values: CellValue[][]): number[] {
  const n = values.length;
  if (n < 3) return identity(n);
  const z = standardizeForDistance(values);
  const cols = z[0]?.length ?? 0;
  if (cols === 0) return identity(n);

  // Pairwise 1 − Pearson over the standardized rows (so the dot
  // product over n IS the correlation).
  const D = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let s = 0;
      const a = z[i];
      const b = z[j];
      for (let k = 0; k < cols; k++) s += a[k] * b[k];
      const d = 1 - s / cols;
      D[i * n + j] = d;
      D[j * n + i] = d;
    }
  }

  type Node = { members: number[] };
  const nodes: Node[] = Array.from({ length: n }, (_, i) => ({ members: [i] }));
  let active = identity(n);
  const linkage = (a: number, b: number) => {
    const A = nodes[a].members;
    const B = nodes[b].members;
    let s = 0;
    for (const i of A) for (const j of B) s += D[i * n + j];
    return s / (A.length * B.length);
  };

  while (active.length > 1) {
    let best = Infinity;
    let bi = 0;
    let bj = 1;
    for (let x = 0; x < active.length; x++) {
      for (let y = x + 1; y < active.length; y++) {
        const d = linkage(active[x], active[y]);
        if (d < best) {
          best = d;
          bi = active[x];
          bj = active[y];
        }
      }
    }
    // Larger cluster first so the order reads big-block-then-tail
    // rather than alternating.
    const left = nodes[bi].members.length >= nodes[bj].members.length ? bi : bj;
    const right = left === bi ? bj : bi;
    nodes.push({ members: [...nodes[left].members, ...nodes[right].members] });
    active = active.filter((x) => x !== bi && x !== bj);
    active.push(nodes.length - 1);
  }
  return nodes[active[0]].members;
}

/**
 * Display-order permutation for the given mode.
 *
 * `labels` is only read by `'label'`; rows with no label sort last so
 * an unlabelled probe doesn't land in the middle of the alphabet.
 */
export function computeRowOrder(
  mode: RowOrderMode,
  values: CellValue[][],
  labels?: ReadonlyArray<string | undefined>,
): number[] {
  const n = values.length;
  if (n <= 1 || mode === 'none') return identity(n);

  if (mode === 'label') {
    const key = (i: number) => (labels?.[i] ?? '').trim();
    return identity(n).sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (!ka && !kb) return a - b;
      if (!ka) return 1;
      if (!kb) return -1;
      // Natural compare — same rule as the browser app's
      // `compareValuesNatural` (src/lib/valueTint.ts). Inlined because
      // a package cannot import from an app, and this is one call.
      const c = ka.localeCompare(kb, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      return c !== 0 ? c : a - b;
    });
  }

  if (mode === 'expression' || n > ROW_CLUSTER_MAX_ROWS) {
    const means = rowMeans(values);
    // Highest-expressed first: the rows a reader is most likely to
    // care about are at the top, where they don't have to scroll.
    return identity(n).sort((a, b) => means[b] - means[a] || a - b);
  }

  return clusterOrder(values);
}

/** Reorder an array parallel to the rows. Returns the input untouched
 *  when there is nothing to reorder, so callers can pass optionals
 *  straight through. */
export function permute<T>(
  arr: readonly T[] | undefined,
  order: readonly number[],
): T[] | undefined {
  if (!arr) return undefined;
  return order.map((i) => arr[i]);
}

/** True when the permutation is the identity — lets callers skip the
 *  copying entirely in the common `'none'` case. */
export function isIdentityOrder(order: readonly number[]): boolean {
  for (let i = 0; i < order.length; i++) if (order[i] !== i) return false;
  return true;
}
