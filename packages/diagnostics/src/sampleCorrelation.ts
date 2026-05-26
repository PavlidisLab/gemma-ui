/**
 * Sample-correlation helpers — turn the wire matrix into the shape the
 * @gemma/heatmap widget consumes, and pick a sensible sequential-palette
 * domain. Curation and browser both want the same numerical treatment
 * (NaN out the diagonal so r=1 doesn't saturate the palette; floor the
 * observed minimum to a nice fraction below).
 */

import type { HeatmapData } from "@gemma/heatmap";

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
  const values: (number | null)[][] = data.values.map((row, i) =>
    row.map((v, j) => (i === j ? null : v)),
  );
  return {
    rowLabels: labels,
    colLabels: labels,
    values,
  } satisfies HeatmapData;
}

/** Pick a sequential-palette domain for the heatmap. Sample
 *  correlations typically sit in [0.85, 1.0]; mapping the full
 *  [-1, 1] would collapse contrast. Floor observed off-diagonal min
 *  to the next 0.1 below (with a 0.05 cushion) and always pin the
 *  upper bound at 1.0. Returns `undefined` when there's no data so
 *  the widget falls back to its default. */
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
  const floored = Math.floor((lo - 0.05) * 10) / 10;
  return [Math.max(-1, floored), 1.0];
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
