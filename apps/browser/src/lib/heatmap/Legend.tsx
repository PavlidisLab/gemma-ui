import { useEffect, useRef } from 'react';
import type { Palette } from './types';
import { DEFAULT_PALETTE } from './palettes';

export interface LegendProps {
  palette?: Palette;
  /** Diverging: ±clip. Sequential: [lo, hi]. */
  domain: [number, number];
  /** Width in CSS pixels. Default 160. */
  width?: number;
  /** Height of the color bar in CSS pixels. Default 10. */
  barHeight?: number;
  /** Optional caption above the bar. */
  label?: string;
  className?: string;
}

/**
 * Compact horizontal value-scale legend. Matches the heatmap's binning
 * (nearest-neighbor sampling of palette stops) so the bar looks identical
 * to the rendered cells. DPR-aware.
 */
export function Legend({
  palette = DEFAULT_PALETTE,
  domain,
  width = 160,
  barHeight = 10,
  label,
  className,
}: LegendProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(barHeight * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${barHeight}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = palette.stops.length;
    const step = width / n;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = palette.stops[i];
      ctx.fillRect(i * step, 0, Math.ceil(step), barHeight);
    }
  }, [palette, width, barHeight]);

  const [lo, hi] = domain;
  const fmt = (v: number) =>
    Math.abs(v) >= 100 || Math.abs(v) < 0.01 ? v.toExponential(1) : v.toFixed(1);

  return (
    <div className={className} style={{ display: 'inline-block', fontFamily: 'Helvetica, Arial, sans-serif' }}>
      {label && (
        <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 2 }}>{label}</div>
      )}
      <canvas ref={canvasRef} style={{ display: 'block', imageRendering: 'pixelated' }} />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 10,
          color: '#374151',
          marginTop: 2,
          width,
        }}
      >
        <span>{fmt(lo)}</span>
        <span>{fmt(hi)}</span>
      </div>
    </div>
  );
}
