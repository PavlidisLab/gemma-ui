import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Heatmap } from './Heatmap';
import { Legend } from './Legend';
import { rowStandardize } from './color';
import { PALETTES } from './palettes';
import { buildHeatmapDataFromPayload } from './buildHeatmapData';
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
  defaultPalette = 'ambsky',
  defaultClip = 2,
  defaultDomain,
  defaultRowScale = true,
  defaultMaxHeight = 12,
  defaultMaxWidth = 13,
  defaultFitMode = 'squeeze',
  showControls = true,
  defaultControlsOpen = false,
  showLegend = true,
  showTooltip = true,
  formatValue,
  chrome = true,
  className,
  style,
  downloadFilenameStem = 'heatmap',
  showDownload = true,
}: HeatmapWidgetProps): JSX.Element {
  // Root ref — used by the download-image button to locate the
  // rendered canvas inside the matrix wrapper. Avoids threading a
  // ref into the inner Heatmap component just for one feature.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [paletteKey, setPaletteKey] = useState<WidgetPalette>(defaultPalette);
  const [clip, setClip] = useState(defaultClip);
  const [rowScale, setRowScale] = useState(defaultRowScale);
  const [maxH, setMaxH] = useState(defaultMaxHeight);
  const [maxW, setMaxW] = useState(defaultMaxWidth);
  const [fitMode, setFitMode] = useState<FitMode>(defaultFitMode);
  const [controlsOpen, setControlsOpen] = useState(defaultControlsOpen);
  // v2: main-grouping factor selection (HEATMAP_SPEC §4). Lives on
  // the widget; intentionally NOT persisted to the URL — spec §7 #4.
  const [mainGroupingFactorId, setMainGroupingFactorId] =
    useState<number | null>(null);
  // v2 tooltip + side-panel state (HEATMAP_SPEC §5).
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

  const scaledData = useMemo<HeatmapData>(
    () =>
      rowScale
        ? { ...rawData, values: rowStandardize(rawData.values) }
        : rawData,
    [rawData, rowScale],
  );

  // Pinned-strip index is derived from the main-grouping factor id;
  // factors render one strip each in `payload.factors[]` order.
  const selectedStripIndex = useMemo<number | null>(() => {
    if (!payload || mainGroupingFactorId == null) return null;
    const i = payload.factors.findIndex((f) => f.id === mainGroupingFactorId);
    return i < 0 ? null : i;
  }, [payload, mainGroupingFactorId]);

  // Close the side panel when the payload changes underneath us.
  useEffect(() => {
    setPinned(null);
  }, [payload]);

  const palette: Palette = PALETTES[paletteKey];

  const seqDomain: [number, number] | null =
    palette.kind === 'sequential'
      ? defaultDomain ?? [-clip, clip]
      : null;

  const config = useMemo<HeatmapConfig>(
    () => ({
      palette,
      clip,
      ...(seqDomain ? { domain: seqDomain } : {}),
      cell: { maxHeight: maxH, maxWidth: maxW },
      fit: fitMode === 'expand' ? 'expand' : 'fit',
    }),
    [palette, clip, maxH, maxW, fitMode, seqDomain?.[0], seqDomain?.[1]],
  );

  const legendDomain: [number, number] = seqDomain ?? [-clip, clip];
  const fmt =
    formatValue ??
    ((v: number) =>
      Math.abs(v) >= 100 || (Math.abs(v) < 0.01 && v !== 0)
        ? v.toExponential(1)
        : v.toFixed(2));

  const stripeGradient = stripeFor(palette);

  const numRows = scaledData.values.length;
  const numCols = numRows > 0 ? scaledData.values[0].length : 0;

  // Download handlers — image and data. Per Paul 2026-05-23: the
  // data download must be the input matrix verbatim, with NO
  // row-standardisation and NO clipping applied. The downloaded
  // image, by contrast, reflects whatever the curator sees on
  // screen (the rendered canvas, after row-scale + clip + palette).
  const handleDownloadImage = () => {
    const canvas = rootRef.current?.querySelector('canvas');
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
        maxWidth: '100%',
        background: BG,
        border: `1px solid ${BORDER}`,
        borderRadius: 4,
        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
        overflow: 'hidden',
        fontFamily: 'Helvetica, Arial, sans-serif',
        color: TEXT,
      }
    : { fontFamily: 'Helvetica, Arial, sans-serif', color: TEXT };

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
        {showLegend && (
          <Legend
            palette={palette}
            domain={legendDomain}
            label={
              defaultDomain && palette.kind === 'sequential'
                ? `${rowScale ? 'Z-score' : 'Value'}  ·  ${fmt(legendDomain[0])} – ${fmt(legendDomain[1])}`
                : `${rowScale ? 'Z-score' : 'Value'}  ·  clip ±${fmt(clip)}`
            }
          />
        )}
        {/* v2 — heatmap + docked side panel sit side-by-side. In v1
            mode `pinned` is always null, so the layout collapses to
            the single matrix column. */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', minWidth: 0 }}>
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
              onStripGutterClick={
                payload
                  ? (i) => {
                      const f = payload.factors[i];
                      if (!f) return;
                      // Re-click clears.
                      setMainGroupingFactorId((prev) =>
                        prev === f.id ? null : f.id,
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
          {payload && pinned ? (
            <SidePanel
              payload={payload}
              click={pinned}
              onClose={() => setPinned(null)}
              rowValues={
                pinned.kind === 'cell'
                  ? scaledData.values[pinned.row]
                  : undefined
              }
              formatValue={fmt}
            />
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
        <HeatmapTooltip payload={payload} state={tooltip} formatValue={fmt} />
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
        whiteSpace: 'nowrap',
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
        }}
      >
        {hover.value == null ? <em>NA</em> : formatValue(hover.value)}
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
function serializeHeatmapDataAsTsv(data: HeatmapData): string {
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
