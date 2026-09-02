import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CellGeometry,
  HeatmapConfig,
  HeatmapData,
  StripHit,
} from './types';
import { computeLayout, resolveConfig } from './layout';
import { renderMatrix } from './render';

export interface HeatmapProps {
  data: HeatmapData;
  config?: HeatmapConfig;
  /**
   * Fixed height in CSS pixels. Optional — if omitted, height equals
   * `numRows * cell.maxHeight` (rows render at their max height).
   *
 * 🛑 Every label here draws in `currentColor`, never a fixed grey.
 * This package ships no Tailwind and cannot write a `dark:` rule, so
 * the host surface owns the text colour and these inherit it. Six
 * hardcoded near-blacks (#1f2937 / #374151 / #6b7280) used to sit here
 * and were invisible on the dark diagnostics panel — the annotation
 * strip names among them. A fixed colour cannot be right in both
 * themes; if a label needs to recede, use opacity.
 */
  height?: number;
  /**
   * Pointer-over callback. Fires whenever the cursor moves over the
   * canvas:
   *   - over a matrix cell        → `{ kind: 'cell',  hit: CellGeometry }`
   *   - over an annotation strip  → `{ kind: 'strip', hit: StripHit }`
   *   - elsewhere (e.g. inside a gap) → not called.
   */
  onPointerOver?: (
    e:
      | { kind: 'cell'; hit: CellGeometry; ev: React.MouseEvent<HTMLCanvasElement> }
      | { kind: 'strip'; hit: StripHit; ev: React.MouseEvent<HTMLCanvasElement> },
  ) => void;
  /** Called when the pointer leaves the matrix area. */
  onCellLeave?: () => void;
  /** Click handler — same discriminator as `onPointerOver`. */
  onCellClick?: (
    e:
      | { kind: 'cell'; hit: CellGeometry; ev: React.MouseEvent<HTMLCanvasElement> }
      | { kind: 'strip'; hit: StripHit; ev: React.MouseEvent<HTMLCanvasElement> },
  ) => void;
  /** Clicking on the strip's leftmost gutter (the HTML label area)
   *  sets that factor as the main grouping factor. Spec §4.1. */
  onStripGutterClick?: (stripIndex: number) => void;
  /** Visual marker for the currently-selected main-grouping strip
   *  (2px amber border around the strip's gutter). Spec §4.2. */
  selectedStripIndex?: number | null;
  /** Wrapper className for styling hooks (Tailwind, etc.). */
  className?: string;

  /** Per-row rich-tooltip producer. When provided, hovering a row
   *  label opens a floating popover anchored to that label; the
   *  popover renders the returned node and stays open while the
   *  cursor is inside either the label or the popover (so links
   *  rendered inside it remain clickable). */
  rowLabelTooltip?: (rowIndex: number) => React.ReactNode;
  /** Click on a row's label gutter. Mirrors `onStripGutterClick` for
   *  the other axis. Unlike a cell click this names ONE sample rather
   *  than a pair, which is what a per-sample action needs. */
  onRowLabelClick?: (rowIndex: number) => void;
  /** Width (in CSS px) reserved for the row-label gutter on the
   *  right. Defaults to 100, which fits a single ~14ch column. Pass
   *  a larger value when using ``data.rowLabelColumns`` for
   *  multi-column labels. */
  rowLabelGutterWidth?: number;

  // — back-compat shims for v1 callers —
  /** v1 alias: hover on matrix cell only. Prefer `onPointerOver`. */
  onCellHover?: (cell: CellGeometry, ev: React.MouseEvent<HTMLCanvasElement>) => void;
}

/**
 * Heatmap React wrapper.
 *
 * Layout shell:
 *   ┌─────────────────────────────────────────┐
 *   │ column labels (rotated, HTML)           │              ← writing-mode trick
 *   ├─────────────────────────────────┬───────┤
 *   │ annotation strips (canvas)      │ names │              ← strip name = HTML
 *   │ matrix     (canvas, DPR-aware)  │ row   │              ← row label = HTML
 *   │                                 │ labels│
 *   └─────────────────────────────────┴───────┘
 *
 * The canvas holds the strips + matrix only. Everything else is HTML so
 * labels stay copyable and the consumer can style them with Tailwind.
 */
export function Heatmap({
  data,
  config,
  height,
  onCellHover,
  onPointerOver,
  onCellLeave,
  onCellClick,
  onStripGutterClick,
  selectedStripIndex,
  className,
  rowLabelTooltip,
  onRowLabelClick,
  rowLabelGutterWidth,
}: HeatmapProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [containerW, setContainerW] = useState<number>(600);
  // Row-label hover popover state. ``row`` = which row is open;
  // ``anchor`` = absolute viewport coords of the row-label's right
  // edge (so the popover can render to its right). A short
  // ``setTimeout`` hide delay gives the cursor time to traverse the
  // label→popover gap; entering the popover cancels the hide.
  const [labelHover, setLabelHover] = useState<{
    row: number;
    top: number;
    left: number;
  } | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  function scheduleHide() {
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = window.setTimeout(() => {
      setLabelHover(null);
      hideTimerRef.current = null;
    }, 180);
  }
  function cancelHide() {
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }

  // Observe container width so 'fit' mode reflows when the surrounding layout changes.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = e.contentRect.width;
        if (w > 0) setContainerW(w);
      }
    });
    obs.observe(node);
    return () => obs.disconnect();
  }, []);

  const resolved = useMemo(() => resolveConfig(data, config), [data, config]);

  // Reserve right-side gutter for row labels (in CSS px). Picked to fit ~16
  // characters of typical gene-symbol labels at 7–9px font; the consumer can
  // override via CSS on the wrapper.
  // 🛑 Opening this gutter for the strip NAMES alone was tried and
  // reverted: the gutter also carries the ROW labels, and at tile size
  // that stacked 60 sample names into 110px of smear while taking the
  // width away from the matrix — a square matrix then shrinks in both
  // directions and leaves the panel half empty. The correlation tile
  // names its grouping factor in its own footer control instead.
  // The gutter carries two different things: the row labels, and the
  // annotation strips' NAMES. It opens for either.
  const wantsRowLabels =
    !!(data.rowLabels || data.rowLabelColumns) &&
    resolved.showRowLabels !== false;
  const hasStripNames = (data.colAnnotations?.length ?? 0) > 0;
  const rowLabelGutter =
    wantsRowLabels || hasStripNames ? (rowLabelGutterWidth ?? 100) : 0;
  // Reserve top gutter for column labels. Hide the rotated text (but keep
  // a thin hover-only bar) when cells are too narrow for the rotated text
  // to fit — at narrower widths labels would just smudge into each other.
  // The hover bar still carries native `title` tooltips so the curator can
  // mouse over a column to read its label.
  const COL_LABEL_MIN_CELL_W = 9;
  const COL_LABEL_HOVER_BAR_PX = 14;
  const colLabelsRequested =
    !!data.colLabels && resolved.showColLabels !== false;
  // Annotation strip names need to be wider than the strip itself can be; they
  // hang off to the right alongside row labels (using the same gutter).
  const matrixAvailableW = Math.max(0, containerW - rowLabelGutter);

  // First-pass layout to discover cellW so we can decide whether col labels
  // actually fit. We don't subtract the col-label gutter from availableH yet
  // because the gutter depends on the layout we're computing; in the common
  // "expand to fit content" case (height = null) this is moot, and if the
  // user supplied an explicit height it stays correct after we subtract the
  // final gutter below.
  const initialLayout = useMemo(
    () => computeLayout(data, resolved, matrixAvailableW, height ?? null),
    [data, resolved, matrixAvailableW, height],
  );
  const colLabelsTextVisible =
    colLabelsRequested && initialLayout.cellW >= COL_LABEL_MIN_CELL_W;
  // The same gate for ROWS, which never had one. Row-label font size is
  // `max(7, cellH - 1)` — it floors at 7px because below that the text is
  // unreadable — while `cell.minHeight` is 2. So a 224-row matrix paints
  // 7px of text into 6px rows, 224 times, and the gutter fills with
  // vertical smear that is not a label and is not a picture. Below the
  // threshold the rows stay (hover still names the sample, via `title`
  // or `rowLabelTooltip`) and nothing is painted.
  const ROW_LABEL_MIN_CELL_H = 8;
  const rowLabelsTextVisible =
    wantsRowLabels && initialLayout.cellH >= ROW_LABEL_MIN_CELL_H;
  // Adaptive gutter: size to the longest label's rendered length instead
  // of always reserving `maxColLabelPx`. With short labels (e.g. `gene_007`)
  // the old fixed gutter left a huge empty band above the labels (they
  // anchor at the bottom of the gutter). 0.6em-per-character is a
  // reasonable Helvetica width estimate.
  const labelFontSize = Math.min(10, Math.max(7, initialLayout.cellW));
  const longestColLabelChars = (data.colLabels ?? []).reduce(
    (m, l) => Math.max(m, l?.length ?? 0),
    0,
  );
  // +12 safety so the top of the longest rotated label has headroom
  // above the gutter rather than crowding the heatmap chrome above it.
  const adaptiveLabelPx = Math.ceil(longestColLabelChars * labelFontSize * 0.6 + 12);
  const colLabelGutter = colLabelsRequested
    ? colLabelsTextVisible
      ? Math.min(resolved.maxColLabelPx, Math.max(20, adaptiveLabelPx))
      : COL_LABEL_HOVER_BAR_PX
    : 0;
  const matrixAvailableH = height != null ? height - colLabelGutter : null;

  // Real layout with the gutter applied. When height is null this returns
  // the same result as initialLayout (no height constraint either way).
  const layout = useMemo(
    () => computeLayout(data, resolved, matrixAvailableW, matrixAvailableH),
    [data, resolved, matrixAvailableW, matrixAvailableH],
  );

  // Total width of the main-grouping gaps that render.ts inserts
  // BEFORE each rendered column (except the first). The canvas matrix
  // and annotation strips already space columns by these gaps via
  // their cumulative `xs[]`; mirror the sum here so the HTML column-
  // label row and the grid's matrix track line up with the canvas.
  const totalColGap = useMemo(() => {
    const gaps = data.colGapsBefore;
    if (!gaps) return 0;
    let acc = 0;
    for (let r = 1; r < layout.columns.length; r++) {
      acc += gaps[layout.columns[r].srcStart] ?? 0;
    }
    return acc;
  }, [layout.columns, data.colGapsBefore]);
  const matrixRenderW = layout.matrixW + totalColGap;

  const renderResultRef = useRef<ReturnType<typeof renderMatrix> | null>(null);

  // Draw on every layout / data change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderResultRef.current = renderMatrix(canvas, data, config, {
      availableW: matrixAvailableW,
      availableH: matrixAvailableH,
    });
  }, [data, config, matrixAvailableW, matrixAvailableH]);

  const annotations = data.colAnnotations ?? [];
  // Per-strip height: categorical strips marked ``compact`` (batch /
  // block) render at half the configured strip height so they sit
  // below the biological factors visually.
  const stripHeights = annotations.map((a) =>
    a.kind === 'categorical' && a.compact
      ? Math.max(4, Math.floor(resolved.annotationStripHeight / 2))
      : resolved.annotationStripHeight,
  );
  const stripsH =
    annotations.length === 0
      ? 0
      : stripHeights.reduce((s, h) => s + h, 0) +
        (annotations.length - 1) * resolved.annotationStripGap;
  const gapAfterStrips = annotations.length > 0 ? 4 : 0;

  const handleMouseMove = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const rr = renderResultRef.current;
    if (!rr) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const cell = rr.cellAt(x, y);
    if (cell) {
      onCellHover?.(cell, ev);
      onPointerOver?.({ kind: 'cell', hit: cell, ev });
      return;
    }
    const strip = rr.stripAt(x, y);
    if (strip) {
      onPointerOver?.({ kind: 'strip', hit: strip, ev });
    }
  };

  const handleClick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onCellClick) return;
    const rr = renderResultRef.current;
    if (!rr) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const cell = rr.cellAt(x, y);
    if (cell) {
      onCellClick({ kind: 'cell', hit: cell, ev });
      return;
    }
    const strip = rr.stripAt(x, y);
    if (strip) {
      onCellClick({ kind: 'strip', hit: strip, ev });
    }
  };

  const wantsCanvasMouse =
    !!onCellHover || !!onPointerOver || !!onCellClick;

  return (
    <div ref={containerRef} className={className} style={{ width: '100%' }}>
      <div
        style={{
          display: 'grid',
          // Size the canvas column to the matrix width so row labels sit
          // flush against the right edge of the matrix instead of being
          // pushed out to the right by a 1fr column that filled the
          // whole container.
          gridTemplateColumns: `${matrixRenderW}px ${rowLabelGutter}px`,
          width: 'fit-content',
          gridTemplateRows: `${colLabelGutter}px ${stripsH + gapAfterStrips}px auto`,
          fontFamily: resolved.fontFamily,
        }}
      >
        {/* (1,1) column labels */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'end',
            overflow: 'hidden',
            height: colLabelGutter,
          }}
        >
          {colLabelGutter > 0 &&
            layout.columns.map((m, i) => {
              const label =
                m.srcCount === 1 ? data.colLabels?.[m.srcStart] : null;
              const fontSize = Math.min(10, Math.max(7, layout.cellW));
              return (
                // Each column slot is `cellW × colLabelGutter`. When the
                // rotated text fits (cellW >= threshold) the label span
                // is rotated -90° around its bottom-left corner so the
                // text reads UP from the bottom (legacy Gemma orientation).
                // When labels are too cramped, the slot still carries a
                // `title` attribute so curators can hover to see the
                // column name in a browser tooltip.
                <div
                  key={i}
                  title={label ?? undefined}
                  style={{
                    width: layout.cellW,
                    height: colLabelGutter,
                    position: 'relative',
                    overflow: 'hidden',
                    flex: '0 0 auto',
                    // Leading main-grouping gap — mirrors the gap the
                    // canvas draws before this column so labels stay
                    // aligned with their matrix column. No gap on the
                    // first rendered column (matches render.ts).
                    marginLeft:
                      i === 0
                        ? 0
                        : data.colGapsBefore?.[m.srcStart] ?? 0,
                    cursor: label ? 'help' : undefined,
                  }}
                >
                  {colLabelsTextVisible && label ? (
                    <span
                      style={{
                        position: 'absolute',
                        left: layout.cellW / 2 + fontSize / 2,
                        // 5px of breathing room between rotated label
                        // bottom edge and the strips/matrix top.
                        bottom: 5,
                        transform: 'rotate(-90deg)',
                        transformOrigin: 'left bottom',
                        whiteSpace: 'nowrap',
                        fontSize,
                        lineHeight: 1,
                        color: 'currentColor',
                      }}
                    >
                      {label}
                    </span>
                  ) : null}
                </div>
              );
            })}
        </div>
        {/* (1,2) empty corner above row-label gutter */}
        <div />

        {/* (2,1) + (3,1) — single canvas spans strips + matrix */}
        <div style={{ gridRow: '2 / span 2', gridColumn: '1 / span 1' }}>
          <canvas
            ref={canvasRef}
            data-heatmap-matrix="true"
            onMouseMove={wantsCanvasMouse ? handleMouseMove : undefined}
            onMouseLeave={onCellLeave}
            onClick={onCellClick ? handleClick : undefined}
            style={{
              display: 'block',
              imageRendering: 'pixelated',
              cursor: onCellClick ? 'pointer' : undefined,
            }}
          />
        </div>

        {/* (2,2) annotation strip names */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-start',
            paddingLeft: 10,
            fontSize: 12,
            color: 'currentColor',
          }}
        >
          {annotations.map((a, i) => {
            const clickable = !!onStripGutterClick;
            const compact = a.kind === 'categorical' && a.compact;
            const selected = selectedStripIndex === i;
            return (
              // Outer = layout slot: matches the canvas strip's height (so
              // labels stay aligned strip-for-strip) but does NOT clip
              // vertically. Compact (batch/block) strips are only a few px
              // tall, so tying the text's box + line-height to that height
              // — as before — cropped the label ("batch" cut off at the
              // bottom). Centre the text in the slot and let it overflow
              // into the inter-strip gap instead.
              <div
                key={`${a.name}-${i}`}
                onClick={
                  clickable
                    ? (ev) => {
                        ev.stopPropagation();
                        onStripGutterClick(i);
                      }
                    : undefined
                }
                style={{
                  height: stripHeights[i],
                  marginTop: i === 0 ? 0 : resolved.annotationStripGap,
                  display: 'flex',
                  alignItems: 'center',
                  cursor: clickable ? 'pointer' : undefined,
                }}
                title={
                  clickable
                    ? `Group columns by ${a.name}`
                    : a.name
                }
              >
                {/* Selected main-grouping strip is flagged with a small
                    amber chevron pointing at the label (replaces the old,
                    too-prominent outline box). The slot's
                    width is ALWAYS reserved so the label text sits at the
                    same x whether or not the strip is selected — selecting
                    never shifts the labels. */}
                <span
                  aria-hidden
                  style={{
                    flex: '0 0 10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 9,
                    lineHeight: 1,
                    color: '#f59e0b',
                    visibility: selected ? 'visible' : 'hidden',
                  }}
                >
                  ▶
                </span>
                {/* Inner = the text itself: its own natural line-height so
                    it's never vertically cropped; horizontal-only clip for
                    the ellipsis on long factor names. */}
                <span
                  style={{
                    minWidth: 0,
                    maxWidth: '100%',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    lineHeight: 1.2,
                    // Compact (batch/block) strips look visually quieter
                    // in the gutter too: small label, muted.
                    fontSize: compact ? 10 : undefined,
                    color: compact ? '#64748b' : undefined,
                  }}
                >
                  {a.name}
                </span>
              </div>
            );
          })}
        </div>

        {/* (3,2) row labels. Two render paths:
              - rowLabelColumns: CSS grid so columns auto-align across
                rows (gene · name · …).
              - rowLabels (string-only legacy): single column per row. */}
        {/* 🛑 `wantsRowLabels`, not `rowLabelGutter > 0`. The gutter
            also opens for the strip names, and keying the row labels off
            its width alone stacked 60 sample names into it as vertical
            smear on a tile that had asked for no row labels at all. */}
        {wantsRowLabels && !rowLabelsTextVisible ? (
          // Rows too short to letter. Kept as hoverable strips of the
          // right height so the tooltip still answers "which sample is
          // this", and so the gutter's own contents (the strip names)
          // keep their vertical origin.
          <div style={{ display: 'flex', flexDirection: 'column', paddingLeft: 6 }}>
            {Array.from({ length: layout.numRows }, (_, i) => {
              const hasTip = !!rowLabelTooltip;
              const fallback =
                data.rowLabels?.[i] ?? data.rowLabelColumns?.[i]?.join(' · ');
              return (
                <div
                  key={i}
                  title={hasTip ? undefined : fallback}
                  onMouseEnter={
                    hasTip
                      ? (e) => {
                          cancelHide();
                          const rect = (
                            e.currentTarget as HTMLDivElement
                          ).getBoundingClientRect();
                          setLabelHover({
                            row: i,
                            top: rect.top,
                            left: rect.right + 6,
                          });
                        }
                      : undefined
                  }
                  onMouseLeave={hasTip ? scheduleHide : undefined}
                  onClick={onRowLabelClick ? () => onRowLabelClick(i) : undefined}
                  style={{
                    height: layout.cellH,
                    cursor: onRowLabelClick
                      ? 'pointer'
                      : hasTip || fallback
                        ? 'help'
                        : 'default',
                  }}
                />
              );
            })}
          </div>
        ) : null}
        {rowLabelsTextVisible &&
          (data.rowLabelColumns && data.rowLabelColumns.length > 0 ? (
          <div
            style={{
              display: 'grid',
              // Leading "auto" column for the origin disc when any
              // row supplies one, then one auto per content column.
              gridTemplateColumns: (data.rowDotColors?.some((c) => c)
                ? 'auto '
                : '') +
                'auto '.repeat(
                  Math.max(...data.rowLabelColumns.map((c) => c.length)),
                ).trim(),
              columnGap: 12,
              alignContent: 'start',
              paddingLeft: 10,
              fontSize: Math.min(11, Math.max(7, layout.cellH - 1)),
              color: 'currentColor',
            }}
          >
            {data.rowLabelColumns.map((cols, i) => {
              const hasTip = !!rowLabelTooltip;
              const fallbackTitle = data.rowLabels?.[i] ?? cols.join(' · ');
              // Primary (emphasised) column = first non-numeric one, so a
              // leading FDR column doesn't steal the gene symbol's weight.
              const kinds = data.rowLabelColumnKinds;
              const primaryLabelColumn = kinds
                ? Math.max(0, kinds.findIndex((k) => k !== 'num'))
                : 0;
              const handleEnter = hasTip
                ? (e: React.MouseEvent<HTMLDivElement>) => {
                    cancelHide();
                    const rect = (
                      e.currentTarget as HTMLDivElement
                    ).getBoundingClientRect();
                    setLabelHover({
                      row: i,
                      top: rect.top,
                      left: rect.right + 6,
                    });
                  }
                : undefined;
              const handleLeave = hasTip ? scheduleHide : undefined;
              const dot = data.rowDotColors?.[i] ?? null;
              const dotTitle = data.rowDotTitles?.[i] ?? null;
              return (
                <React.Fragment key={i}>
                  {data.rowDotColors?.some((c) => c) ? (
                    <div
                      title={dotTitle ?? undefined}
                      onMouseEnter={handleEnter}
                      onMouseLeave={handleLeave}
                      style={{
                        height: layout.cellH,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: dotTitle ? 'help' : (hasTip ? 'help' : 'default'),
                      }}
                    >
                      {dot ? (
                        <span
                          style={{
                            display: 'inline-block',
                            width: Math.max(6, Math.min(10, layout.cellH - 3)),
                            height: Math.max(6, Math.min(10, layout.cellH - 3)),
                            borderRadius: '50%',
                            background: dot,
                            border: '1px solid rgba(0,0,0,0.15)',
                          }}
                        />
                      ) : null}
                    </div>
                  ) : null}
                  {cols.map((c, j) => {
                    const kind = data.rowLabelColumnKinds?.[j] ?? 'text';
                    const isNum = kind === 'num';
                    const isPrimary = j === primaryLabelColumn;
                    return (
                      <div
                        key={j}
                        title={hasTip ? undefined : fallbackTitle}
                        onMouseEnter={handleEnter}
                        onMouseLeave={handleLeave}
                        style={{
                          height: layout.cellH,
                          lineHeight: `${layout.cellH}px`,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          cursor: hasTip ? 'help' : 'default',
                          // Numeric columns (e.g. FDR) read as muted,
                          // right-aligned mono so they align on the
                          // decimal and don't compete with the symbol.
                          // Otherwise: emphasise the primary identifier
                          // (first non-numeric column), mute the rest.
                          fontFamily: isNum
                            ? '"SFMono-Regular", "Menlo", "Consolas", monospace'
                            : undefined,
                          fontVariantNumeric: isNum ? 'tabular-nums' : undefined,
                          textAlign: isNum ? 'right' : undefined,
                          color: 'currentColor',
                          // Secondary column steps back with opacity, not
                          // with a grey of its own — a fixed grey cannot be
                          // right in both themes.
                          opacity: isPrimary ? 1 : 0.65,
                          maxWidth: isNum ? 72 : isPrimary ? 120 : 200,
                        }}
                      >
                        {c}
                      </div>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', paddingLeft: 6 }}>
            {data.rowLabels?.map((lbl, i) => {
              const hasTip = !!rowLabelTooltip;
              return (
                <div
                  key={i}
                  title={hasTip ? undefined : lbl}
                  onMouseEnter={
                    hasTip
                      ? (e) => {
                          cancelHide();
                          const rect = (
                            e.currentTarget as HTMLDivElement
                          ).getBoundingClientRect();
                          setLabelHover({
                            row: i,
                            top: rect.top,
                            left: rect.right + 6,
                          });
                        }
                      : undefined
                  }
                  onMouseLeave={hasTip ? scheduleHide : undefined}
                  onClick={onRowLabelClick ? () => onRowLabelClick(i) : undefined}
                  style={{
                    height: layout.cellH,
                    lineHeight: `${layout.cellH}px`,
                    fontSize: Math.min(11, Math.max(7, layout.cellH - 1)),
                    color: 'currentColor',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    cursor: onRowLabelClick ? 'pointer' : hasTip ? 'help' : 'default',
                  }}
                >
                  {lbl}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {labelHover && rowLabelTooltip ? (
        <div
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
          style={{
            position: 'fixed',
            left: labelHover.left,
            zIndex: 50,
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 4,
            boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
            padding: '6px 8px',
            fontSize: 11,
            color: 'currentColor',
            maxWidth: 320,
            // Keep the tooltip inside the viewport. A row's content is
            // unbounded — a probe mapping to ten genes renders ten
            // blocks — and anchored at the row's top with no cap it
            // ran off the bottom of the screen, putting the overflow
            // out of reach. Anchor below the row when there's room,
            // flip to bottom-anchored when there isn't, and scroll
            // internally either way.
            ...tooltipVerticalStyle(labelHover.top),
            overflowY: 'auto',
          }}
        >
          {rowLabelTooltip(labelHover.row)}
        </div>
      ) : null}
    </div>
  );
}

/** Vertical placement for the row-label tooltip, given the hovered
 *  row's top in viewport coordinates.
 *
 *  Prefers anchoring at the row so the tooltip lines up with what it
 *  describes. When that leaves too little room to read anything, flips
 *  to bottom-anchored instead. Either way the height is capped to what
 *  actually fits, so long content scrolls inside the box rather than
 *  spilling past the viewport edge where it can't be reached.
 *
 *  Recomputed per hover, so a resize between hovers is picked up. */
function tooltipVerticalStyle(rowTop: number): React.CSSProperties {
  const MARGIN = 12;
  const MAX = 420;
  /** Below this there isn't room for more than a line or two, so
   *  anchoring at the row would be worse than flipping. */
  const MIN_USABLE = 200;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  const spaceBelow = vh - rowTop - MARGIN;
  if (spaceBelow < MIN_USABLE) {
    return { bottom: MARGIN, maxHeight: Math.min(MAX, vh - 2 * MARGIN) };
  }
  return { top: rowTop, maxHeight: Math.min(MAX, spaceBelow) };
}
