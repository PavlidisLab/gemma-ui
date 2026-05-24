/**
 * Inline sparkline — no axes, no legend, no chrome. ACCENT (#2563eb)
 * stroke; optional shaded area under the line.
 *
 * Sized via CSS — pass `width`/`height` as numbers OR let the
 * containing card style the wrapping span and use a 100% viewBox.
 * The default 120×28 fits next to a BigNumber.
 */

import { useMemo } from "react";
import type { Sample } from "../timeseries";
import { domainOf } from "../timeseries";

const ACCENT = "#2563eb";
const ACCENT_FAINT = "rgba(37, 99, 235, 0.12)";

export interface SparklineProps {
  samples: Sample[];
  width?: number;
  height?: number;
  /** Override the y-axis domain instead of auto-fitting. */
  domain?: [number, number];
  /** Shade the area under the line. Default `true`. */
  fill?: boolean;
  /** Stroke color override. */
  stroke?: string;
  className?: string;
  ariaLabel?: string;
}

export function Sparkline({
  samples,
  width = 120,
  height = 28,
  domain,
  fill = true,
  stroke = ACCENT,
  className,
  ariaLabel,
}: SparklineProps) {
  const path = useMemo(() => {
    if (samples.length < 2) return null;
    const [lo, hi] = domain ?? domainOf(samples);
    const t0 = samples[0].t;
    const tN = samples[samples.length - 1].t;
    const span = tN - t0 || 1;
    const yRange = hi - lo || 1;
    const xs = (t: number) => ((t - t0) / span) * width;
    const ys = (v: number) => height - ((v - lo) / yRange) * height;
    const d = samples
      .map((s, i) => `${i === 0 ? "M" : "L"}${xs(s.t).toFixed(1)},${ys(s.v).toFixed(1)}`)
      .join(" ");
    const area = `${d} L${width.toFixed(1)},${height} L0,${height} Z`;
    return { d, area };
  }, [samples, width, height, domain]);

  if (!path) {
    return (
      <span
        className={className}
        style={{ display: "inline-block", width, height }}
        aria-label={ariaLabel ?? "no data yet"}
      />
    );
  }

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel ?? "trend"}
    >
      {fill ? <path d={path.area} fill={ACCENT_FAINT} /> : null}
      <path d={path.d} stroke={stroke} strokeWidth={1.5} fill="none" />
    </svg>
  );
}
