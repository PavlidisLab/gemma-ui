/**
 * PC × factor association — grouped bars (PC1 / PC2 / PC3 from darkest
 * to lightest blue). Pure presentational; the per-factor association
 * values are computed by the caller via `computePcFactorAssociations`.
 */

import { truncate } from "./math";

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

export function PcFactorBars({ rows, nPcs }: { rows: PcFactorBarRow[]; nPcs: number }) {
  const W = 220;
  const H = 180;
  const padL = 22;
  const padR = 6;
  const padT = 8;
  const padB = 38;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const groupGap = 4;
  const groupW = (innerW - groupGap * (rows.length - 1)) / rows.length;
  const barGap = 1;
  const barW = (groupW - barGap * (nPcs - 1)) / nPcs;
  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-full"
      preserveAspectRatio="xMidYMid meet"
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
            x={padL - 3}
            y={padT + innerH * (1 - t) + 3}
            fontSize={7}
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
                  key={pi}
                  x={x}
                  y={padT + innerH - h}
                  width={barW}
                  height={h}
                  fill={PC_COLORS[pi]}
                >
                  <title>{`${r.label}: PC${pi + 1} = ${v.toFixed(3)}`}</title>
                </rect>
              );
            })}
            <text
              x={gx + groupW / 2}
              y={padT + innerH + 10}
              fontSize={7}
              fill={TEXT}
              textAnchor="middle"
              fontFamily="-apple-system, sans-serif"
              transform={`rotate(-25 ${gx + groupW / 2} ${padT + innerH + 10})`}
            >
              {truncate(r.label, 14)}
            </text>
          </g>
        );
      })}
      <text
        x={6}
        y={padT + innerH / 2}
        fontSize={7.5}
        fill={TEXT}
        textAnchor="middle"
        transform={`rotate(-90 6 ${padT + innerH / 2})`}
        fontFamily="-apple-system, sans-serif"
      >
        association
      </text>
      <g>
        {PC_COLORS.slice(0, nPcs).map((c, i) => (
          <g key={i}>
            <rect x={padL + i * 38} y={H - 8} width={8} height={5} fill={c} />
            <text
              x={padL + i * 38 + 10}
              y={H - 4}
              fontSize={7}
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
