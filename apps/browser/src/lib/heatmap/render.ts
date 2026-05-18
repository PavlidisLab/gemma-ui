import { makeColorScale } from './color';
import { computeLayout, meanOverSpan, modeOverSpan, resolveConfig } from './layout';
import type {
  CellGeometry,
  HeatmapConfig,
  HeatmapData,
  RenderResult,
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

  const annotations = data.colAnnotations ?? [];
  const stripsH = annotations.length * resolved.annotationStripHeight;
  const gapAfterStrips = annotations.length > 0 ? 4 : 0;

  const totalW = layout.matrixW;
  const totalH = stripsH + gapAfterStrips + layout.matrixH;

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
  for (let s = 0; s < annotations.length; s++) {
    const strip = annotations[s];
    const y = s * resolved.annotationStripHeight;
    for (let r = 0; r < layout.columns.length; r++) {
      const { srcStart, srcCount } = layout.columns[r];
      const value = srcCount === 1
        ? strip.values[srcStart]
        : modeOverSpan(strip.values, srcStart, srcCount);
      const color = value != null ? (strip.palette[value] ?? resolved.nanColor) : resolved.nanColor;
      ctx.fillStyle = color;
      ctx.fillRect(r * layout.cellW, y, layout.cellW, resolved.annotationStripHeight);
    }
  }

  // --- Matrix ---
  const matrixY = stripsH + gapAfterStrips;
  const colorOf = makeColorScale(resolved);
  const cells: CellGeometry[] = [];

  for (let i = 0; i < layout.numRows; i++) {
    const row = data.values[i];
    const y = matrixY + i * layout.cellH;
    for (let r = 0; r < layout.columns.length; r++) {
      const { srcStart, srcCount } = layout.columns[r];
      const v = srcCount === 1 ? row[srcStart] : meanOverSpan(row, srcStart, srcCount);
      ctx.fillStyle = colorOf(v);
      const x = r * layout.cellW;
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

  const matrix = { x: 0, y: matrixY, w: layout.matrixW, h: layout.matrixH };

  const cellAt = (x: number, y: number): CellGeometry | null => {
    if (x < matrix.x || x >= matrix.x + matrix.w) return null;
    if (y < matrix.y || y >= matrix.y + matrix.h) return null;
    const ry = y - matrix.y;
    const row = Math.floor(ry / layout.cellH);
    const colIdx = Math.floor(x / layout.cellW);
    if (row < 0 || row >= layout.numRows) return null;
    if (colIdx < 0 || colIdx >= layout.columns.length) return null;
    const { srcStart, srcCount } = layout.columns[colIdx];
    return {
      row,
      col: srcStart,
      mergedCols: srcCount,
      x: colIdx * layout.cellW,
      y: matrix.y + row * layout.cellH,
      w: layout.cellW,
      h: layout.cellH,
    };
  };

  return { width: totalW, height: totalH, matrix, cells, cellAt };
}
