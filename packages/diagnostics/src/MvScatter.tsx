/**
 * Mean-variance scatter — one dot per probe, log2 mean vs log2
 * variance. Pure presentational. Optional polyline overlay for the
 * fit curve when the endpoint ships one.
 *
 * 🛑 **The dots are drawn on a canvas, the axes stay SVG.** They used
 * to be one `<circle>` per probe, and a probe count is not a display
 * quantity: eid 1 was 22,283 probes, eid 2800 was 41,015 — tens of
 * thousands of DOM nodes per card, laid out and repainted on every
 * resize, for marks 1.4px across at 18% opacity that no reader can tell
 * apart.
 *
 * Gemma has since decimated the endpoint to a 200x133 grid, so what
 * arrives is ~1,500 points and the DOM version would survive it. The
 * canvas stays anyway: the count is the SERVER's choice, and a
 * component that falls over when an endpoint sends more than it
 * currently does is a component waiting to fail. `means.length` is the
 * point count now, NOT the probe count — do not label it one.
 *
 * The split is by z-order, not by convenience: canvas carries the plot
 * background, the gridlines and the dots; the SVG on top carries the
 * fit curve and every piece of text. So the fit line still lands over
 * the cloud and the labels stay real text — selectable, and crisp on a
 * HiDPI screen without being redrawn at device resolution.
 */

import { useEffect, useRef } from "react";
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
  const { ref, width, height } = useContainerSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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
  const [xLo, xHi] = xRange;
  const [yLo, yHi] = yRange;
  const xTicks = niceTicks(xRange[0], xRange[1], 4);
  const yTicks = niceTicks(yRange[0], yRange[1], 4);
  const xs = scaler(xRange, [padL, padL + innerW]);
  const ys = scaler(yRange, [padT + innerH, padT]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Back the canvas at device resolution so a 0.7px radius dot is not
    // a blurred smear on a retina display, then work in CSS px.
    const dpr =
      typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 3) : 1;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = GRID;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (const t of yTicks) {
      // The half-pixel offset keeps a 0.5px hairline on one row of
      // pixels instead of spreading it over two at half intensity.
      const y = Math.round(ys(t)) + 0.25;
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + innerW, y);
    }
    for (const t of xTicks) {
      const x = Math.round(xs(t)) + 0.25;
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + innerH);
    }
    ctx.stroke();

    ctx.save();
    // Same clip the SVG applied: quantileRange trims to 0.5–99.5%, so
    // there are always points outside the axes that must not paint over
    // the labels.
    ctx.beginPath();
    ctx.rect(padL, padT, innerW, innerH);
    ctx.clip();
    ctx.fillStyle = INK;
    ctx.globalAlpha = 0.18;
    const r = 0.7;
    const n = Math.min(means.length, variances.length);
    for (let i = 0; i < n; i++) {
      const x = xs(means[i]);
      const y = ys(variances[i]);
      // A sub-pixel arc costs a path per point; at this radius a square
      // is the same mark on screen and draws several times faster.
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
    // 🛑 Primitive deps only. `scaler` returns a fresh closure and
    // `niceTicks` a fresh array on every render, so listing those would
    // redraw all 41k points whenever the parent re-rendered for any
    // reason — the cost this whole change exists to remove. The range
    // bounds and the box are what the picture actually depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [means, variances, W, H, xLo, xHi, yLo, yHi]);

  return (
    <div ref={ref} className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ width: "100%", height: "100%" }}
      />
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="absolute inset-0 w-full h-full"
        preserveAspectRatio="none"
      >
        {yTicks.map((t) => (
          <text
            key={`y${t}`}
            x={padL - 3}
            y={ys(t) + 3}
            fontSize={7}
            fill={SUBTLE}
            textAnchor="end"
            fontFamily="-apple-system, sans-serif"
          >
            {fmtNum(t)}
          </text>
        ))}
        {xTicks.map((t) => (
          <text
            key={`x${t}`}
            x={xs(t)}
            y={padT + innerH + 8}
            fontSize={7}
            fill={SUBTLE}
            textAnchor="middle"
            fontFamily="-apple-system, sans-serif"
          >
            {fmtNum(t)}
          </text>
        ))}
        {fit ? (
          <polyline
            clipPath="url(#mv-clip)"
            fill="none"
            stroke={FIT}
            strokeWidth={1}
            points={fit.sortedMeans
              .map((m, i) => `${xs(m)},${ys(fit.fittedVariances[i])}`)
              .join(" ")}
          />
        ) : null}
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
    </div>
  );
}
