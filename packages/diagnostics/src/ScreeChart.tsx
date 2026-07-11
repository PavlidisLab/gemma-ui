/**
 * PCA scree bar chart — pure presentational component. Render a small
 * SVG with up to MAX_BARS bars, one per leading PC, height proportional
 * to fraction-of-variance. Click handler is owned by the caller (both
 * apps zoom into the PC-loadings popup on bar click, but the popup
 * itself is app-specific because the data fetch + modal chrome differ).
 */

import { niceTicks, fmtPct } from "./math";
import { useContainerSize } from "./useContainerSize";

const ACCENT = "#2563eb";
const ACCENT_HOVER = "#1d4ed8";
const SUBTLE = "#6b7280";
const GRID = "#e5e7eb";
const TEXT = "#1f2937";

export const MAX_SCREE_BARS = 10;

export function ScreeChart({
  variances,
  onBarClick,
}: {
  /** Fraction-of-variance per PC, 0-indexed. Sliced to MAX_SCREE_BARS. */
  variances: number[];
  /** PC index (1-based) clicked. */
  onBarClick?: (pc: number) => void;
}) {
  const shown = variances.slice(0, MAX_SCREE_BARS);
  const { ref, width, height } = useContainerSize<SVGSVGElement>();
  const W = width > 0 ? width : 220;
  const H = height > 0 ? height : 180;
  const padL = 36;
  const padR = 6;
  const padT = 8;
  const padB = 34;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const max = Math.max(...shown, 0.05);
  const barGap = 2;
  const barW = (innerW - barGap * (shown.length - 1)) / shown.length;
  const yTicks = niceTicks(0, max, 4);
  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-full"
      preserveAspectRatio="none"
    >
      <rect x={0} y={0} width={W} height={H} fill="#ffffff" />
      {yTicks.map((t) => {
        const y = padT + innerH * (1 - t / max);
        return (
          <g key={t}>
            <line x1={padL} x2={padL + innerW} y1={y} y2={y} stroke={GRID} strokeWidth={0.5} />
            <text
              x={padL - 4}
              y={y + 3.5}
              fontSize={10}
              fill={SUBTLE}
              textAnchor="end"
              fontFamily="-apple-system, sans-serif"
            >
              {fmtPct(t)}
            </text>
          </g>
        );
      })}
      {shown.map((v, i) => {
        const x = padL + i * (barW + barGap);
        const barH = innerH * (v / max);
        const y = padT + innerH - barH;
        const clickable = onBarClick !== undefined;
        return (
          <g
            key={i}
            className={clickable ? "cursor-pointer" : undefined}
            onClick={clickable ? () => onBarClick!(i + 1) : undefined}
          >
            <title>
              {`PC${i + 1}: ${(v * 100).toFixed(1)}% variance${
                clickable ? " — click for top-loaded probes" : ""
              }`}
            </title>
            <rect
              x={x}
              y={y}
              width={barW}
              height={barH}
              fill={ACCENT}
              style={{ transition: "fill 80ms" }}
              onMouseEnter={
                clickable
                  ? (e) => (e.currentTarget.style.fill = ACCENT_HOVER)
                  : undefined
              }
              onMouseLeave={
                clickable
                  ? (e) => (e.currentTarget.style.fill = ACCENT)
                  : undefined
              }
            />
            <text
              x={x + barW / 2}
              y={padT + innerH + 15}
              fontSize={10}
              fill={SUBTLE}
              textAnchor="middle"
              fontFamily="-apple-system, sans-serif"
            >
              {i + 1}
            </text>
          </g>
        );
      })}
      <text
        x={10}
        y={padT + innerH / 2}
        fontSize={10.5}
        fill={TEXT}
        textAnchor="middle"
        transform={`rotate(-90 10 ${padT + innerH / 2})`}
        fontFamily="-apple-system, sans-serif"
      >
        fraction of variance
      </text>
      <text
        x={padL + innerW / 2}
        y={H - 6}
        fontSize={10.5}
        fill={TEXT}
        textAnchor="middle"
        fontFamily="-apple-system, sans-serif"
      >
        component
      </text>
    </svg>
  );
}
