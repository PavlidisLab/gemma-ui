/**
 * Mean-variance scatter — one dot per probe, log2 mean vs log2
 * variance. Pure presentational. Optional polyline overlay for the
 * fit curve when the endpoint ships one.
 */

import { niceTicks, quantileRange, scaler, fmtNum } from "./math";
import { useContainerSize } from "./useContainerSize";

const INK = "#1f2937";
const SUBTLE = "#6b7280";
const GRID = "#e5e7eb";
const FIT = "#ef4444";

export interface MvScatterData {
  means: number[];
  variances: number[];
  /** Optional smooth fit overlay. Both arrays must be the same length. */
  fit?: {
    sortedMeans: number[];
    fittedVariances: number[];
  } | null;
}

export function MvScatter({ data }: { data: MvScatterData }) {
  const { ref, width, height } = useContainerSize<SVGSVGElement>();
  const W = width > 0 ? width : 220;
  const H = height > 0 ? height : 180;
  const padL = 26;
  const padR = 6;
  const padT = 8;
  const padB = 22;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const { means, variances, fit } = data;

  const xRange = quantileRange(means, 0.005, 0.995);
  const yRange = quantileRange(variances, 0.005, 0.995);
  const xTicks = niceTicks(xRange[0], xRange[1], 4);
  const yTicks = niceTicks(yRange[0], yRange[1], 4);
  const xs = scaler(xRange, [padL, padL + innerW]);
  const ys = scaler(yRange, [padT + innerH, padT]);

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-full"
      preserveAspectRatio="none"
    >
      <rect x={0} y={0} width={W} height={H} fill="#ffffff" />
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line x1={padL} x2={padL + innerW} y1={ys(t)} y2={ys(t)} stroke={GRID} strokeWidth={0.5} />
          <text
            x={padL - 3}
            y={ys(t) + 3}
            fontSize={7}
            fill={SUBTLE}
            textAnchor="end"
            fontFamily="-apple-system, sans-serif"
          >
            {fmtNum(t)}
          </text>
        </g>
      ))}
      {xTicks.map((t) => (
        <g key={`x${t}`}>
          <line x1={xs(t)} x2={xs(t)} y1={padT} y2={padT + innerH} stroke={GRID} strokeWidth={0.5} />
          <text
            x={xs(t)}
            y={padT + innerH + 8}
            fontSize={7}
            fill={SUBTLE}
            textAnchor="middle"
            fontFamily="-apple-system, sans-serif"
          >
            {fmtNum(t)}
          </text>
        </g>
      ))}
      <g clipPath="url(#mv-clip)">
        {means.map((m, i) => (
          <circle
            key={i}
            cx={xs(m)}
            cy={ys(variances[i])}
            r={0.7}
            fill={INK}
            fillOpacity={0.18}
          />
        ))}
        {fit ? (
          <polyline
            fill="none"
            stroke={FIT}
            strokeWidth={1}
            points={fit.sortedMeans
              .map((m, i) => `${xs(m)},${ys(fit.fittedVariances[i])}`)
              .join(" ")}
          />
        ) : null}
      </g>
      <defs>
        <clipPath id="mv-clip">
          <rect x={padL} y={padT} width={innerW} height={innerH} />
        </clipPath>
      </defs>
      <text
        x={6}
        y={padT + innerH / 2}
        fontSize={7.5}
        fill={INK}
        textAnchor="middle"
        transform={`rotate(-90 6 ${padT + innerH / 2})`}
        fontFamily="-apple-system, sans-serif"
      >
        variance (log₂)
      </text>
      <text
        x={padL + innerW / 2}
        y={H - 4}
        fontSize={7.5}
        fill={INK}
        textAnchor="middle"
        fontFamily="-apple-system, sans-serif"
      >
        mean (log₂)
      </text>
    </svg>
  );
}
