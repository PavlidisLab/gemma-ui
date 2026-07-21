/**
 * Sample-correlation helpers — turn the wire matrix into the shape the
 * @gemma/heatmap widget consumes, and pick a sensible sequential-palette
 * domain. Curation and browser both want the same numerical treatment
 * (NaN out the diagonal so r=1 doesn't saturate the palette; floor the
 * observed minimum to a nice fraction below).
 */

import type { HeatmapData } from "@gemma/heatmap";
import { DIAGNOSTICS_PANEL_BODY_PX, HEATMAP_LEGEND_ZONE_PX } from "./PanelCard";

/**
 * Cell size (CSS px) for the square sample-correlation matrix so it
 * fills the fixed-height panel body for ANY sample count. The matrix is
 * square (N×N) and lives below a fixed legend/padding zone; sizing each
 * cell to `(bodyHeight − legendZone) / N` makes the matrix span the
 * remaining box height whether there are 6 samples or 300. Falls back to
 * a small default when the count is unknown/zero. Fed to the heatmap
 * widget as `defaultMaxWidth`/`defaultMaxHeight`; on narrow viewports the
 * widget still clamps width-first, so the square just shrinks (leaving
 * vertical slack) rather than overflowing.
 */
export function sampleCorrelationCellPx(
  sampleCount: number | undefined | null,
): number {
  if (!sampleCount || sampleCount <= 0) return 6;
  const matrixAreaPx = DIAGNOSTICS_PANEL_BODY_PX - HEATMAP_LEGEND_ZONE_PX;
  return matrixAreaPx / sampleCount;
}

export interface SampleCorrelationInput {
  bioAssayIds: number[];
  /** Parallel to `bioAssayIds`. May contain nulls for assays whose
   *  short-name hasn't been set on the Gemma side. */
  bioAssayShortNames: (string | null)[];
  /** Row-major N×N symmetric matrix; values in [-1, 1]. */
  values: number[][];
}

/** Reshape the wire matrix into HeatmapData; NaN-mask the diagonal. */
export function buildSampleCorrelationHeatmapData(
  data: SampleCorrelationInput | null,
): HeatmapData | null {
  if (!data || data.values.length === 0) return null;
  const labels = data.bioAssayShortNames.map(
    (s, i) => s || String(data.bioAssayIds[i] ?? i),
  );
  // Coerce each cell — some Gemma builds return numbers as JSON
  // strings, which the widget's ``v.toFixed(2)`` formatter cannot
  // handle. ``Number()`` parses numeric strings; non-finite results
  // (NaN from "—" / null / undefined) become null so the heatmap
  // renders them as the NA colour.
  const values: (number | null)[][] = data.values.map((row, i) =>
    row.map((v, j) => {
      if (i === j) return null;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    }),
  );
  return {
    rowLabels: labels,
    colLabels: labels,
    values,
  } satisfies HeatmapData;
}

/** Pick a sequential-palette domain for the heatmap. Sample
 *  correlations typically sit in [0.85, 1.0]; mapping the full
 *  [-1, 1] would collapse contrast. Set the lower bound to hug just
 *  below the observed off-diagonal minimum (the value furthest from
 *  1.0) — a 0.01 cushion, rounded to two decimals — so the palette
 *  spends its full range on the actual spread instead of a coarse 0.1
 *  grid, while the darkest cell stays a hair inside the scale rather
 *  than pinned to the palette's extreme end. Upper bound is always
 *  1.0. Returns `undefined` when there's no data so the widget falls
 *  back to its default. */
export function computeSampleCorrelationDomain(
  values: number[][] | null | undefined,
): [number, number] | undefined {
  if (!values?.length) return undefined;
  let lo = 1;
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    for (let j = 0; j < row.length; j++) {
      if (i === j) continue;
      const v = row[j];
      if (typeof v === "number" && !Number.isNaN(v) && v < lo) lo = v;
    }
  }
  // `Math.round` (not `Math.floor`) on the cushioned value dodges the
  // float-precision off-by-one that `floor(x * 100) / 100` hits when
  // `x * 100` lands a hair under an integer. The 0.01 subtraction keeps
  // the bound strictly below `lo` even after rounding.
  const lowerBound = Math.round((lo - 0.01) * 100) / 100;
  return [Math.max(-1, lowerBound), 1.0];
}

/** Outlier footer caption — quiet slate when no outliers; amber when
 *  the detector predicted something the curator hasn't acted on yet
 *  (predicted ⊄ actual). Curator wrappers can override by passing
 *  their own footer to PanelCard with additional "Mark / Unmark"
 *  affordances; the public read-only wrapper uses this default. */
export function summariseOutliers(
  actual: number[],
  predicted: number[],
): {
  empty: boolean;
  unactedPredicted: number;
  text: string;
} {
  const actualSet = new Set(actual);
  const unactedPredicted = predicted.filter((id) => !actualSet.has(id)).length;
  if (actual.length === 0 && predicted.length === 0) {
    return {
      empty: true,
      unactedPredicted: 0,
      text: "no outliers removed nor detected",
    };
  }
  const tail =
    unactedPredicted > 0 ? ` (${unactedPredicted} unflagged)` : "";
  return {
    empty: false,
    unactedPredicted,
    text: `${actual.length} removed · ${predicted.length} detected${tail}`,
  };
}
