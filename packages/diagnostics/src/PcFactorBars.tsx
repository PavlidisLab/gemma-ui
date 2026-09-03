/**
 * PC × factor association — grouped bars (PC1 / PC2 / PC3 from darkest
 * to lightest blue). Pure presentational; the per-factor association
 * values are computed by the caller via `computePcFactorAssociations`.
 */

import { truncate } from "./math";
import { useContainerSize } from "./useContainerSize";

const PC_COLORS = ["#1e3a8a", "#3b82f6", "#93c5fd"]; // blue-900 / 500 / 300
const TEXT = "#1f2937";
const SUBTLE = "#6b7280";
const GRID = "#e5e7eb";

export interface PcFactorBarRow {
  /** Human label for the factor — drives the x-axis tick. */
  label: string;
  /** Per-PC association strength in [0, 1]. */
  values: number[];
}

export function PcFactorBars({
  rows,
  nPcs,
  onBarClick,
}: {
  rows: PcFactorBarRow[];
  nPcs: number;
  /** Open the underlying data for one (factor, PC). `pc` is 1-based.
   *  A bar states an association; the plot behind it is how a reader
   *  checks whether they believe it. */
  onBarClick?: (rowIndex: number, pc: number) => void;
}) {
  const { ref, width, height } = useContainerSize<SVGSVGElement>();
  const W = width > 0 ? width : 220;
  const H = height > 0 ? height : 180;
  const padL = 32;
  const padR = 6;
  const padT = 8;
  const padB = 48;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const groupGap = 4;
  const groupW = (innerW - groupGap * (rows.length - 1)) / rows.length;
  const barGap = 1;
  const barW = (groupW - barGap * (nPcs - 1)) / nPcs;
  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-full"
      preserveAspectRatio="none"
    >
      <rect x={0} y={0} width={W} height={H} fill="#ffffff" />
      {yTicks.map((t) => (
        <g key={t}>
          <line
            x1={padL}
            x2={padL + innerW}
            y1={padT + innerH * (1 - t)}
            y2={padT + innerH * (1 - t)}
            stroke={GRID}
            strokeWidth={0.5}
          />
          <text
            x={padL - 4}
            y={padT + innerH * (1 - t) + 3.5}
            fontSize={10}
            fill={SUBTLE}
            textAnchor="end"
            fontFamily="-apple-system, sans-serif"
          >
            {t.toFixed(2)}
          </text>
        </g>
      ))}
      {rows.map((r, gi) => {
        const gx = padL + gi * (groupW + groupGap);
        return (
          <g key={gi}>
            {r.values.map((v, pi) => {
              const x = gx + pi * (barW + barGap);
              const h = innerH * Math.min(1, Math.max(0, v));
              return (
                <rect
                  key={`bar-${pi}`}
                  x={x}
                  y={padT + innerH - h}
                  width={barW}
                  height={h}
                  fill={PC_COLORS[pi]}
                  pointerEvents="none"
                />
              );
            })}
            {r.values.map((v, pi) => {
              const x = gx + pi * (barW + barGap);
              return (
                <rect
                  key={pi}
                  x={x}
                  // 🛑 The full-height hit area, not the drawn bar. A
                  // near-zero association is a 1px target, and those are
                  // exactly the ones a reader wants to open to find out
                  // whether "no association" is real or an artefact.
                  y={padT}
                  width={barW}
                  height={innerH}
                  fill="transparent"
                  style={onBarClick ? { cursor: "pointer" } : undefined}
                  onClick={onBarClick ? () => onBarClick(gi, pi + 1) : undefined}
                >
                  <title>{`${r.label}: PC${pi + 1} = ${v.toFixed(3)}${onBarClick ? " — click for the data behind it" : ""}`}</title>
                </rect>
              );
            })}
            <text
              x={gx + groupW / 2}
              y={padT + innerH + 14}
              fontSize={10}
              fill={TEXT}
              textAnchor="middle"
              fontFamily="-apple-system, sans-serif"
              transform={`rotate(-25 ${gx + groupW / 2} ${padT + innerH + 14})`}
            >
              {truncate(r.label, 14)}
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
        association
      </text>
      <g>
        {PC_COLORS.slice(0, nPcs).map((c, i) => (
          <g key={i}>
            <rect x={padL + i * 46} y={H - 11} width={10} height={8} fill={c} />
            <text
              x={padL + i * 46 + 13}
              y={H - 3}
              fontSize={10}
              fill={TEXT}
              fontFamily="-apple-system, sans-serif"
            >
              PC{i + 1}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}
