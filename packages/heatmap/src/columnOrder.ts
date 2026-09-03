/**
 * Pure derivation of a column-display order from the payload + the
 * curator-selected "main grouping factor".
 *
 * Two layers:
 *
 *  - A chain of CATEGORICAL factors is built by ascending count of
 *    distinct FVs actually assigned in this dataset (ties broken
 *    randomly per session). The user-selected main grouping factor,
 *    if any, is promoted to the head of the chain.
 *  - Columns are sorted lexicographically against the chain:
 *    baseline FVs first within each factor, then declared FV order.
 *    Within-bucket: continuous factor ascending, then server index.
 *
 * If the chain is empty (no categorical factors or just one with
 * <2 groups), we fall back to the server-side order (identity).
 *
 * Also emits per-rendered-column gap markers — 4px gap only at the
 * boundary of the primary-sort-key bucket so visual grouping
 * remains legible.
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

/** Stable per-session randomness so the picked chain doesn't reshuffle
 *  on every re-render but still differs across page loads (when the
 *  user wants a fresh tie-break, a reload gives them one). Module-
 *  scoped Math.random() lazily seeded by first use. */
let _moduleRand: number | null = null;
function sessionRand(): number {
  if (_moduleRand == null) _moduleRand = Math.random();
  return _moduleRand;
}

/**
 * Compute the render-order permutation for a payload, given the
 * main-grouping-factor selection. Stable when the chain is empty.
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
  if (n === 0) return { columnOrder: identity, gaps: noGaps };

  // 🛑 A CONTINUOUS grouping factor sorts by its value, and that check
  // comes FIRST.
  //
  // It used to sit inside `chain.length === 0`, and `buildFactorChain`
  // keeps only categorical factors — so the continuous path was reached
  // only on a dataset that had no usable categorical factor at all.
  // Everywhere else, picking "PC1 score" or `age` as the grouping put
  // the columns in categorical order and silently ignored the factor
  // that had just been chosen. Paul, 2026-09-02: *"sorting by pc score
  // should do what we expect"* and *"make sure continuous values are
  // handled right — we have factors like age."*
  if (mainGroupingFactorId != null) {
    const f = payload.factors.find((x) => x.id === mainGroupingFactorId);
    if (f && f.type === 'continuous') return continuousOrder(f, payload);
  }

  const chain = buildFactorChain(payload, mainGroupingFactorId);
  if (chain.length === 0) {
    return { columnOrder: identity, gaps: noGaps };
  }

  // Build sort-key per source column. Each key is a fixed-length
  // tuple of (bucket index within factor) where lower = earlier.
  const fvOrderByFactor = new Map<number, Map<number | null, number>>();
  for (const f of chain) {
    const order = new Map<number | null, number>();
    let idx = 0;
    for (const fv of f.factor_values) {
      if (fv.is_baseline) order.set(fv.id, idx++);
    }
    for (const fv of f.factor_values) {
      if (!fv.is_baseline) order.set(fv.id, idx++);
    }
    // Unassigned bucket — always last.
    order.set(null, idx);
    fvOrderByFactor.set(f.id, order);
  }

  type Row = { src: number; keys: number[]; primary: number };
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) {
    const col = payload.columns[i];
    const keys: number[] = [];
    for (const f of chain) {
      const fvId = col.factorValueIds[f.id] ?? null;
      const order = fvOrderByFactor.get(f.id)!;
      keys.push(order.get(fvId) ?? order.get(null)!);
    }
    rows.push({ src: i, keys, primary: keys[0] });
  }

  // Lexicographic sort. Stable tie-break = preserve server index.
  rows.sort((a, b) => {
    for (let k = 0; k < a.keys.length; k++) {
      if (a.keys[k] !== b.keys[k]) return a.keys[k] - b.keys[k];
    }
    return a.src - b.src;
  });

  // Emit gaps at primary-bucket boundary only (matches the prior
  // single-factor visual; multi-level boundary marks at every level
  // get visually noisy quickly).
  const columnOrder: number[] = [];
  const gaps: number[] = [];
  let prevPrimary: number | null = null;
  for (let i = 0; i < rows.length; i++) {
    columnOrder.push(rows[i].src);
    const isBoundary = prevPrimary != null && rows[i].primary !== prevPrimary;
    gaps.push(isBoundary ? GROUP_GAP_PX : 0);
    prevPrimary = rows[i].primary;
  }

  return { columnOrder, gaps };
}

/**
 * Order categorical factors by (count of distinct assigned FVs) asc,
 * ties broken via a per-session random. The user-pinned factor (if
 * any) is promoted to the head. Continuous factors are excluded —
 * lexicographic chain only handles categoricals.
 */
function buildFactorChain(
  payload: HeatmapPayload,
  mainGroupingFactorId: number | null,
): Factor[] {
  const r0 = sessionRand();
  const decorated = payload.factors
    .filter((f) => f.type === 'categorical')
    .map((f) => {
      // Count DISTINCT FVs assigned to at least one column in this
      // dataset. Factors with 0 or 1 distinct assignment carry no
      // sort signal and are dropped.
      const seen = new Set<number>();
      for (const col of payload.columns) {
        const fvId = col.factorValueIds[f.id];
        if (fvId != null) seen.add(fvId);
      }
      return { f, count: seen.size };
    })
    .filter((x) => x.count >= 2)
    // Stable random per (session, factor.id) — same dataset within a
    // tab gives the same tie-break order, fresh tab can reshuffle.
    // Keyed on factor id ONLY (not the input index): two surfaces that
    // carry the same factors in a different array order (e.g. the
    // Expression tab in wire order vs. the DE pop-out in design order)
    // must resolve equal-count ties identically, or their grouped
    // sample order would diverge.
    .map((x) => ({
      ...x,
      rnd: hashTo01(`${r0}:${x.f.id}`),
    }))
    .sort((a, b) => a.count - b.count || a.rnd - b.rnd);

  let chain = decorated.map((x) => x.f);
  if (mainGroupingFactorId != null) {
    const pinned = chain.find((f) => f.id === mainGroupingFactorId);
    if (pinned) {
      chain = [pinned, ...chain.filter((f) => f.id !== pinned.id)];
    }
  }
  return chain;
}

/** Map a string deterministically to a number in [0, 1). */
function hashTo01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0xffffffff;
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
