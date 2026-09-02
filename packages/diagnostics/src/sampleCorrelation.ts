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
  /** How many annotation strips sit above the matrix. Each costs
   *  `ANNOTATION_STRIP_PX` plus a gap, and they are drawn INSIDE the
   *  same box the cells have to fit in.
   *
   *  🛑 A constant cannot cover this. The zone above the matrix used to
   *  be one number, which was right while the only thing up there was a
   *  legend — then the panel grew one strip per design factor and the
   *  matrix ran off the bottom of the card, by exactly the height of
   *  the strips nobody had subtracted. */
  stripCount = 0,
): number {
  if (!sampleCount || sampleCount <= 0) return 6;
  const stripsPx =
    stripCount > 0
      ? stripCount * ANNOTATION_STRIP_PX +
        (stripCount - 1) * ANNOTATION_STRIP_GAP_PX +
        STRIP_TO_MATRIX_GAP_PX
      : 0;
  const matrixAreaPx =
    DIAGNOSTICS_PANEL_BODY_PX - HEATMAP_LEGEND_ZONE_PX - stripsPx;
  return Math.max(2, matrixAreaPx / sampleCount);
}

/** Mirrors the heatmap package's own defaults (`layout.ts`:
 *  `annotationStripHeight` 12, `annotationStripGap` 2, plus the 4px it
 *  leaves between the last strip and the matrix). Duplicated rather
 *  than imported because they are resolved config there, not exports —
 *  if they move, this over- or under-shoots and the matrix stops
 *  meeting the bottom of its box. */
const ANNOTATION_STRIP_PX = 12;
const ANNOTATION_STRIP_GAP_PX = 2;
const STRIP_TO_MATRIX_GAP_PX = 4;

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

/** Pick a sequential-palette domain for the heatmap.
 *
 *  Both ends come from the data, over off-diagonal cells only.
 *
 *  🛑 The upper bound used to be pinned at 1.0, and it cost most of the
 *  palette. The diagonal is excluded from the picture, so r never
 *  reaches 1: measured on eid 40086, the off-diagonal cells run
 *  0.648-0.884, which put the entire real spread in the bottom
 *  two-thirds of the ramp and spent the top 12% on values that do not
 *  exist. Gemma 1.0's version of this plot looks more contrasty for
 *  exactly this reason — it scales to what is there.
 *
 *  The lower bound is the 2.5th percentile rather than the minimum, so
 *  one unusually dissimilar PAIR cannot stretch the scale and flatten
 *  everything else. Cells below it saturate at the palette's dark end,
 *  which still reads as "least similar" — and how far below is not a
 *  question this plot answers anyway: the outlier lists in the footer
 *  are what name a bad sample.
 *
 *  Returns `undefined` when there is no usable data so the widget falls
 *  back to its own default. */
export function computeSampleCorrelationDomain(
  values: number[][] | null | undefined,
): [number, number] | undefined {
  if (!values?.length) return undefined;
  const off: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    for (let j = 0; j < row.length; j++) {
      if (i === j) continue;
      const v = row[j];
      // Non-finite cells are masked samples and missing data — never
      // scale to them.
      if (typeof v === "number" && Number.isFinite(v)) off.push(v);
    }
  }
  if (off.length === 0) return undefined;
  off.sort((a, b) => a - b);
  const lo = off[Math.floor(0.025 * (off.length - 1))];
  const hi = off[off.length - 1];
  // A degenerate spread (every cell equal) would map every value to one
  // end of the ramp; give it a hair of range so the plot is flat rather
  // than black.
  if (!(hi > lo)) return [lo - 0.01, lo + 0.01];
  return [Math.max(-1, lo), Math.min(1, hi)];
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
