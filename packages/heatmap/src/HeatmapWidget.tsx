import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Heatmap } from './Heatmap';
import { Legend } from './Legend';
import { rowStandardize } from './color';
import { PALETTES } from './palettes';
import { buildHeatmapDataFromPayload } from './buildHeatmapData';
import { isTechnicalFactor, orderFactorsForDisplay } from './factorOrder';
import { HeatmapTooltip, type TooltipState } from './Tooltip';
import { SidePanel, type SidePanelClick } from './SidePanel';
import type {
  CellGeometry,
  CellValue,
  HeatmapConfig,
  HeatmapData,
  Palette,
} from './types';
import type { HeatmapPayload } from './payload';

export type WidgetPalette = 'ambsky' | 'blackbody';
export type FitMode = 'squeeze' | 'expand';

export interface HeatmapWidgetProps {
  /** v1 input — synthetic / pre-built `HeatmapData`. Either `data`
   *  OR `payload` must be supplied (but not both). */
  data?: HeatmapData;
  /** v2 input — wire-shaped `HeatmapPayload` from the Gemma
   *  `GET /datasets/{id}/heatmap-data` endpoint. When set, the
   *  widget builds `HeatmapData` itself and threads main-grouping +
   *  tooltip + side-panel features. */
  payload?: HeatmapPayload;
  /** Title rendered in the widget header. Omit for a chromeless embed. */
  title?: string;
  /** Subtitle / caption under the title. */
  caption?: string;
  /** Initial palette. Default `'ambsky'`. */
  defaultPalette?: WidgetPalette;
  /** Initial clip value. Default `2` — diverging palette saturates at
   *  ±2 z-score by default, which makes typical row-scaled expression
   *  heatmaps read at the right contrast for our DE pop-out. */
  defaultClip?: number;
  /** Sequential-palette domain override. When set, used directly
   *  instead of `[-clip, clip]`. Use this when the data range is
   *  not centered on zero — e.g. sample-correlation values that
   *  cluster in [0.85, 1.0]. */
  defaultDomain?: [number, number];
  /** Initial row-standardize state. Default `true` — the lab-standard
   *  default for expression heatmaps. */
  defaultRowScale?: boolean;
  /** Initial max cell height in px. Default `12`. */
  defaultMaxHeight?: number;
  /** Initial max cell width in px. Default `13`. */
  defaultMaxWidth?: number;
  /** Initial fit mode. Default `'squeeze'`.
   *  - `'squeeze'`: cells shrink to fit the viewport (matrix never overflows;
   *    sub-pixel columns merge automatically).
   *  - `'expand'`:  cells stay at their max readable size; matrix may
   *    overflow horizontally and the surrounding container scrolls. */
  defaultFitMode?: FitMode;
  /** Lock cells to a 1:1 aspect ratio (cell height follows cell width).
   *  Use for symmetric N×N matrices (sample correlation) so they render
   *  square instead of tall/narrow. Default `false`. */
  defaultSquareCells?: boolean;
  /** Show row labels. Default `'auto'`. Pass `false` to hide the row
   *  label gutter entirely (labels still feed the tooltip + TSV). */
  defaultShowRowLabels?: boolean | 'auto';
  /** Show column labels. Default `'auto'`. Pass `false` to hide the
   *  column label gutter entirely (labels still feed the tooltip + TSV). */
  defaultShowColLabels?: boolean | 'auto';
  /** Hide the controls strip entirely. Default `true`. When `true` the
   *  strip is collapsible — see `defaultControlsOpen`. */
  showControls?: boolean;
  /** Initial open state of the controls strip when `showControls=true`.
   *  Default `false` — the widget opens with the controls collapsed so
   *  the matrix is the focal element. Click the "Options" toggle in the
   *  header to expand. */
  defaultControlsOpen?: boolean;
  /** Hide the value-scale legend. Default `true`. */
  showLegend?: boolean;
  /** Where the value scale sits. `top` (default) is a horizontal bar
   *  above the plot. `side` stands it up to the right of the matrix,
   *  which is what a short, wide tile wants — a horizontal bar plus its
   *  caption costs ~80px of height there, and height is the axis a
   *  square matrix is starved of. */
  legendPlacement?: 'top' | 'side';
  /** Hide the cursor tooltip. Default `true`. */
  showTooltip?: boolean;
  /** Custom number formatter for the hover tooltip + legend ticks. */
  formatValue?: (v: number) => string;
  /** Wrap the widget in a card chrome (top stripe, border, footer).
   *  Default `true`. Set `false` for a chromeless embed. */
  chrome?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Filename stem for the download-image / download-data buttons.
   *  Final filenames are ``<stem>.png`` and ``<stem>.tsv``. When
   *  unset, falls back to ``heatmap`` so the buttons always have a
   *  usable name. Stem is rendered as-is — caller is responsible for
   *  sanitising spaces / slashes. */
  downloadFilenameStem?: string;
  /** Hide the download buttons (image + TSV) entirely. Default
   *  ``true``. Set ``false`` for a stripped chrome (e.g. an embedded
   *  thumbnail). */
  showDownload?: boolean;
  /** Per-row rich-tooltip producer. When provided, hovering a row
   *  label opens a floating popover anchored to that row; the
   *  popover renders the returned node and stays open while the
   *  cursor is inside either the label or the popover (so links
   *  rendered inside it remain clickable). */
  rowLabelTooltip?: (rowIndex: number) => React.ReactNode;
  /** Width (in CSS px) reserved for the row-label gutter. Defaults
   *  to 100 — fits a single ~14ch column. Pass a larger value (e.g.
   *  220) when ``data.rowLabelColumns`` is used so the auto-sized
   *  grid columns have room. */
  rowLabelGutterWidth?: number;
  /** Initial main-grouping factor id (payload path only). Overrides
   *  the widget's auto-pick so a caller can force a specific factor
   *  (e.g. a DE result set groups by its contrast factor). The user
   *  can still switch grouping via the strip gutters / side panel.
   *  Falls back to the auto-pick when null / not among the payload's
   *  factors. */
  defaultMainGroupingFactorId?: number | null;
}

// Pavlab-style palette tokens (per CLAUDE.md).
const TEXT = '#1f2937'; // gray-800 — body
const SUBTLE = '#6b7280'; // gray-500 — captions / ticks
const FAINT = '#9ca3af'; // gray-400 — separators
const BORDER = '#e5e7eb'; // gray-200 — chrome border
const ACCENT = '#2563eb'; // blue-600 — primary accent
const BG = '#ffffff';
const SURFACE_SUNK = '#fafafa'; // very light fill — controls / footer strip
const MONO = '"SFMono-Regular", "Menlo", "Consolas", monospace';

const PALETTE_OPTIONS: Array<{ key: WidgetPalette; label: string }> = [
  { key: 'ambsky', label: 'Diverging' },
  { key: 'blackbody', label: 'Sequential' },
];

// Persisted-preference key. The user's last explicit palette choice
// (made via the Options popover) is saved here and seeds every
// subsequent heatmap in the app. Wrapped in try/catch so the widget
// still works in environments without localStorage (SSR, sandboxed
// iframes, exotic privacy modes).
const PALETTE_STORAGE_KEY = 'gemma-heatmap-palette';
function readStoredPalette(): WidgetPalette | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(PALETTE_STORAGE_KEY);
    if (v === 'ambsky' || v === 'blackbody') return v;
    return null;
  } catch {
    return null;
  }
}
function writeStoredPalette(v: WidgetPalette): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PALETTE_STORAGE_KEY, v);
  } catch {
    // localStorage unavailable — in-memory state is still updated.
  }
}

const FIT_OPTIONS: Array<{ key: FitMode; label: string; hint: string }> = [
  {
    key: 'squeeze',
    label: 'Squeeze',
    hint: 'cells shrink to fit the container; sub-pixel columns merge',
  },
  {
    key: 'expand',
    label: 'Expand',
    hint: 'cells stay at readable size; matrix scrolls horizontally',
  },
];

/** Empty fallback so the widget can render even if neither `data`
 *  nor `payload` is supplied (defensive — typecheck still nags via
 *  the prop union). */
const EMPTY_DATA: HeatmapData = { values: [] };

/**
 * Self-contained heatmap widget. Bundles matrix, palette switcher,
 * clip slider, row-standardize toggle, cell-size sliders, fit-mode
 * toggle (squeeze vs. expand-and-scroll), hover tooltip, value-scale
 * legend on top, and a provenance-style status footer.
 *
 * Drop in anywhere — page, popover, modal — by passing a `HeatmapData`.
 * Inline styles only (no Tailwind / CSS-in-JS dep) so the lib stays
 * portable.
 *
 * Sizing model:
 *   - Squeeze (default): matrix sizes to the available width by
 *     shrinking cells (and merging sub-pixel columns via the fit-mode
 *     layout). No scroll, no hollow.
 *   - Expand: cells stay at their max-readable size; if that overflows
 *     the container, the matrix area scrolls horizontally.
 */
export function HeatmapWidget({
  data,
  payload,
  title,
  caption,
  defaultPalette = 'blackbody',
  defaultClip = 2,
  defaultDomain,
  defaultRowScale = true,
  defaultMaxHeight = 12,
  defaultMaxWidth = 13,
  defaultFitMode = 'squeeze',
  defaultSquareCells = false,
  defaultShowRowLabels = 'auto',
  defaultShowColLabels = 'auto',
  showControls = true,
  defaultControlsOpen = false,
  showLegend = true,
  legendPlacement = 'top',
  showTooltip = true,
  formatValue,
  chrome = true,
  className,
  style,
  downloadFilenameStem = 'heatmap',
  showDownload = true,
  rowLabelTooltip,
  rowLabelGutterWidth,
  defaultMainGroupingFactorId,
}: HeatmapWidgetProps): JSX.Element {
  // Root ref — used by the download-image button to locate the
  // rendered canvas inside the matrix wrapper. Avoids threading a
  // ref into the inner Heatmap component just for one feature.
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Palette state is seeded from localStorage so the user's last
  // explicit choice (made via the Options popover) carries across
  // every heatmap in the app. ``defaultPalette`` is only the seed
  // when no preference is stored. Saves happen via
  // ``handleSetPaletteKey`` — initial mount is NOT persisted so a
  // caller-supplied default doesn't silently become the user's
  // global preference.
  const [paletteKey, setPaletteKeyRaw] = useState<WidgetPalette>(() =>
    readStoredPalette() ?? defaultPalette,
  );
  const setPaletteKey = (next: WidgetPalette) => {
    setPaletteKeyRaw(next);
    writeStoredPalette(next);
  };
  const [clip, setClip] = useState(defaultClip);
  const [rowScale, setRowScale] = useState(defaultRowScale);
  const [maxH, setMaxH] = useState(defaultMaxHeight);
  const [maxW, setMaxW] = useState(defaultMaxWidth);
  const [fitMode, setFitMode] = useState<FitMode>(defaultFitMode);
  const [controlsOpen, setControlsOpen] = useState(defaultControlsOpen);
  // v2: main-grouping factor selection. Lives on
  // the widget; intentionally NOT persisted to the URL — spec §7 #4.
  // Default = auto-pick the first sensible biological factor in the
  // payload so the heatmap loads with samples already grouped (and
  // controls/baselines on the left, courtesy of categoricalOrder).
  // Skips obviously-technical categories (batch / collection / scan
  // date) so the default isn't a useless bucketing.
  const autoPickedFactorId = useMemo<number | null>(() => {
    if (!payload) return null;
    // Walk the factors in the same canonical order the strips render
    // in, so ``eligible[0]`` (the default grouping) matches the first
    // biological strip the user sees.
    const eligible = orderFactorsForDisplay(payload.factors ?? []).filter(
      (f) => {
        if (f.type !== 'categorical') return false;
        const fvs = f.factor_values ?? [];
        if (fvs.length < 2) return false;
        if (isTechnicalFactor(f)) return false;
        return true;
      },
    );
    // Prefer a factor that has at least one declared baseline.
    const withBaseline = eligible.find((f) =>
      (f.factor_values ?? []).some((fv) => fv.is_baseline),
    );
    return (withBaseline ?? eligible[0])?.id ?? null;
  }, [payload]);
  // Caller-forced grouping wins, but only when it names a factor that
  // actually exists in this payload; otherwise fall back to the
  // auto-pick so a stale / mismatched id never blanks the grouping.
  const initialGroupingFactorId = useMemo<number | null>(() => {
    if (
      defaultMainGroupingFactorId != null &&
      (payload?.factors ?? []).some((f) => f.id === defaultMainGroupingFactorId)
    ) {
      return defaultMainGroupingFactorId;
    }
    return autoPickedFactorId;
  }, [defaultMainGroupingFactorId, payload, autoPickedFactorId]);
  const [mainGroupingFactorId, setMainGroupingFactorId] =
    useState<number | null>(initialGroupingFactorId);
  // When a fresh payload arrives with a different initial grouping
  // (e.g. user navigated to a different dataset, or genes loaded in
  // and factors arrived for the first time), adopt it.
  const userTouchedGroupingRef = useRef(false);
  useEffect(() => {
    if (userTouchedGroupingRef.current) return;
    setMainGroupingFactorId(initialGroupingFactorId);
  }, [initialGroupingFactorId]);
  const setMainGroupingFactorIdWithTouch = (
    updater: number | null | ((prev: number | null) => number | null),
  ) => {
    userTouchedGroupingRef.current = true;
    setMainGroupingFactorId(updater as never);
  };
  // v2 tooltip + side-panel state.
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [pinned, setPinned] = useState<SidePanelClick | null>(null);
  // v1 tooltip — kept for the legacy `data`-only path.
  const [hover, setHover] = useState<{
    cell: CellGeometry;
    value: CellValue;
    clientX: number;
    clientY: number;
  } | null>(null);

  // Derive the canvas-input `HeatmapData` from whichever input was
  // supplied. v2 (payload) takes precedence; v1 (data) is the
  // fallback for legacy / synthetic callers.
  const built = useMemo(() => {
    if (payload) {
      return buildHeatmapDataFromPayload(payload, {
        mainGroupingFactorId,
      });
    }
    return null;
  }, [payload, mainGroupingFactorId]);
  const rawData: HeatmapData = built?.data ?? data ?? EMPTY_DATA;

  // Factors in the SAME order the strips are built + rendered in
  // (buildHeatmapDataFromPayload lays strips out via
  // orderFactorsForDisplay). Strip indices reported by the canvas —
  // hover, click, selected-grouping highlight — are indices into THIS
  // ordered list, NOT into ``payload.factors`` whose wire order can
  // differ. Indexing ``payload.factors`` directly mismatched a strip's
  // label against its factor whenever the wire emitted factors in a
  // non-display order (e.g. DevBrain emits "clinical history" first,
  // but "biological sex" sorts first for display — so strip 0, labelled
  // "biological sex", resolved to the clinical-history factor and read
  // as NA). ``orderFactorsForDisplay`` is pure + deterministic, so this
  // list is guaranteed identical to the order the strips were built in.
  const orderedFactors = useMemo(
    () => (payload ? orderFactorsForDisplay(payload.factors ?? []) : []),
    [payload],
  );
  // Payload whose ``factors`` are in strip order — handed to the
  // tooltip + side panel so their ``factors[stripIndex]`` lookups line
  // up with the rendered strips. Columns / rows / matrix are untouched
  // (only the factor array is reordered; FV lookups are keyed by
  // factor.id, so consumers that iterate all factors stay correct).
  const orderedPayload = useMemo<HeatmapPayload | null>(
    () => (payload ? { ...payload, factors: orderedFactors } : null),
    [payload, orderedFactors],
  );

  const scaledData = useMemo<HeatmapData>(
    () =>
      rowScale
        ? { ...rawData, values: rowStandardize(rawData.values) }
        : rawData,
    [rawData, rowScale],
  );

  // Pinned-strip index is derived from the main-grouping factor id;
  // factors render one strip each in `orderedFactors` (display) order,
  // so the highlight must be located in THAT list, not the wire order.
  const selectedStripIndex = useMemo<number | null>(() => {
    if (mainGroupingFactorId == null) return null;
    const i = orderedFactors.findIndex((f) => f.id === mainGroupingFactorId);
    return i < 0 ? null : i;
  }, [orderedFactors, mainGroupingFactorId]);

  // Rendered-column index of the pinned cell. The side panel's
  // sparkline plots `rowValues` in RENDERED (displayed) column order,
  // so its highlight marker must index in that same order. `pinned.col`
  // is the SOURCE-payload column (used for metadata lookups), which
  // differs from the displayed order whenever main-grouping reorders
  // samples — so we translate it back through `columnOrder` here so
  // the marker lands on the same sample the heatmap shows it under.
  const pinnedRenderedCol = useMemo<number | null>(() => {
    if (!pinned || pinned.kind !== 'cell' || !built) return null;
    const i = built.columnOrder.indexOf(pinned.col);
    return i < 0 ? pinned.col : i;
  }, [pinned, built]);

  // Close the side panel when the payload changes underneath us.
  useEffect(() => {
    setPinned(null);
  }, [payload]);

  const palette: Palette = PALETTES[paletteKey];

  // When row-standardisation is OFF, the values are on the raw data
  // scale (often log2 expression, ~0..14). The default ±clip domain
  // is meant for z-scores and saturates everything to white. Compute
  // a 5%-trimmed [lo, hi] from the actual data so the gradient
  // covers the bulk of the dynamic range with the tails clipped.
  const naturalDomain = useMemo<[number, number] | null>(() => {
    if (rowScale) return null;
    const vals: number[] = [];
    for (const row of rawData.values) {
      for (const v of row) {
        if (typeof v === 'number' && Number.isFinite(v)) vals.push(v);
      }
    }
    if (vals.length < 2) return null;
    vals.sort((a, b) => a - b);
    const pick = (q: number) => {
      const i = Math.min(vals.length - 1, Math.max(0, Math.floor(q * (vals.length - 1))));
      return vals[i];
    };
    let lo = pick(0.025);
    let hi = pick(0.975);
    if (!(hi > lo)) {
      // Guard against degenerate range — fall back to true min/max.
      lo = vals[0];
      hi = vals[vals.length - 1];
      if (!(hi > lo)) return null;
    }
    return [lo, hi];
  }, [rawData, rowScale]);

  const seqDomain: [number, number] | null =
    palette.kind === 'sequential'
      ? defaultDomain ?? naturalDomain ?? [-clip, clip]
      : naturalDomain; // diverging palette still honours the natural domain when row-scale is off

  const config = useMemo<HeatmapConfig>(
    () => ({
      palette,
      clip,
      ...(seqDomain ? { domain: seqDomain } : {}),
      cell: { maxHeight: maxH, maxWidth: maxW },
      fit: fitMode === 'expand' ? 'expand' : 'fit',
      square: defaultSquareCells,
      showRowLabels: defaultShowRowLabels,
      showColLabels: defaultShowColLabels,
    }),
    [
      palette,
      clip,
      maxH,
      maxW,
      fitMode,
      seqDomain?.[0],
      seqDomain?.[1],
      defaultSquareCells,
      defaultShowRowLabels,
      defaultShowColLabels,
    ],
  );

  const legendDomain: [number, number] = seqDomain ?? [-clip, clip];
  const fmt =
    formatValue ??
    ((v: number) => {
      // Defensive: ``CellValue`` is typed as ``number | null`` but
      // upstream builders sometimes leak strings / NaN through. Coerce
      // before calling ``toFixed`` so the tooltip can't crash the
      // page.
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) return String(v);
      return Math.abs(n) >= 100 || (Math.abs(n) < 0.01 && n !== 0)
        ? n.toExponential(1)
        : n.toFixed(2);
    });

  const stripeGradient = stripeFor(palette);

  const numRows = scaledData.values.length;
  const numCols = numRows > 0 ? scaledData.values[0].length : 0;

  // Download handlers — image and data. Per design review 2026-05-23: the
  // data download must be the input matrix verbatim, with NO
  // row-standardisation and NO clipping applied. The downloaded
  // image, by contrast, reflects whatever the curator sees on
  // screen (the rendered canvas, after row-scale + clip + palette).
  const handleDownloadImage = () => {
    // Target the matrix canvas explicitly (data-attr added in
    // Heatmap.tsx). Plain ``querySelector('canvas')`` picked the
    // Legend's small scale-bar canvas, since it lives earlier in
    // the DOM than the matrix.
    const canvas =
      rootRef.current?.querySelector<HTMLCanvasElement>(
        'canvas[data-heatmap-matrix="true"]',
      ) ?? rootRef.current?.querySelector('canvas');
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    triggerDownload(url, `${downloadFilenameStem}.png`);
  };
  const handleDownloadData = () => {
    // Always export ``rawData`` (the input to the widget). Skip
    // ``scaledData`` even when row-scale is toggled on — the user
    // wants to take the numbers home, not the z-scores. Same
    // reasoning for clip: clipping is a render concern.
    const tsv = serializeHeatmapDataAsTsv(rawData);
    const blob = new Blob([tsv], { type: 'text/tab-separated-values' });
    const url = URL.createObjectURL(blob);
    try {
      triggerDownload(url, `${downloadFilenameStem}.tsv`);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    }
  };

  const cardStyle: CSSProperties = chrome
    ? {
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        maxWidth: '100%',
        background: BG,
        border: `1px solid ${BORDER}`,
        borderRadius: 4,
        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
        overflow: 'hidden',
        fontFamily: 'Helvetica, Arial, sans-serif',
        color: TEXT,
      }
    : {
        minWidth: 0,
        maxWidth: '100%',
        fontFamily: 'Helvetica, Arial, sans-serif',
        // 🛑 No `color` on a chromeless embed. It used to set TEXT
        // (#1f2937) here, which overrode the theme-aware colour the
        // host surface sets and left the legend's labels near-black on
        // a dark panel — invisible, and not fixable from the host,
        // because an inline style beats an inherited class. The card
        // chrome above still names its own colour: it also paints its
        // own white background, so it owns both halves of the contrast.
      };

  return (
    <div ref={rootRef} className={className} style={{ ...cardStyle, ...style }}>
      {chrome && (
        <div
          aria-hidden
          style={{ height: 3, background: stripeGradient, flex: '0 0 auto' }}
        />
      )}

      {(title || caption || showControls) && (
        <header
          style={{
            padding: title || caption ? '12px 16px 10px' : '8px 14px',
            borderBottom: chrome ? `1px solid ${BORDER}` : undefined,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flex: '0 0 auto',
          }}
        >
          <div style={{ minWidth: 0 }}>
            {title && (
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  letterSpacing: 0.1,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {title}
              </div>
            )}
            {caption && (
              <div style={{ fontSize: 11, color: SUBTLE, marginTop: 3 }}>
                {caption}
              </div>
            )}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flex: '0 0 auto',
            }}
          >
            {showDownload && (
              <>
                <button
                  type="button"
                  onClick={handleDownloadImage}
                  title="Download the rendered heatmap as PNG"
                  style={{
                    background: 'transparent',
                    color: SUBTLE,
                    border: `1px solid ${BORDER}`,
                    borderRadius: 3,
                    padding: '3px 8px',
                    fontSize: 11,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                    lineHeight: 1,
                  }}
                >
                  PNG
                </button>
                <button
                  type="button"
                  onClick={handleDownloadData}
                  title="Download the underlying values as TSV (input matrix; not row-scaled, not clipped)"
                  style={{
                    background: 'transparent',
                    color: SUBTLE,
                    border: `1px solid ${BORDER}`,
                    borderRadius: 3,
                    padding: '3px 8px',
                    fontSize: 11,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                    lineHeight: 1,
                  }}
                >
                  TSV
                </button>
              </>
            )}
            {showControls && (
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => setControlsOpen((v) => !v)}
                  title={controlsOpen ? 'hide controls' : 'show controls'}
                  aria-expanded={controlsOpen}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    background: controlsOpen ? ACCENT : 'transparent',
                    color: controlsOpen ? '#fff' : SUBTLE,
                    border: `1px solid ${controlsOpen ? ACCENT : BORDER}`,
                    borderRadius: 3,
                    padding: '3px 8px',
                    fontSize: 11,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                    lineHeight: 1,
                  }}
                >
                  <span aria-hidden style={{ fontSize: 10 }}>
                    {controlsOpen ? '▾' : '▸'}
                  </span>
                  Options
                </button>
                {controlsOpen && (
                  <ControlsPopover
                    paletteKey={paletteKey}
                    setPaletteKey={setPaletteKey}
                    clip={clip}
                    setClip={setClip}
                    rowScale={rowScale}
                    setRowScale={setRowScale}
                    fitMode={fitMode}
                    setFitMode={setFitMode}
                    maxH={maxH}
                    setMaxH={setMaxH}
                    maxW={maxW}
                    setMaxW={setMaxW}
                    fmt={fmt}
                    onClose={() => setControlsOpen(false)}
                  />
                )}
              </div>
            )}
            <span
              style={{
                fontFamily: MONO,
                fontSize: 11,
                color: SUBTLE,
                fontVariantNumeric: 'tabular-nums',
                whiteSpace: 'nowrap',
              }}
            >
              {numRows}×{numCols}
            </span>
          </div>
        </header>
      )}

      <div
        style={{
          padding: '14px 16px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          minWidth: 0,
        }}
      >
        {showLegend && legendPlacement === 'top' && (
          <Legend
            palette={palette}
            domain={legendDomain}
            label={
              !rowScale
                ? `natural  ·  ${fmt(legendDomain[0])} – ${fmt(legendDomain[1])}`
                : defaultDomain && palette.kind === 'sequential'
                  ? `Z-score  ·  ${fmt(legendDomain[0])} – ${fmt(legendDomain[1])}`
                  : `Z-score  ·  clip ±${fmt(clip)}`
            }
          />
        )}
        {/* v2 — heatmap fills the row; the cell-detail panel floats
            OVER the matrix as an absolute overlay (anchored top-right)
            rather than an in-flow sibling, so opening it never squeezes
            the matrix into unreadability. In v1 mode `pinned` is always
            null, so this is just the single matrix column. */}
        <div style={{ position: 'relative', display: 'flex', gap: 12, alignItems: 'stretch', minWidth: 0 }}>
          {/* The matrix lives inside a scrollable region so Expand mode can
              overflow horizontally without growing the chrome. In Squeeze
              mode the matrix never overflows; the overflow:auto is a no-op
              but the wrapper still caps the width sensibly. */}
          <div
            style={{
              flex: '1 1 auto',
              minWidth: 0,
              overflow: fitMode === 'expand' ? 'auto' : 'visible',
              maxWidth: '100%',
              // A faint inner border in Expand mode hints at the scroll region.
              border:
                fitMode === 'expand' ? `1px solid ${BORDER}` : '1px solid transparent',
              borderRadius: 3,
              padding: fitMode === 'expand' ? 6 : 0,
            }}
          >
            <Heatmap
              data={scaledData}
              config={config}
              selectedStripIndex={selectedStripIndex}
              rowLabelTooltip={rowLabelTooltip}
              rowLabelGutterWidth={rowLabelGutterWidth}
              onStripGutterClick={
                payload
                  ? (i) => {
                      const f = orderedFactors[i];
                      if (!f) return;
                      // Clicking a strip groups by it. Clicking the one
                      // that's already selected doesn't clear grouping —
                      // there's always an active grouping — it reverts to
                      // the default (auto-picked / caller-forced) factor so
                      // the marker never disappears.
                      setMainGroupingFactorIdWithTouch((prev: number | null) =>
                        prev === f.id ? initialGroupingFactorId : f.id,
                      );
                    }
                  : undefined
              }
              onPointerOver={
                payload && showTooltip
                  ? (e) => {
                      if (e.kind === 'cell') {
                        // For v2, tooltip carries SOURCE col / row;
                        // map cell.col (source col after reorder) back
                        // through built.columnOrder so the tooltip
                        // reads original column metadata.
                        const sourceCol =
                          built?.columnOrder[e.hit.col] ?? e.hit.col;
                        setTooltip({
                          kind: 'cell',
                          row: e.hit.row,
                          // built.data was reordered, so e.hit.col is
                          // the rendered column index expressed in
                          // SCALED data's column coordinate (post-
                          // reorder). Translate to source-payload
                          // column for tooltip + panel content.
                          col: sourceCol,
                          value:
                            scaledData.values[e.hit.row]?.[e.hit.col] ?? null,
                          clientX: e.ev.clientX,
                          clientY: e.ev.clientY,
                        });
                      } else {
                        const sourceCol =
                          built?.columnOrder[e.hit.col] ?? e.hit.col;
                        setTooltip({
                          kind: 'strip',
                          stripIndex: e.hit.stripIndex,
                          col: sourceCol,
                          clientX: e.ev.clientX,
                          clientY: e.ev.clientY,
                        });
                      }
                    }
                  : undefined
              }
              onCellHover={
                !payload && showTooltip
                  ? (c, ev) =>
                      setHover({
                        cell: c,
                        value: scaledData.values[c.row]?.[c.col] ?? null,
                        clientX: ev.clientX,
                        clientY: ev.clientY,
                      })
                  : undefined
              }
              onCellLeave={
                payload
                  ? () => setTooltip(null)
                  : showTooltip
                  ? () => setHover(null)
                  : undefined
              }
              onCellClick={
                payload && built
                  ? (e) => {
                      if (e.kind === 'cell') {
                        const sourceCol =
                          built.columnOrder[e.hit.col] ?? e.hit.col;
                        setPinned({
                          kind: 'cell',
                          row: e.hit.row,
                          col: sourceCol,
                          value:
                            scaledData.values[e.hit.row]?.[e.hit.col] ?? null,
                        });
                      } else {
                        const sourceCol =
                          built.columnOrder[e.hit.col] ?? e.hit.col;
                        setPinned({
                          kind: 'strip',
                          stripIndex: e.hit.stripIndex,
                          col: sourceCol,
                        });
                      }
                    }
                  : undefined
              }
            />
          </div>
          {showLegend && legendPlacement === 'side' && (
            // A rail beside the matrix, not a bar above it. On a short
            // wide tile the horizontal legend plus its caption cost
            // ~80px of height, and height is the axis a square matrix
            // is starved of — every one of those pixels came straight
            // out of the cells. `alignSelf: center` keeps it beside the
            // matrix rather than pinned to the top of a taller row.
            <div style={{ flex: '0 0 auto', alignSelf: 'center' }}>
              <Legend
                palette={palette}
                domain={legendDomain}
                orientation="vertical"
                width={Math.max(60, Math.min(160, maxH || 120))}
                barHeight={10}
              />
            </div>
          )}
          {payload && pinned ? (
            <div
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                zIndex: 30,
                // Never wider than the matrix on narrow layouts.
                maxWidth: '100%',
              }}
            >
              <SidePanel
                payload={orderedPayload ?? payload}
                click={pinned}
                onClose={() => setPinned(null)}
                rowValues={
                  pinned.kind === 'cell'
                    ? scaledData.values[pinned.row]
                    : undefined
                }
                rowValueHighlightIndex={pinnedRenderedCol ?? undefined}
                formatValue={fmt}
              />
            </div>
          ) : null}
        </div>
      </div>

      {chrome && (
        <footer
          style={{
            padding: '7px 16px',
            borderTop: `1px solid ${BORDER}`,
            background: SURFACE_SUNK,
            fontFamily: MONO,
            fontSize: 10,
            color: SUBTLE,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            fontVariantNumeric: 'tabular-nums',
            flex: '0 0 auto',
          }}
        >
          <span>palette={paletteKey}</span>
          <span style={{ color: FAINT }}>·</span>
          <span>clip=±{fmt(clip)}</span>
          <span style={{ color: FAINT }}>·</span>
          <span>row-scale={rowScale ? 'on' : 'off'}</span>
          <span style={{ color: FAINT }}>·</span>
          <span>fit={fitMode}</span>
          <span style={{ color: FAINT }}>·</span>
          <span>cell={maxH}×{maxW}px</span>
        </footer>
      )}

      {showTooltip && payload && tooltip ? (
        <HeatmapTooltip payload={orderedPayload ?? payload} state={tooltip} formatValue={fmt} />
      ) : null}
      {showTooltip && !payload && hover ? (
        <CursorTooltip hover={hover} data={scaledData} formatValue={fmt} />
      ) : null}
    </div>
  );
}

// ─── internal subcomponents ──────────────────────────────────────────

function stripeFor(palette: Palette): string {
  const stops = palette.stops;
  if (stops.length === 0) return ACCENT;
  if (palette.kind === 'diverging') {
    const lo = stops[0];
    const mid = stops[Math.floor(stops.length / 2)];
    const hi = stops[stops.length - 1];
    return `linear-gradient(to right, ${lo}, ${mid}, ${hi})`;
  }
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/** Floating vertical control panel — replaces the in-flow horizontal
 *  controls strip that was eating ~50px below the header. Sticks to
 *  the top-right of the matrix area, anchored under the Options
 *  button. Closes on outside-click + Escape. */
function ControlsPopover({
  paletteKey,
  setPaletteKey,
  clip,
  setClip,
  rowScale,
  setRowScale,
  fitMode,
  setFitMode,
  maxH,
  setMaxH,
  maxW,
  setMaxW,
  fmt,
  onClose,
}: {
  paletteKey: WidgetPalette;
  setPaletteKey: (v: WidgetPalette) => void;
  clip: number;
  setClip: (v: number) => void;
  rowScale: boolean;
  setRowScale: (v: boolean) => void;
  fitMode: FitMode;
  setFitMode: (v: FitMode) => void;
  maxH: number;
  setMaxH: (v: number) => void;
  maxW: number;
  setMaxW: (v: number) => void;
  fmt: (v: number) => string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: 'calc(100% + 4px)',
        right: 0,
        zIndex: 20,
        minWidth: 220,
        background: BG,
        border: `1px solid ${BORDER}`,
        borderRadius: 4,
        boxShadow: '0 6px 18px rgba(15, 23, 42, 0.18)',
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        fontSize: 11,
        color: TEXT,
      }}
    >
      <ControlRow label="Palette">
        <SegmentedControl
          options={PALETTE_OPTIONS}
          value={paletteKey}
          onChange={setPaletteKey}
        />
      </ControlRow>
      <ControlRow label="Row-scale">
        <Toggle
          checked={rowScale}
          onChange={setRowScale}
          label=""
          hint="z-score each row"
        />
      </ControlRow>
      <ControlRow label="Clip">
        <CompactSlider
          label=""
          value={clip}
          min={0.5}
          max={6}
          step={0.1}
          onChange={setClip}
          display={`±${fmt(clip)}`}
          width={112}
        />
      </ControlRow>
      <div style={{ height: 1, background: BORDER, margin: '2px 0' }} />
      <ControlRow label="Fit">
        <SegmentedControl
          options={FIT_OPTIONS}
          value={fitMode}
          onChange={setFitMode}
        />
      </ControlRow>
      <ControlRow label="Cell H">
        <CompactSlider
          label=""
          value={maxH}
          min={2}
          max={36}
          step={1}
          onChange={setMaxH}
          display={`${maxH}px`}
          width={112}
        />
      </ControlRow>
      <ControlRow label="Cell W">
        <CompactSlider
          label=""
          value={maxW}
          min={2}
          max={48}
          step={1}
          onChange={setMaxW}
          display={`${maxW}px`}
          width={112}
        />
      </ControlRow>
    </div>
  );
}

/** Two-column control row — left label + right control, baseline
 *  aligned. Keeps the popover scannable at a glance. */
function ControlRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
      }}
    >
      <span style={{ color: SUBTLE, fontSize: 10.5, whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center' }}>
        {children}
      </span>
    </div>
  );
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ key: T; label: string; hint?: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="group"
      style={{
        display: 'inline-flex',
        border: `1px solid ${BORDER}`,
        borderRadius: 4,
        overflow: 'hidden',
        background: BG,
      }}
    >
      {options.map((opt, i) => {
        const selected = opt.key === value;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            title={opt.hint}
            style={{
              border: 0,
              borderLeft: i === 0 ? 0 : `1px solid ${BORDER}`,
              padding: '6px 14px',
              fontSize: 12,
              lineHeight: 1,
              cursor: 'pointer',
              background: selected ? ACCENT : 'transparent',
              color: selected ? '#fff' : TEXT,
              fontWeight: selected ? 600 : 400,
              fontFamily: 'inherit',
              letterSpacing: 0.1,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function CompactSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
  width,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  display: string;
  width: number;
}) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
      <span
        style={{
          color: SUBTLE,
          fontFamily: MONO,
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
        }}
      >
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        style={{ width, accentColor: ACCENT, cursor: 'pointer' }}
      />
      <span
        style={{
          color: TEXT,
          fontFamily: MONO,
          fontSize: 11,
          fontVariantNumeric: 'tabular-nums',
          minWidth: 40,
          textAlign: 'right',
        }}
      >
        {display}
      </span>
    </label>
  );
}

/**
 * Toggle switch with a generous, full-row clickable hit target.
 *
 * The visible knob is small for visual density, but the entire button
 * (label + switch combined) is the click target. That's the missing
 * piece that made earlier versions feel "you can't click on it" —
 * users were aiming at the 13×24 knob.
 */
function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      title={hint}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        cursor: 'pointer',
        background: 'transparent',
        border: 0,
        padding: '4px 6px',
        margin: 0,
        fontFamily: 'inherit',
        fontSize: 12,
        color: TEXT,
        userSelect: 'none',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 30,
          height: 16,
          background: checked ? ACCENT : '#cbd5e1',
          borderRadius: 999,
          position: 'relative',
          transition: 'background 120ms ease',
          flex: '0 0 auto',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 1,
            left: checked ? 15 : 1,
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
            transition: 'left 120ms ease',
          }}
        />
      </span>
      <span>{label}</span>
    </button>
  );
}

function CursorTooltip({
  hover,
  data,
  formatValue,
}: {
  hover: {
    cell: CellGeometry;
    value: CellValue;
    clientX: number;
    clientY: number;
  };
  data: HeatmapData;
  formatValue: (v: number) => string;
}) {
  const W = 220;
  const left =
    hover.clientX + 14 + W > window.innerWidth
      ? hover.clientX - 14 - W
      : hover.clientX + 14;
  return (
    <div
      style={{
        position: 'fixed',
        top: hover.clientY + 14,
        left,
        zIndex: 1000,
        background: 'rgba(17, 24, 39, 0.96)',
        color: '#f3f4f6',
        padding: '6px 8px',
        fontSize: 11,
        lineHeight: 1.3,
        borderRadius: 3,
        pointerEvents: 'none',
        maxWidth: W,
        // Long labels (e.g. correlation-matrix sample names) wrap inside
        // the box instead of overflowing past its right edge — nowrap +
        // capped maxWidth with no overflow handling spilled the text.
        overflowWrap: 'break-word',
        boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
        fontFamily: 'Helvetica, Arial, sans-serif',
      }}
    >
      <div style={{ fontWeight: 600 }}>
        {data.rowLabels?.[hover.cell.row] ?? `row ${hover.cell.row}`}
      </div>
      <div style={{ color: '#9ca3af', fontSize: 10 }}>
        {data.colLabels?.[hover.cell.col] ?? `col ${hover.cell.col}`}
      </div>
      <div
        style={{
          marginTop: 3,
          fontFamily: MONO,
          fontSize: 11,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        }}
      >
        {(() => {
          if (hover.value == null) return <em>NA</em>;
          // Coerce upstream string / NaN leaks before calling
          // ``formatValue`` (callers may pass formatters that assume
          // a number, e.g. ``v.toFixed``).
          const v = hover.value;
          const n = typeof v === "number" ? v : Number(v);
          if (!Number.isFinite(n)) return <em>NA</em>;
          return formatValue(n);
        })()}
        {hover.cell.mergedCols > 1 ? (
          <span style={{ color: '#9ca3af', marginLeft: 6 }}>
            mean of {hover.cell.mergedCols}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Programmatically synthesise an anchor click against a URL with a
 *  `download` attribute. Works for both data: URLs (image) and
 *  blob: URLs (TSV). */
function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Serialise a ``HeatmapData`` to TSV, raw values (no row-scaling,
 *  no clipping). Layout:
 *
 *      \t<col-1>\t<col-2>\t...
 *      <row-1-label>\t<v1>\t<v2>\t...
 *      <row-2-label>\t...
 *
 *  Missing values export as the empty string (matches R / Pandas
 *  defaults). Row / col labels default to ``row_i`` / ``col_j``
 *  when the input didn't carry labels. */
export function serializeHeatmapDataAsTsv(data: HeatmapData): string {
  const numRows = data.values.length;
  const numCols = numRows > 0 ? data.values[0].length : 0;
  const colLabels =
    data.colLabels ??
    Array.from({ length: numCols }, (_, j) => `col_${j + 1}`);
  const rowLabels =
    data.rowLabels ??
    Array.from({ length: numRows }, (_, i) => `row_${i + 1}`);
  const lines: string[] = [];
  lines.push(['', ...colLabels].join('\t'));
  for (let i = 0; i < numRows; i++) {
    const row = data.values[i] ?? [];
    const cells = row.map((v) => (v == null || Number.isNaN(v) ? '' : String(v)));
    lines.push([rowLabels[i] ?? `row_${i + 1}`, ...cells].join('\t'));
  }
  return lines.join('\n');
}
