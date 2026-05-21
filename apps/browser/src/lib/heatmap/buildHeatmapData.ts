/**
 * Convert a wire `HeatmapPayload` + a main-grouping-factor selection
 * into the v1 `HeatmapData` shape the canvas renderer already
 * consumes — applying column reordering and building one annotation
 * strip per factor.
 *
 * Pure. Never mutates `payload`.
 */
import { computeColumnOrder } from './columnOrder';
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

  // Build one strip per factor, in payload order.
  const colAnnotations: AnnotationStrip[] = payload.factors.map((f) =>
    f.type === 'continuous'
      ? buildContinuousStrip(f, cols)
      : buildCategoricalStrip(f, cols),
  );

  const rowLabels = payload.rows.map(
    (r) => r.geneSymbols[0] ?? r.designElementName,
  );
  const colLabels = cols.map((c) => c.name);

  return {
    data: {
      values,
      rowLabels,
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
