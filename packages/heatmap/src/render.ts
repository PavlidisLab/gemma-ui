import { makeColorScale } from './color';
import { computeLayout, meanOverSpan, modeOverSpan, resolveConfig } from './layout';
import { projectContinuous, projectedDomain } from './strips/continuous';
import type {
  AnnotationStrip,
  CellGeometry,
  HeatmapConfig,
  HeatmapData,
  RenderResult,
  ResolvedConfig,
  StripHit,
} from './types';

export interface RenderOptions {
  /** Available width in CSS pixels for the matrix area. */
  availableW: number;
  /** Available height in CSS pixels for the matrix area, or `null` to let it expand. */
  availableH: number | null;
  /** Device pixel ratio override (defaults to `window.devicePixelRatio` or 1). */
  dpr?: number;
}

/**
 * Render annotation strips + the matrix into a canvas.
 *
 * The canvas is resized to fit the rendered content (backing store scaled by
 * DPR, CSS size kept at logical pixels). Labels (row/column) and the
 * value-scale legend are NOT drawn here — they live in the React wrapper as
 * HTML so they stay copyable and accessible.
 *
 * Returns the resulting geometry, including a `cellAt(x, y)` hit-tester that
 * takes canvas-relative CSS coordinates.
 */
export function renderMatrix(
  canvas: HTMLCanvasElement,
  data: HeatmapData,
  config: HeatmapConfig | undefined,
  opts: RenderOptions,
): RenderResult {
  const resolved = resolveConfig(data, config);
  const layout = computeLayout(data, resolved, opts.availableW, opts.availableH);

  const annotations: AnnotationStrip[] = data.colAnnotations ?? [];
  // Per-strip rendered height: compact categorical strips render
  // at half the configured strip height so batch / block surface
  // without competing visually with biological factors.
  const stripHeights = annotations.map((a) =>
    a.kind === 'categorical' && a.compact
      ? Math.max(4, Math.floor(resolved.annotationStripHeight / 2))
      : resolved.annotationStripHeight,
  );
  const stripsBlockH =
    annotations.length === 0
      ? 0
      : stripHeights.reduce((s, h) => s + h, 0) +
        (annotations.length - 1) * resolved.annotationStripGap;
  const gapAfterStrips = annotations.length > 0 ? 4 : 0;

  // Compute per-rendered-column x positions, factoring in any
  // `colGapsBefore` entries from the v2 main-grouping reorder. Gaps
  // are read from the SOURCE column index of each rendered cell
  // (i.e. `colGapsBefore[srcStart]`). Merged cells just take the gap
  // of their first source column.
  const xs = new Array<number>(layout.columns.length);
  const gapsBefore = data.colGapsBefore;
  let cursorX = 0;
  for (let r = 0; r < layout.columns.length; r++) {
    const { srcStart } = layout.columns[r];
    const g = gapsBefore?.[srcStart] ?? 0;
    // Spec: no leading gap on the very first rendered column.
    cursorX += r === 0 ? 0 : g;
    xs[r] = cursorX;
    cursorX += layout.cellW;
  }
  const totalW = cursorX;
  const totalH = stripsBlockH + gapAfterStrips + layout.matrixH;

  const dpr = opts.dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);

  // Backing store: device pixels. CSS box: logical pixels.
  canvas.width = Math.max(1, Math.round(totalW * dpr));
  canvas.height = Math.max(1, Math.round(totalH * dpr));
  canvas.style.width = `${totalW}px`;
  canvas.style.height = `${totalH}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('renderMatrix: 2D canvas context unavailable');
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, totalW, totalH);
  // Crisp rectangles: disable smoothing (only matters if cells are sub-pixel).
  ctx.imageSmoothingEnabled = false;

  // --- Annotation strips ---
  const stripRects: Array<{ x: number; y: number; w: number; h: number }> = [];
  let stripCursorY = 0;
  for (let s = 0; s < annotations.length; s++) {
    const strip = annotations[s];
    const h = stripHeights[s];
    const y = stripCursorY;
    stripRects.push({ x: 0, y, w: totalW, h });
    if (strip.kind === 'continuous') {
      renderContinuousStrip(ctx, strip, layout, xs, y, h, resolved);
    } else {
      renderCategoricalStrip(ctx, strip, layout, xs, y, h, resolved);
    }
    stripCursorY += h + (s < annotations.length - 1 ? resolved.annotationStripGap : 0);
  }

  // --- Matrix ---
  const matrixY = stripsBlockH + gapAfterStrips;
  const colorOf = makeColorScale(resolved);
  const cells: CellGeometry[] = [];

  for (let i = 0; i < layout.numRows; i++) {
    const row = data.values[i];
    const y = matrixY + i * layout.cellH;
    for (let r = 0; r < layout.columns.length; r++) {
      const { srcStart, srcCount } = layout.columns[r];
      const v = srcCount === 1 ? row[srcStart] : meanOverSpan(row, srcStart, srcCount);
      ctx.fillStyle = colorOf(v);
      const x = xs[r];
      ctx.fillRect(x, y, layout.cellW, layout.cellH);
      cells.push({
        row: i,
        col: srcStart,
        mergedCols: srcCount,
        x,
        y,
        w: layout.cellW,
        h: layout.cellH,
      });
    }
  }

  // --- Outlier indicator ---
  const outliers = data.colOutliers;
  if (outliers && outliers.length > 0) {
    ctx.save();
    ctx.strokeStyle = '#ef4444'; // red-500
    ctx.lineWidth = 1;
    for (let r = 0; r < layout.columns.length; r++) {
      const { srcStart, srcCount } = layout.columns[r];
      // Treat the merged-column case as outlier if ANY source col is
      // outlier — surfaces the flag even after sub-pixel merging.
      let isOutlier = false;
      for (let k = 0; k < srcCount; k++) {
        if (outliers[srcStart + k]) {
          isOutlier = true;
          break;
        }
      }
      if (!isOutlier) continue;
      const x = xs[r] + 0.5;
      const y0 = 0 + 0.5;
      const y1 = matrixY + layout.matrixH - 0.5;
      ctx.strokeRect(x, y0, layout.cellW - 1, y1 - y0);
    }
    ctx.restore();
  }

  const matrix = { x: 0, y: matrixY, w: totalW, h: layout.matrixH };

  // Hit testing — convert canvas-relative CSS coords to a cell.
  // We binary-search `xs[]` since the rendered columns are not
  // evenly spaced when gaps are present.
  const findRenderedCol = (x: number): number => {
    // Linear scan is plenty fast at typical column counts (<10000).
    // `xs` is monotone increasing; bail as soon as we pass the point.
    for (let r = 0; r < layout.columns.length; r++) {
      const left = xs[r];
      const right = left + layout.cellW;
      if (x >= left && x < right) return r;
      if (x < left) return -1; // landed inside a gap
    }
    return -1;
  };

  const cellAt = (x: number, y: number): CellGeometry | null => {
    if (x < matrix.x || x >= matrix.x + matrix.w) return null;
    if (y < matrix.y || y >= matrix.y + matrix.h) return null;
    const ry = y - matrix.y;
    const row = Math.floor(ry / layout.cellH);
    const colIdx = findRenderedCol(x);
    if (colIdx < 0) return null;
    if (row < 0 || row >= layout.numRows) return null;
    const { srcStart, srcCount } = layout.columns[colIdx];
    return {
      row,
      col: srcStart,
      mergedCols: srcCount,
      x: xs[colIdx],
      y: matrix.y + row * layout.cellH,
      w: layout.cellW,
      h: layout.cellH,
    };
  };

  const stripAt = (x: number, y: number): StripHit | null => {
    if (stripRects.length === 0) return null;
    if (x < 0 || x >= totalW) return null;
    if (y < 0 || y >= stripsBlockH + gapAfterStrips) return null;
    // Find which strip band the y-coord is in.
    let stripIndex = -1;
    for (let s = 0; s < stripRects.length; s++) {
      const r = stripRects[s];
      if (y >= r.y && y < r.y + r.h) {
        stripIndex = s;
        break;
      }
    }
    if (stripIndex < 0) return null;
    const colIdx = findRenderedCol(x);
    if (colIdx < 0) return null;
    const { srcStart, srcCount } = layout.columns[colIdx];
    return {
      stripIndex,
      col: srcStart,
      mergedCols: srcCount,
      x: xs[colIdx],
      y: stripRects[stripIndex].y,
      w: layout.cellW,
      h: stripRects[stripIndex].h,
    };
  };

  return {
    width: totalW,
    height: totalH,
    matrix,
    strips: stripRects,
    cells,
    cellAt,
    stripAt,
  };
}

function renderCategoricalStrip(
  ctx: CanvasRenderingContext2D,
  strip: Extract<AnnotationStrip, { kind?: 'categorical' }>,
  layout: ReturnType<typeof computeLayout>,
  xs: number[],
  y: number,
  stripH: number,
  resolved: ResolvedConfig,
): void {
  for (let r = 0; r < layout.columns.length; r++) {
    const { srcStart, srcCount } = layout.columns[r];
    const value =
      srcCount === 1
        ? strip.values[srcStart]
        : modeOverSpan(strip.values, srcStart, srcCount);
    const color =
      value != null ? (strip.palette[value] ?? resolved.nanColor) : resolved.nanColor;
    ctx.fillStyle = color;
    ctx.fillRect(xs[r], y, layout.cellW, stripH);
  }
}

function renderContinuousStrip(
  ctx: CanvasRenderingContext2D,
  strip: Extract<AnnotationStrip, { kind: 'continuous' }>,
  layout: ReturnType<typeof computeLayout>,
  xs: number[],
  y: number,
  stripH: number,
  resolved: ResolvedConfig,
): void {
  // Build a per-strip color sampler that respects the strip's
  // scale + palette (independent of the main matrix palette).
  const [lo, hi] = projectedDomain(strip.scale);
  const sampler = makeColorScale({
    palette: strip.palette,
    clip: 1, // only used for diverging palettes; projectContinuous already maps to [-1,1]
    domain: strip.palette.kind === 'sequential' ? [lo, hi] : null,
    nanColor: resolved.nanColor,
  } as ResolvedConfig);

  for (let r = 0; r < layout.columns.length; r++) {
    const { srcStart, srcCount } = layout.columns[r];
    // For merged spans we mean the projected values (the
    // straightforward extension of `meanOverSpan` but for continuous-
    // strip values rather than the matrix).
    let projected: number | null;
    if (srcCount === 1) {
      projected = projectContinuous(strip.values[srcStart], strip.scale);
    } else {
      let sum = 0;
      let n = 0;
      for (let k = 0; k < srcCount; k++) {
        const p = projectContinuous(strip.values[srcStart + k], strip.scale);
        if (p == null || Number.isNaN(p)) continue;
        sum += p;
        n++;
      }
      projected = n === 0 ? null : sum / n;
    }
    ctx.fillStyle = sampler(projected);
    ctx.fillRect(xs[r], y, layout.cellW, stripH);
  }
}
