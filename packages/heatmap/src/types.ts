/**
 * Public types for the heatmap library.
 *
 * The library is framework-agnostic at the core (a canvas renderer that takes
 * a typed data object + config) and ships a thin React wrapper alongside.
 */

/** A single cell value. `null` is treated as missing (rendered as `nanColor`). */
export type CellValue = number | null;

/**
 * A categorical annotation strip drawn above the heatmap columns
 * (or beside the rows, once row annotations land — colAnnotations only for v1).
 *
 * `values[i]` is the category for column `i`. `palette[v]` is the color for
 * category `v`; categories absent from the palette fall back to `nanColor`.
 */
export interface CategoricalAnnotation {
  name: string;
  values: Array<string | null>;
  /** Map of category value -> CSS color. Missing keys render as `nanColor`. */
  palette: Record<string, string>;
  /** Discriminator. Optional in v1 inputs (the renderer treats
   *  missing as 'categorical'); v2 builders set it explicitly. */
  kind?: 'categorical';
  /** Optional factor id — set when the strip was built from a
   *  payload `Factor`. Drives main-grouping click + side panel. */
  factorId?: number;
}

/**
 * A continuous annotation strip — per-column numeric value rendered
 * through a sequential or diverging palette (see HEATMAP_SPEC §3.2).
 * Built by `buildContinuousStrip` from a `Factor` of `type:
 * 'continuous'` + the payload columns.
 */
export interface ContinuousAnnotation {
  name: string;
  kind: 'continuous';
  /** Per-column numeric value. `null` paints as `nanColor`. */
  values: Array<number | null>;
  /** Scale used to map values into the palette domain. */
  scale: ContinuousScale;
  palette: Palette;
  /** Optional factor id — set when the strip was built from a
   *  payload `Factor`. */
  factorId?: number;
  /** Parsed unit (e.g. "years") from `Factor.name` if present.
   *  Used by tooltips / side panel. */
  unit?: string | null;
}

/** How a continuous strip's numeric values map onto the palette. */
export type ContinuousScale =
  | { kind: 'linear'; domain: [number, number] }
  | { kind: 'log10'; domain: [number, number] }
  | { kind: 'diverging'; absMax: number };

export type AnnotationStrip = CategoricalAnnotation | ContinuousAnnotation;

export interface HeatmapData {
  /** Row-major value matrix. `values[row][col]`. All rows must be the same length. */
  values: CellValue[][];
  rowLabels?: string[];
  colLabels?: string[];
  colAnnotations?: AnnotationStrip[];
  /** Per-column outlier flag — drives the §3.3 red vertical stripe. */
  colOutliers?: boolean[];
  /** Per-rendered-column gap, in CSS pixels. Used by main-grouping
   *  reorder to separate FV groups; layout reads this to insert
   *  empty space *before* the rendered column at that index.
   *  Length should equal source columns; index 0 is ignored. */
  colGapsBefore?: number[];
}

/**
 * A color palette.
 *
 * - `diverging`: data is signed; `stops` is a left→right ramp through zero.
 *   Values are clipped to `±clip` (config) before sampling.
 * - `sequential`: data is unsigned (or signed but rendered without a zero
 *   midpoint); `stops` is a low→high ramp, sampling from `domain[0]` to
 *   `domain[1]` (config; defaults computed from the data).
 *
 * `stops` is sampled with nearest-neighbor binning, matching the legacy
 * Gemma heatmap behavior (no interpolation between stops — keeps the look
 * crisp and posterized).
 */
export type Palette =
  | { kind: 'diverging'; stops: string[] }
  | { kind: 'sequential'; stops: string[] };

export interface HeatmapConfig {
  /** Default: PALETTES.ambsky (diverging amber→black→sky). */
  palette?: Palette;
  /** Clip diverging values to ±clip. Default 3. Ignored for sequential. */
  clip?: number;
  /** Domain [lo, hi] for sequential palettes. Default: data min/max. */
  domain?: [number, number];
  /** Color for null / NaN cells. Default '#9ca3af' (gray-400). */
  nanColor?: string;
  /** Show row labels (HTML, to keep them copyable). Default 'auto'. */
  showRowLabels?: boolean | 'auto';
  /** Show column labels (rotated -90° on canvas). Default 'auto'. */
  showColLabels?: boolean | 'auto';
  /** Cell size constraints. */
  cell?: {
    minHeight?: number;
    maxHeight?: number;
    minWidth?: number;
    maxWidth?: number;
  };
  /**
   * How to size cells horizontally:
   * - 'fit'   : cells share the available width (squeezes sub-pixel columns).
   * - 'expand': cells are fixed at `cell.maxWidth` (default 10), heatmap may
   *             overflow horizontally.
   * Default 'fit'.
   */
  fit?: 'fit' | 'expand';
  /** Font family for labels. Default 'Helvetica, Arial, sans-serif'. */
  fontFamily?: string;
  /** Max pixels reserved for column labels. Default 220. */
  maxColLabelPx?: number;
  /** Per-annotation-strip height. Default 10. */
  annotationStripHeight?: number;
  /** Vertical gap (in CSS px) between adjacent annotation strips and
   *  between the strip stack and the matrix. Adds breathing room when
   *  multiple categorical annotations stack above the matrix. Default 2. */
  annotationStripGap?: number;
}

/** Resolved config — every field present, used internally by renderers. */
export interface ResolvedConfig {
  palette: Palette;
  clip: number;
  domain: [number, number] | null;
  nanColor: string;
  showRowLabels: boolean | 'auto';
  showColLabels: boolean | 'auto';
  cell: Required<NonNullable<HeatmapConfig['cell']>>;
  fit: 'fit' | 'expand';
  fontFamily: string;
  maxColLabelPx: number;
  annotationStripHeight: number;
  annotationStripGap: number;
}

/**
 * Geometry of a single rendered cell — emitted by the renderer so callers
 * can do hit testing for hover/click.
 *
 * `mergedCols` is the number of source columns this rendered cell represents
 * after sub-pixel merging (1 in the common case; >1 when 'fit' had to collapse
 * adjacent columns to keep cells at least 1px wide).
 */
export interface CellGeometry {
  row: number;
  col: number;
  mergedCols: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Hit on an annotation strip cell — emitted by `RenderResult.stripAt`.
 */
export interface StripHit {
  /** Index into `colAnnotations[]`. */
  stripIndex: number;
  /** Source column index (after merging is resolved). */
  col: number;
  mergedCols: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RenderResult {
  /** Total rendered pixel width (CSS px, not device px). */
  width: number;
  /** Total rendered pixel height (CSS px, not device px). */
  height: number;
  /** Pixel offset of the heatmap matrix within the canvas (after labels/strips). */
  matrix: { x: number; y: number; w: number; h: number };
  /** Pixel offsets of each annotation strip (one entry per
   *  `colAnnotations` strip; empty when there are no strips). */
  strips: Array<{ x: number; y: number; w: number; h: number }>;
  /** Cell geometries, in row-major order. */
  cells: CellGeometry[];
  /**
   * Hit-test helper. Returns the cell at canvas-relative CSS pixel `(x, y)`
   * within the matrix area, or `null` if outside.
   */
  cellAt: (x: number, y: number) => CellGeometry | null;
  /**
   * Strip hit-tester. Returns the strip cell at `(x, y)` if the
   * point is over an annotation strip band, otherwise null.
   */
  stripAt: (x: number, y: number) => StripHit | null;
}
