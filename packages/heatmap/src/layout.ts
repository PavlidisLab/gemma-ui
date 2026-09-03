import type { HeatmapConfig, HeatmapData, ResolvedConfig } from './types';
import { DEFAULT_PALETTE } from './palettes';
import { dataExtent } from './color';

const CELL_DEFAULTS = {
  minHeight: 2,
  maxHeight: 12,
  minWidth: 1,
  maxWidth: 13,
};

/** Apply defaults to a user-supplied config, resolving domain for sequential palettes from the data. */
export function resolveConfig(data: HeatmapData, config: HeatmapConfig | undefined): ResolvedConfig {
  const c = config ?? {};
  const palette = c.palette ?? DEFAULT_PALETTE;
  const cell = {
    minHeight: c.cell?.minHeight ?? CELL_DEFAULTS.minHeight,
    maxHeight: c.cell?.maxHeight ?? CELL_DEFAULTS.maxHeight,
    minWidth: c.cell?.minWidth ?? CELL_DEFAULTS.minWidth,
    maxWidth: c.cell?.maxWidth ?? CELL_DEFAULTS.maxWidth,
  };
  // Domain for sequential palettes: respect user override; otherwise infer from data.
  let domain: [number, number] | null = null;
  if (palette.kind === 'sequential') {
    domain = c.domain ?? dataExtent(data.values);
  }
  return {
    palette,
    clip: c.clip ?? 3,
    domain,
    nanColor: c.nanColor ?? '#9ca3af',
    dimColor: c.dimColor ?? 'rgba(100, 116, 139, 0.62)',
    markColor: c.markColor ?? 'rgba(245, 158, 11, 0.22)',
    markGlyphColor: c.markGlyphColor ?? '#f59e0b',
    dimGlyphColor: c.dimGlyphColor ?? '#cbd5e1',
    showRowLabels: c.showRowLabels ?? 'auto',
    showColLabels: c.showColLabels ?? 'auto',
    cell,
    fit: c.fit ?? 'fit',
    square: c.square ?? false,
    fontFamily: c.fontFamily ?? 'Helvetica, Arial, sans-serif',
    maxColLabelPx: c.maxColLabelPx ?? 120,
    annotationStripHeight: c.annotationStripHeight ?? 12,
    annotationStripGap: c.annotationStripGap ?? 2,
  };
}

/**
 * Per-rendered-column source mapping. `srcStart` is the first source column
 * folded into this rendered column (inclusive); `srcCount` is how many were
 * folded in. In the common case (one source col per rendered col) `srcCount`
 * is 1 — but in 'fit' mode with very narrow cells, multiple source columns
 * collapse into one rendered column (mean of values, mode of annotation
 * colors) to keep cells at least `cell.minWidth` wide.
 */
export interface ColumnMap {
  srcStart: number;
  srcCount: number;
}

export interface Layout {
  cellW: number;
  cellH: number;
  numRows: number;
  numCols: number;
  /** One entry per rendered column. */
  columns: ColumnMap[];
  /** Width of the matrix area only (annotation strips share this width). */
  matrixW: number;
  /** Height of the matrix area only (does not include strips). */
  matrixH: number;
}

/**
 * Compute cell sizes and column merging for the matrix area.
 *
 * @param data       Input data (used for row/col counts only).
 * @param config     Resolved config.
 * @param availableW Available CSS pixels for the matrix's horizontal axis.
 *                   In 'expand' mode this is ignored.
 * @param availableH Available CSS pixels for the matrix's vertical axis, or
 *                   `null` to let height equal `numRows * cell.maxHeight`.
 */
/**
 * A cell height that keeps `numRows` of them inside `availableH`.
 *
 * 🛑 `cell.minHeight` is a PREFERENCE, not a licence to overflow. It
 * used to be applied after the box clamp — `max(minHeight, min(side,
 * fitsH))` — so once a matrix had more rows than the box had
 * `minHeight`-sized slots, the floor won and the canvas grew past its
 * container. A 224-row correlation matrix in a 344px box wants 1.5px
 * rows; the floor of 2 made it 448px tall and 104px of it was simply
 * not on screen. Nothing downstream could prevent that: the caller had
 * already passed the height.
 *
 * Sub-pixel rows are the honest answer here — the width axis has always
 * been fractional in `fit` mode — and the absolute floor is one device
 * pixel's worth so a row can never round away to nothing.
 */
function clampToBox(preferred: number, availableH: number, numRows: number): number {
  if (numRows <= 0) return preferred;
  const fits = availableH / numRows;
  if (fits >= preferred) return preferred;
  return Math.max(0.25, fits);
}

export function computeLayout(
  data: HeatmapData,
  config: ResolvedConfig,
  availableW: number,
  availableH: number | null,
): Layout {
  const numRows = data.values.length;
  const numCols = numRows > 0 ? data.values[0].length : 0;

  // --- Vertical sizing ---
  let cellH: number;
  if (availableH == null) {
    cellH = config.cell.maxHeight;
  } else {
    cellH = clampToBox(
      Math.min(config.cell.maxHeight, Math.max(config.cell.minHeight, Math.floor(availableH / Math.max(1, numRows)))),
      availableH,
      numRows,
    );
  }

  // --- Horizontal sizing + column merging ---
  let cellW: number;
  let columns: ColumnMap[];
  if (config.fit === 'expand') {
    cellW = config.cell.maxWidth;
    columns = Array.from({ length: numCols }, (_, i) => ({ srcStart: i, srcCount: 1 }));
  } else {
    const rawW = numCols > 0 ? availableW / numCols : 0;
    if (rawW >= config.cell.minWidth) {
      // Cap at maxWidth so cells don't balloon when the container is much
      // wider than numCols * maxWidth. The matrix then occupies only the
      // space it needs and the rest of the container is empty whitespace,
      // matching what curators expect from a "compact" heatmap.
      cellW = Math.min(rawW, config.cell.maxWidth);
      columns = Array.from({ length: numCols }, (_, i) => ({ srcStart: i, srcCount: 1 }));
    } else {
      // Merge adjacent source columns until each rendered cell is wide enough.
      // increment = how many source cols per rendered col, ceil so we never
      // go below minWidth.
      const increment = Math.max(1, Math.ceil(config.cell.minWidth / Math.max(rawW, 1e-6)));
      const renderedCount = Math.ceil(numCols / increment);
      cellW = numCols > 0 ? availableW / renderedCount : 0;
      columns = [];
      for (let i = 0; i < numCols; i += increment) {
        columns.push({ srcStart: i, srcCount: Math.min(increment, numCols - i) });
      }
    }
  }

  // Square cells: pin height to the computed width (clamped to the
  // configured height bounds) so a symmetric matrix renders 1:1 instead
  // of tall/narrow.
  //
  // 🛑 Still bounded by `availableH`. This used to override the
  // height-derived cellH outright, so a square matrix wider than it is
  // tall grew past the bottom of its container and was simply clipped —
  // no caller could prevent it, because the width is what sets the size
  // and the height was not consulted at all. A 60x60 matrix in a
  // 248px-tall box takes 4px cells however wide the box is.
  //
  // Squareness is preserved, because cellW follows: the matrix gets
  // smaller in both directions rather than becoming tall and narrow,
  // which is what the flag is for.
  if (config.square) {
    let squareSide = Math.min(
      config.cell.maxHeight,
      Math.max(config.cell.minHeight, Math.round(cellW)),
    );
    if (availableH != null && numRows > 0) {
      squareSide = clampToBox(squareSide, availableH, numRows);
    }
    cellH = squareSide;
    cellW = squareSide;
  }

  return {
    cellW,
    cellH,
    numRows,
    numCols,
    columns,
    matrixW: cellW * columns.length,
    matrixH: cellH * numRows,
  };
}

/** Mean of cell values across a merged column span, returning null if all are null/NaN. */
export function meanOverSpan(row: ReadonlyArray<number | null>, start: number, count: number): number | null {
  let sum = 0;
  let n = 0;
  for (let k = 0; k < count; k++) {
    const v = row[start + k];
    if (v == null || Number.isNaN(v)) continue;
    sum += v;
    n++;
  }
  return n === 0 ? null : sum / n;
}

/** Mode (most frequent value) over a span of string-or-null annotation values. */
export function modeOverSpan(arr: ReadonlyArray<string | null>, start: number, count: number): string | null {
  if (count === 1) return arr[start];
  const tally = new Map<string, number>();
  let bestKey: string | null = null;
  let bestCount = 0;
  for (let k = 0; k < count; k++) {
    const v = arr[start + k];
    if (v == null) continue;
    const next = (tally.get(v) ?? 0) + 1;
    tally.set(v, next);
    if (next > bestCount) {
      bestCount = next;
      bestKey = v;
    }
  }
  return bestKey;
}
