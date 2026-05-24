/**
 * Mean-variance scatter — one dot per probe, log2 mean vs log2 variance.
 * Flags overdispersion, contamination, normalization weirdness.
 * Matches the panel slot from the legacy Gemma Diagnostics tab.
 *
 * The scatter is dense (typically 20–50k probes). We render with
 * low alpha + small radius and clamp to a viewBox so a single
 * outlier doesn't blow up the y-scale. Optional fit curve overlay
 * when the endpoint ships one.
 */

import { PanelCard, PanelEmpty, PanelLoading, PanelError } from "./PanelCard";
import { useMeanVariance } from "@/api/diagnostics";

const ACCENT = "#1f2937";
const SUBTLE = "#6b7280";
const GRID = "#e5e7eb";
const FIT = "#ef4444";

export function MeanVarianceCard({ experimentId }: { experimentId: number }) {
  const { data, isLoading, error } = useMeanVariance(experimentId);

  let body;
  if (isLoading) {
    body = <PanelLoading />;
  } else if (error) {
    body = <PanelError message={(error as Error).message} />;
  } else if (!data || data.means.length === 0) {
    body = (
      <PanelEmpty reason="No mean-variance data returned (HTTP 404). Either this dataset's MeanVarianceRelation hasn't been computed, or /datasets/{id}/mean-variance isn't deployed on the current Gemma build." />
    );
  } else {
    body = <MvScatter data={data} />;
  }

  return (
    <PanelCard
      title="Mean-Variance"
      footer={data?.source ? <span>computed via {data.source}</span> : null}
    >
      {body}
    </PanelCard>
  );
}

function MvScatter({
  data,
}: {
  data: ReturnType<typeof useMeanVariance>["data"] & object;
}) {
  const W = 220;
  const H = 180;
  const padL = 26;
  const padR = 6;
  const padT = 8;
  const padB = 22;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const { means, variances, fit } = data;

  // Robust ranges — drop bottom 1% / top 1% so a couple of outliers
  // don't blow up the axis. The scatter is dense; the outliers are
  // still drawn, just outside the visible plot area (we clipPath
  // the SVG to the viewBox).
  const xRange = quantileRange(means, 0.005, 0.995);
  const yRange = quantileRange(variances, 0.005, 0.995);
  const xTicks = niceTicks(xRange[0], xRange[1], 4);
  const yTicks = niceTicks(yRange[0], yRange[1], 4);
  const xs = scaler(xRange, [padL, padL + innerW]);
  const ys = scaler(yRange, [padT + innerH, padT]);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-full"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Gridlines + ticks */}
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line
            x1={padL}
            x2={padL + innerW}
            y1={ys(t)}
            y2={ys(t)}
            stroke={GRID}
            strokeWidth={0.5}
          />
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
          <line
            x1={xs(t)}
            x2={xs(t)}
            y1={padT}
            y2={padT + innerH}
            stroke={GRID}
            strokeWidth={0.5}
          />
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
      {/* Scatter */}
      <g clipPath="url(#mv-clip)">
        {means.map((m, i) => (
          <circle
            key={i}
            cx={xs(m)}
            cy={ys(variances[i])}
            r={0.7}
            fill={ACCENT}
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
          <rect
            x={padL}
            y={padT}
            width={innerW}
            height={innerH}
          />
        </clipPath>
      </defs>
      {/* Axis labels */}
      <text
        x={6}
        y={padT + innerH / 2}
        fontSize={7.5}
        fill={ACCENT}
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
        fill={ACCENT}
        textAnchor="middle"
        fontFamily="-apple-system, sans-serif"
      >
        mean (log₂)
      </text>
    </svg>
  );
}

function quantileRange(
  arr: number[],
  qLo: number,
  qHi: number,
): [number, number] {
  if (arr.length === 0) return [0, 1];
  const sorted = [...arr].sort((a, b) => a - b);
  const iLo = Math.floor(qLo * (sorted.length - 1));
  const iHi = Math.ceil(qHi * (sorted.length - 1));
  return [sorted[iLo], sorted[iHi]];
}

function scaler([d0, d1]: [number, number], [r0, r1]: [number, number]) {
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

function niceTicks(min: number, max: number, count: number): number[] {
  const step = (max - min) / count;
  if (!Number.isFinite(step) || step === 0) return [min];
  const mag = Math.pow(10, Math.floor(Math.log10(step)));
  const norm = step / mag;
  const niceStep = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  const finalStep = niceStep * mag;
  const start = Math.ceil(min / finalStep) * finalStep;
  const ticks: number[] = [];
  for (let v = start; v <= max + finalStep * 0.5; v += finalStep) {
    ticks.push(Number(v.toPrecision(6)));
  }
  return ticks;
}

function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return "";
  if (Number.isInteger(v)) return String(v);
  return Number(v.toPrecision(3)).toString();
}
