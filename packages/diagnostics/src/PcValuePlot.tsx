/**
 * One factor against one principal component — the data behind a bar
 * in `PcFactorBars`.
 *
 * Gemma 1.0 had this and 2.0 did not: a bar states an association, and
 * a reader who wants to know whether to believe it needs to see the
 * samples (Paul, 2026-09-02: *"clicking on these should bring up the
 * plots of value vs loading, like in gemma 1"*).
 *
 * Two shapes, because two kinds of factor:
 *
 * - **Categorical → strip chart.** One column per level, one dot per
 *   sample, jittered horizontally so ties are countable, with the
 *   level's median drawn as a bar. A box plot would hide n, and n is
 *   usually small enough here that the individual samples ARE the
 *   evidence — a "difference" between groups of three is a claim about
 *   six points, and the reader should see all six.
 * - **Continuous → scatter**, value on x, component score on y.
 *
 * Pure presentation: the caller resolves samples to values and scores.
 */
import { useContainerSize } from "./useContainerSize";
import { niceTicks, fmtNum } from "./math";

const INK = "#1f2937";
const SUBTLE = "#6b7280";
const GRID = "#e5e7eb";
const DOT = "#2563eb";
const OUTLIER = "#f59e0b";
const MEDIAN = "#1f2937";

export interface PcValuePoint {
  /** Level name for a categorical factor; ignored when `x` is set. */
  group?: string;
  /** Measurement for a continuous factor. */
  x?: number;
  /** The sample's score on the component. */
  y: number;
  label?: string;
  /** Flagged or predicted outlier — drawn apart, since "the outlier is
   *  also the extreme on this factor" is the thing worth seeing. */
  outlier?: boolean;
}

export function PcValuePlot({
  points,
  kind,
  xLabel,
  yLabel,
  xFormat,
  pointRadius = 4.5,
}: {
  points: PcValuePoint[];
  kind: "categorical" | "continuous";
  xLabel: string;
  yLabel: string;
  /** Render an x tick. Epoch milliseconds are the reason this exists —
   *  `1172680000000` on an axis is a number nobody can read as a date. */
  xFormat?: (v: number) => string;
  /** 🛑 Generous by default. Paul, 2026-09-02: *"The plots don't have to
   *  be large. The points have to be."* Three small multiples beat one
   *  big plot for comparing components, but only if a dot survives the
   *  shrinking. */
  pointRadius?: number;
}) {
  const { ref, width, height } = useContainerSize<SVGSVGElement>();
  const W = width > 0 ? width : 520;
  const H = height > 0 ? height : 320;
  const padL = 54;
  const padR = 12;
  const padT = 10;
  const padB = kind === "categorical" ? 64 : 58;
  const innerW = Math.max(10, W - padL - padR);
  const innerH = Math.max(10, H - padT - padB);

  const ys = points.map((p) => p.y).filter((v) => Number.isFinite(v));
  if (ys.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-slate-500">
        No samples resolved for this factor.
      </div>
    );
  }
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const yPad = (yMax - yMin || 1) * 0.08;
  const y0 = yMin - yPad;
  const y1 = yMax + yPad;
  const sy = (v: number) => padT + innerH - ((v - y0) / (y1 - y0)) * innerH;
  const yTicks = niceTicks(y0, y1, 5);
  /** 🛑 Snap a tick that is zero to zero. `niceTicks` computes its steps
   *  in floating point, so the tick at the origin arrives as
   *  `-3.78e-17` and an axis label reads as a measurement rather than
   *  as the middle of the scale. The threshold is relative to the
   *  span, so this never eats a real small value. */
  const tickLabel = (t: number) =>
    Math.abs(t) < (y1 - y0) * 1e-9 ? "0" : fmtNum(t);

  // Deterministic jitter: the same sample sits in the same place on
  // every render, so a reader can point at a dot and come back to it.
  const jitter = (i: number, span: number) =>
    (((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 - 0.5) * span;

  let marks: JSX.Element[] = [];
  let xAxis: JSX.Element[] = [];

  if (kind === "categorical") {
    const groups = Array.from(new Set(points.map((p) => p.group ?? "—")));
    const bandW = innerW / Math.max(1, groups.length);
    marks = points.map((p, i) => {
      const gi = groups.indexOf(p.group ?? "—");
      const cx = padL + gi * bandW + bandW / 2 + jitter(i, bandW * 0.55);
      return (
        <circle
          key={i}
          cx={cx}
          cy={sy(p.y)}
          r={pointRadius}
          fill={p.outlier ? OUTLIER : DOT}
          fillOpacity={p.outlier ? 0.95 : 0.65}
          stroke={p.outlier ? OUTLIER : "none"}
        >
          <title>{`${p.label ?? ""}${p.label ? " · " : ""}${p.group ?? ""}: ${fmtNum(p.y)}`}</title>
        </circle>
      );
    });
    xAxis = groups.map((g, gi) => {
      const cx = padL + gi * bandW + bandW / 2;
      const vals = points.filter((p) => (p.group ?? "—") === g).map((p) => p.y).sort((a, b) => a - b);
      const med = vals.length
        ? vals.length % 2
          ? vals[(vals.length - 1) / 2]
          : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2
        : null;
      return (
        <g key={g}>
          {med != null ? (
            <line
              x1={cx - bandW * 0.32}
              x2={cx + bandW * 0.32}
              y1={sy(med)}
              y2={sy(med)}
              stroke={MEDIAN}
              strokeWidth={1.5}
            />
          ) : null}
          <text
            x={cx}
            y={padT + innerH + 14}
            fontSize={10}
            fill={INK}
            textAnchor="end"
            fontFamily="-apple-system, sans-serif"
            transform={`rotate(-30 ${cx} ${padT + innerH + 14})`}
          >
            {g.length > 22 ? `${g.slice(0, 21)}…` : g}
          </text>
          <text x={cx} y={padT + innerH + 30} fontSize={9} fill={SUBTLE} textAnchor="middle" fontFamily="-apple-system, sans-serif">
            n={vals.length}
          </text>
        </g>
      );
    });
  } else {
    const xs = points.map((p) => p.x).filter((v): v is number => Number.isFinite(v as number));
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const xPad = (xMax - xMin || 1) * 0.06;
    const a0 = xMin - xPad;
    const a1 = xMax + xPad;
    const sx = (v: number) => padL + ((v - a0) / (a1 - a0)) * innerW;
    marks = points
      .filter((p) => Number.isFinite(p.x as number))
      .map((p, i) => (
        <circle
          key={i}
          cx={sx(p.x as number)}
          cy={sy(p.y)}
          r={pointRadius}
          fill={p.outlier ? OUTLIER : DOT}
          fillOpacity={p.outlier ? 0.95 : 0.65}
        >
          <title>{`${p.label ?? ""}${p.label ? " · " : ""}${xFormat ? xFormat(p.x as number) : fmtNum(p.x as number)} → ${fmtNum(p.y)}`}</title>
        </circle>
      ));
    xAxis = niceTicks(a0, a1, xFormat ? 3 : 5).map((t) => (
      <g key={t}>
        <text
          x={sx(t)}
          y={padT + innerH + 14}
          fontSize={9}
          fill={SUBTLE}
          textAnchor="end"
          fontFamily="-apple-system, sans-serif"
          transform={`rotate(-35 ${sx(t)} ${padT + innerH + 14})`}
        >
          {xFormat ? xFormat(t) : fmtNum(t)}
        </text>
      </g>
    ));
  }

  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      <rect x={0} y={0} width={W} height={H} fill="#ffffff" />
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={sy(t)} y2={sy(t)} stroke={GRID} strokeWidth={1} />
          <text x={padL - 6} y={sy(t) + 3} fontSize={10} fill={SUBTLE} textAnchor="end" fontFamily="-apple-system, sans-serif">
            {tickLabel(t)}
          </text>
        </g>
      ))}
      {marks}
      {xAxis}
      <text
        x={12}
        y={padT + innerH / 2}
        fontSize={10}
        fill={INK}
        textAnchor="middle"
        fontFamily="-apple-system, sans-serif"
        transform={`rotate(-90 12 ${padT + innerH / 2})`}
      >
        {yLabel}
      </text>
      <text x={padL + innerW / 2} y={H - 2} fontSize={10} fill={INK} textAnchor="middle" fontFamily="-apple-system, sans-serif">
        {xLabel}
      </text>
    </svg>
  );
}
