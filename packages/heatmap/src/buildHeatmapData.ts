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

  // Single-string fallback (TSV download + label tooltip use this).
  const rowLabels = payload.rows.map(
    (r) => r.geneSymbols[0] ?? r.designElementName,
  );
  // Rich multi-column row labels — symbol + gene name when available.
  // Renderer auto-aligns columns across rows via CSS grid; we MUST
  // emit a fixed column count per row or grid auto-flow misaligns
  // (empty string keeps the slot, just renders blank).
  const anyName = payload.rows.some(
    (r) => (r.geneNames ?? []).some((n) => n && n.length > 0),
  );
  const rowLabelColumns: string[][] | undefined = anyName
    ? payload.rows.map((r) => [
        r.geneSymbols[0] ?? r.designElementName,
        r.geneNames?.[0] ?? '',
      ])
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
