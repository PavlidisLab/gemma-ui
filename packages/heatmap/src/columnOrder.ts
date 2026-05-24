/**
 * Pure derivation of a column-display order from the payload + the
 * curator-selected "main grouping factor" (HEATMAP_SPEC §4).
 *
 *  - null factor id           → server-side order (identity).
 *  - categorical factor       → bucket by FV (baseline first, then
 *                               `factor_values[]` order); stable
 *                               secondary sort = server index.
 *  - continuous factor        → ascending by sample's numeric value;
 *                               missing values to the right.
 *
 * Also emits per-rendered-column gap markers (categorical only; 4px
 * between FV groups per the spec).
 */
import { continuousValueOf } from './payload';
import type { Factor, HeatmapPayload } from './payload';

export interface ColumnOrderResult {
  /** Source-column indices in render order. `length === columns.length`. */
  columnOrder: number[];
  /** Per-rendered-column leading gap in CSS pixels. `gaps[i]` is the
   *  gap that should appear BEFORE rendered column `i`. `gaps[0]` is
   *  always 0. Length = `columnOrder.length`. */
  gaps: number[];
}

const GROUP_GAP_PX = 4;

/**
 * Compute the render-order permutation for a payload, given the
 * main-grouping-factor selection. Stable: when grouping resolves to
 * "no change" (server order) the identity permutation is returned.
 *
 * Never mutates `payload.columns`.
 */
export function computeColumnOrder(
  payload: HeatmapPayload,
  mainGroupingFactorId: number | null,
): ColumnOrderResult {
  const n = payload.columns.length;
  const identity = Array.from({ length: n }, (_, i) => i);
  const noGaps = new Array<number>(n).fill(0);

  if (mainGroupingFactorId == null || n === 0) {
    return { columnOrder: identity, gaps: noGaps };
  }

  const factor = payload.factors.find((f) => f.id === mainGroupingFactorId);
  if (!factor) {
    return { columnOrder: identity, gaps: noGaps };
  }

  if (factor.type === 'continuous') {
    return continuousOrder(factor, payload);
  }
  return categoricalOrder(factor, payload);
}

function categoricalOrder(
  factor: Factor,
  payload: HeatmapPayload,
): ColumnOrderResult {
  // Bucket order: baseline FV(s) first, then remaining FVs in
  // payload order. The spec says "the baseline FV (singular) goes
  // first"; we tolerate multiple baselines by emitting them all up
  // front in their declared order — keeps the rule simple and
  // doesn't depend on `validateDesign` being clean.
  const fvOrder: Array<number | null> = [];
  for (const fv of factor.factor_values) {
    if (fv.is_baseline) fvOrder.push(fv.id);
  }
  for (const fv of factor.factor_values) {
    if (!fv.is_baseline) fvOrder.push(fv.id);
  }
  // Unassigned bucket at the end.
  fvOrder.push(null);

  // Bucketise columns. Preserve server order within each bucket
  // (the natural for-loop achieves this).
  const buckets = new Map<number | null, number[]>();
  for (const id of fvOrder) buckets.set(id, []);
  for (let i = 0; i < payload.columns.length; i++) {
    const fvId = payload.columns[i].factorValueIds[factor.id] ?? null;
    const key = buckets.has(fvId) ? fvId : null;
    buckets.get(key)!.push(i);
  }

  // Flatten + emit a leading gap whenever the bucket boundary is
  // crossed (and the new bucket isn't empty).
  const columnOrder: number[] = [];
  const gaps: number[] = [];
  let firstNonEmpty = true;
  for (const id of fvOrder) {
    const bucket = buckets.get(id)!;
    if (bucket.length === 0) continue;
    for (let j = 0; j < bucket.length; j++) {
      columnOrder.push(bucket[j]);
      // Gap only at bucket boundary (j === 0) AND not the first
      // non-empty bucket (no leading gap on the first column).
      gaps.push(j === 0 && !firstNonEmpty ? GROUP_GAP_PX : 0);
    }
    firstNonEmpty = false;
  }

  return { columnOrder, gaps };
}

function continuousOrder(
  factor: Factor,
  payload: HeatmapPayload,
): ColumnOrderResult {
  const n = payload.columns.length;
  const items = Array.from({ length: n }, (_, i) => ({
    idx: i,
    v: continuousValueOf(factor, payload.columns[i]),
  }));
  // Sort: ascending numeric value, samples without measurement to
  // the right (`null` last). Stable on ties → preserve server index.
  items.sort((a, b) => {
    const av = a.v;
    const bv = b.v;
    if (av == null && bv == null) return a.idx - b.idx;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av === bv) return a.idx - b.idx;
    return av - bv;
  });
  return {
    columnOrder: items.map((it) => it.idx),
    gaps: new Array<number>(n).fill(0),
  };
}
