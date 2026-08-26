/**
 * Convert a wire `HeatmapPayload` + a main-grouping-factor selection
 * into the v1 `HeatmapData` shape the canvas renderer already
 * consumes — applying column reordering and building one annotation
 * strip per factor.
 *
 * Pure. Never mutates `payload`.
 */
import { computeColumnOrder } from './columnOrder';
import { orderFactorsForDisplay } from './factorOrder';
import { buildCategoricalStrip } from './strips/categorical';
import { buildContinuousStrip } from './strips/continuous';
import type { HeatmapData, AnnotationStrip } from './types';
import { probeRowLabel } from './payload';
import type { HeatmapPayload, HeatmapPayloadColumn } from './payload';

export interface BuildOptions {
  mainGroupingFactorId: number | null;
}

export interface BuiltHeatmap {
  data: HeatmapData;
  /** The reordered `HeatmapPayloadColumn[]` — same length & contents
   *  as `payload.columns` but in render order. */
  columns: HeatmapPayloadColumn[];
  /** Source-column indices in render order. */
  columnOrder: number[];
  /** Per-rendered-column leading gap (px). */
  gaps: number[];
}

export function buildHeatmapDataFromPayload(
  payload: HeatmapPayload,
  opts: BuildOptions,
): BuiltHeatmap {
  const { columnOrder, gaps } = computeColumnOrder(
    payload,
    opts.mainGroupingFactorId,
  );

  // Reorder columns + outlier flags.
  const cols = columnOrder.map((i) => payload.columns[i]);
  const outliers = cols.map((c) => !!c.outlier);

  // Reorder matrix values per row.
  const values = payload.matrix.values.map((row) =>
    columnOrder.map((i) => row[i] ?? null),
  );

  // Build one strip per factor, in the canonical display order
  // (biological before technical, then by factor id) so every surface
  // that renders this payload — Expression tab, DE top-genes pop-out —
  // shows the strips in the same sequence regardless of the order the
  // wire / samples endpoint emitted the factors.
  const colAnnotations: AnnotationStrip[] = orderFactorsForDisplay(
    payload.factors,
  ).map((f) =>
    f.type === 'continuous'
      ? buildContinuousStrip(f, cols)
      : buildCategoricalStrip(f, cols),
  );

  // Resolved gutter text per row. ``probeRowLabel`` owns the whole
  // decision — which genes to name and what to fall back to — and is
  // shared with the surfaces that don't build a HeatmapPayload at all
  // (the PC-loadings popup), so the same probe reads the same way
  // everywhere.
  const rowLabelParts = payload.rows.map((r) => probeRowLabel(r));
  const symbolLabels = rowLabelParts.map((p) => p.symbol);
  const nameLabels = rowLabelParts.map((p) => p.name);

  // Single-string fallback (TSV download + label tooltip use this).
  const rowLabels = symbolLabels;
  // Rich multi-column row labels — optional leading p-value, then
  // symbol, then gene name when available. Renderer auto-aligns columns
  // across rows via CSS grid; we MUST emit a fixed column count per row
  // or grid auto-flow misaligns (empty string keeps the slot, just
  // renders blank).
  const anyName = nameLabels.some((n) => n.length > 0);
  // When any row carries a p-value — the DE top-genes heatmap does —
  // render it as a leading numeric column to the LEFT of the gene
  // symbol.
  const anyPvalue = payload.rows.some(
    (r) => r.pvalue != null && Number.isFinite(r.pvalue),
  );
  const rowLabelColumns: string[][] | undefined =
    anyName || anyPvalue
      ? payload.rows.map((r, i) => {
          const cols: string[] = [];
          if (anyPvalue) cols.push(formatPvalueLabel(r.pvalue));
          cols.push(symbolLabels[i]);
          if (anyName) cols.push(nameLabels[i]);
          return cols;
        })
      : undefined;
  // Parallel per-column kinds so the renderer styles the p-value column
  // as muted mono (and keeps the gene symbol as the emphasised primary).
  const rowLabelColumnKinds: Array<'text' | 'num'> | undefined =
    rowLabelColumns
      ? [
          ...(anyPvalue ? (['num'] as const) : []),
          'text' as const,
          ...(anyName ? (['text'] as const) : []),
        ]
      : undefined;
  const colLabels = cols.map((c) => c.name);

  // Per-row origin disc (e.g. GO-term provenance). Only emit the
  // arrays when at least one row carries an origin — saves
  // downstream code from checking length-zero edge cases.
  const anyOrigin = payload.rows.some((r) => !!r.originColor);
  const rowDotColors = anyOrigin
    ? payload.rows.map((r) => r.originColor ?? null)
    : undefined;
  const rowDotTitles = anyOrigin
    ? payload.rows.map((r) => r.originTitle ?? null)
    : undefined;

  return {
    data: {
      values,
      rowLabels,
      rowLabelColumns,
      rowLabelColumnKinds,
      rowDotColors,
      rowDotTitles,
      colLabels,
      colAnnotations,
      colOutliers: outliers,
      colGapsBefore: gaps,
    },
    columns: cols,
    columnOrder,
    gaps,
  };
}

/** Compact label for a p-value in the row-label gutter. Scientific for
 *  the tiny values DE contrasts produce (``7.7e-8``), fixed-decimal for
 *  the readable middle range. Empty string when absent so the grid slot
 *  stays aligned. */
function formatPvalueLabel(p: number | undefined): string {
  if (p == null || !Number.isFinite(p)) return '';
  if (p <= 0) return '0';
  if (p < 1e-3) return p.toExponential(1); // e.g. 7.7e-8
  if (p < 1) return p.toFixed(3); // e.g. 0.032
  return p.toFixed(2);
}
