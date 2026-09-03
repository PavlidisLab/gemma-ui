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

/** Width of the margin outside the plot that outlier markers sit in.
 *  Zero when nothing is marked, so an ordinary heatmap is unchanged.
 *
 *  🛑 Exported because the React wrapper sizes the matrix grid column
 *  itself. It computed that width from `layout.matrixW` alone, so the
 *  canvas overflowed its column by exactly this margin and the row
 *  labels were dragged across the plot. Both must add the same number.
 */
export const MARK_GUTTER_PX = 11;

/** The gutter this data needs: markers, staged or saved, or nothing. */
export function markGutterFor(data: HeatmapData): number {
  const any =
    data.markRows?.some(Boolean) || data.dimRows?.some(Boolean) || false;
  return any ? MARK_GUTTER_PX : 0;
}

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
  // 🛑 Outlier markers get their own gutter OUTSIDE the plot. Paul,
  // 2026-09-02: *"it can't be _in_ the heatmap, because it might be
  // invisible. It has to be on the edge."* Drawn over the outermost
  // cells they landed on whatever colour happened to be there, which on
  // a blackbody ramp is sometimes amber. The whole canvas is shifted by
  // this margin and every existing coordinate stays in matrix space.
  const markGut = markGutterFor(data);
  const totalW = cursorX + markGut;
  const totalH = stripsBlockH + gapAfterStrips + layout.matrixH + markGut;

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
  // Everything below draws in matrix space; the gutter is the margin
  // the markers live in, at negative coordinates.
  ctx.translate(markGut, markGut);
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

  // --- Flagged rows: marked whether or not they are masked ---
  //
  // 🛑 Paul, 2026-09-02: *"even when outliers are 'unmasked', they
  // should be marked clearly, especially in the curation interface."*
  // Unmasking put the real correlations back and took away every trace
  // that the sample was flagged, so the one view a curator opens to
  // JUDGE a flag was the view that stopped showing it.
  //
  // A tint, not a wash: the whole point of unmasking is to read those
  // values, so the mark has to be visible without competing with them.
  // Over a masked (grey) row it still reads, and says the grey is a
  // flagged sample rather than missing data.
  const marked = data.markRows;
  if (marked && marked.some(Boolean)) {
    ctx.save();
    ctx.fillStyle = resolved.markColor;
    for (let i = 0; i < layout.numRows; i++) {
      if (!marked[i]) continue;
      ctx.fillRect(0, matrixY + i * layout.cellH, totalW, layout.cellH);
    }
    for (let r = 0; r < layout.columns.length; r++) {
      if (!marked[layout.columns[r].srcStart]) continue;
      ctx.fillRect(xs[r], matrixY, layout.cellW, layout.numRows * layout.cellH);
    }
    // 🛑 A DIAMOND, not a triangle. The right-pointing triangle in the
    // label gutter already means "this is the strip the columns are
    // grouped by" — two different facts sharing one shape is how a
    // reader learns to distrust both.
    //
    // In the gutter, at negative coordinates: outside the plot, so the
    // mark never has to compete with a cell colour, and legible at any
    // cell size because it does not shrink with the cells.
    ctx.fillStyle = resolved.markGlyphColor;
    const g = MARK_GUTTER_PX - 3;
    const diamond = (cx: number, cy: number) => {
      ctx.beginPath();
      ctx.moveTo(cx, cy - g / 2);
      ctx.lineTo(cx + g / 2, cy);
      ctx.lineTo(cx, cy + g / 2);
      ctx.lineTo(cx - g / 2, cy);
      ctx.closePath();
      ctx.fill();
    };
    for (let i = 0; i < layout.numRows; i++) {
      if (!marked[i]) continue;
      diamond(-MARK_GUTTER_PX / 2, matrixY + i * layout.cellH + layout.cellH / 2);
    }
    for (let r = 0; r < layout.columns.length; r++) {
      if (!marked[layout.columns[r].srcStart]) continue;
      diamond(xs[r] + layout.cellW / 2, -MARK_GUTTER_PX / 2);
    }
    ctx.restore();
  }

  // --- Proposed rows: a veil, not a blanking ---
  //
  // 🛑 A PROPOSAL is not a fact. Blanking a row says the sample is
  // already excluded; a veil says someone has asked for it and the data
  // is still there to argue with. Both axes, because the matrix is
  // symmetric and veiling one would leave the sample's correlations
  // fully saturated on the other.
  //
  // Drawn after the cells and before the labels so it dims the colour
  // without touching anything a reader needs to stay crisp.
  const dim = data.dimRows;
  if (dim && dim.some(Boolean)) {
    ctx.save();
    ctx.fillStyle = resolved.dimColor;
    for (let i = 0; i < layout.numRows; i++) {
      if (!dim[i]) continue;
      ctx.fillRect(0, matrixY + i * layout.cellH, totalW, layout.cellH);
    }
    for (let r = 0; r < layout.columns.length; r++) {
      if (!dim[layout.columns[r].srcStart]) continue;
      ctx.fillRect(xs[r], matrixY, layout.cellW, layout.numRows * layout.cellH);
    }
    // The same diamond as a saved flag, HOLLOW — Paul, 2026-09-02:
    // *"clicking on a sample to mark it an outlier should add those
    // glyphs."* Same shape because it is the same fact being asserted;
    // outlined rather than filled because it has not happened yet.
    ctx.strokeStyle = resolved.dimGlyphColor;
    ctx.lineWidth = 1.5;
    const dg = MARK_GUTTER_PX - 4;
    const hollow = (cx: number, cy: number) => {
      ctx.beginPath();
      ctx.moveTo(cx, cy - dg / 2);
      ctx.lineTo(cx + dg / 2, cy);
      ctx.lineTo(cx, cy + dg / 2);
      ctx.lineTo(cx - dg / 2, cy);
      ctx.closePath();
      ctx.stroke();
    };
    for (let i = 0; i < layout.numRows; i++) {
      if (!dim[i]) continue;
      hollow(-MARK_GUTTER_PX / 2, matrixY + i * layout.cellH + layout.cellH / 2);
    }
    for (let r = 0; r < layout.columns.length; r++) {
      if (!dim[layout.columns[r].srcStart]) continue;
      hollow(xs[r] + layout.cellW / 2, -MARK_GUTTER_PX / 2);
    }
    ctx.restore();
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

  const matrix = { x: markGut, y: matrixY + markGut, w: totalW - markGut, h: layout.matrixH };

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
    // `xs` is matrix space; the gutter has to come off before the lookup.
    const colIdx = findRenderedCol(x - markGut);
    if (colIdx < 0) return null;
    if (row < 0 || row >= layout.numRows) return null;
    const { srcStart, srcCount } = layout.columns[colIdx];
    return {
      row,
      col: srcStart,
      mergedCols: srcCount,
      x: xs[colIdx] + markGut,
      y: matrix.y + row * layout.cellH,
      w: layout.cellW,
      h: layout.cellH,
    };
  };

  const stripAt = (x: number, y: number): StripHit | null => {
    if (stripRects.length === 0) return null;
    x -= markGut;
    y -= markGut;
    if (x < 0 || x >= totalW - markGut) return null;
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
    // Reported in CANVAS space, like `matrix` — a consumer positioning
    // an overlay measures from the canvas, not from the plot.
    strips: stripRects.map((r) => ({ ...r, x: r.x + markGut, y: r.y + markGut })),
    cells: cells.map((c) => ({ ...c, x: c.x + markGut, y: c.y + markGut })),
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
