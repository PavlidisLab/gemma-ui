import { useEffect, useMemo, useRef, useState } from 'react';
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
}: HeatmapProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [containerW, setContainerW] = useState<number>(600);

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
  const rowLabelGutter = data.rowLabels && resolved.showRowLabels !== false ? 100 : 0;
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
  const adaptiveLabelPx = Math.ceil(longestColLabelChars * labelFontSize * 0.6 + 6);
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
  // Total stripped block height, including inter-strip gaps so the
  // grid row matches what the canvas renderer draws.
  const stripsH =
    annotations.length === 0
      ? 0
      : annotations.length * resolved.annotationStripHeight +
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
          gridTemplateColumns: `${layout.matrixW}px ${rowLabelGutter}px`,
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
                    cursor: label ? 'help' : undefined,
                  }}
                >
                  {colLabelsTextVisible && label ? (
                    <span
                      style={{
                        position: 'absolute',
                        left: layout.cellW / 2 + fontSize / 2,
                        bottom: 2,
                        transform: 'rotate(-90deg)',
                        transformOrigin: 'left bottom',
                        whiteSpace: 'nowrap',
                        fontSize,
                        lineHeight: 1,
                        color: '#1f2937',
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
            paddingLeft: 6,
            fontSize: 10,
            color: '#374151',
          }}
        >
          {annotations.map((a, i) => {
            const selected = selectedStripIndex === i;
            const clickable = !!onStripGutterClick;
            return (
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
                  height: resolved.annotationStripHeight,
                  lineHeight: `${resolved.annotationStripHeight}px`,
                  marginTop: i === 0 ? 0 : resolved.annotationStripGap,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  cursor: clickable ? 'pointer' : undefined,
                  // 2px amber-500 outline on the selected strip's
                  // gutter (HEATMAP_SPEC §4.2). `outline` doesn't
                  // consume layout space, so non-selected strips
                  // stay flush with the canvas strip baseline.
                  outline: selected ? '2px solid #f59e0b' : undefined,
                  outlineOffset: selected ? -1 : undefined,
                  borderRadius: 2,
                  background:
                    clickable && !selected ? 'transparent' : undefined,
                }}
                title={
                  clickable
                    ? `Group columns by ${a.name}`
                    : a.name
                }
              >
                {a.name}
              </div>
            );
          })}
        </div>

        {/* (3,2) row labels */}
        <div style={{ display: 'flex', flexDirection: 'column', paddingLeft: 6 }}>
          {data.rowLabels?.map((lbl, i) => (
            <div
              key={i}
              title={lbl}
              style={{
                height: layout.cellH,
                lineHeight: `${layout.cellH}px`,
                fontSize: Math.min(11, Math.max(7, layout.cellH - 1)),
                color: '#1f2937',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {lbl}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
