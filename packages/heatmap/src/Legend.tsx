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
  /** Optional caption above the bar. Ignored when `orientation` is
   *  `vertical` — a side legend has no room for a sentence, and its two
   *  end labels already state the range. */
  label?: string;
  /** `horizontal` (default) puts the bar above the plot with the low
   *  end at the left. `vertical` stands it up for a side rail: high at
   *  the top, low at the bottom, matching how the eye reads a scale
   *  next to a matrix. */
  orientation?: 'horizontal' | 'vertical';
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
  orientation = 'horizontal',
  className,
}: LegendProps): JSX.Element {
  const vertical = orientation === 'vertical';
  // In vertical mode the two size props swap meaning: `width` is the
  // bar's LENGTH (down the page) and `barHeight` its thickness. Callers
  // pass the space they have either way.
  const barW = vertical ? barHeight : width;
  const barL = vertical ? width : barHeight;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(barW * dpr);
    canvas.height = Math.round(barL * dpr);
    canvas.style.width = `${barW}px`;
    canvas.style.height = `${barL}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = palette.stops.length;
    const step = (vertical ? barL : barW) / n;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = palette.stops[i];
      if (vertical) {
        // Stop 0 is the LOW end, and the low end belongs at the bottom.
        ctx.fillRect(0, barL - (i + 1) * step, barW, Math.ceil(step) + 1);
      } else {
        ctx.fillRect(i * step, 0, Math.ceil(step), barL);
      }
    }
  }, [palette, barW, barL, vertical]);

  const [lo, hi] = domain;
  // Decimals from the SPAN, not a fixed 1. A sample-correlation domain
  // is 0.96-1.00 — every value rounds to "1.0", so both ends of the bar
  // printed the same number and the scale said nothing about itself.
  // Fewest decimals that actually say something: the two ends must
  // render differently, and the low end must not be rounded so far that
  // the label misstates where the scale starts. Stops at 3 — a colour
  // bar is read at a glance, and a 0.96-1.00 domain needs "0.96", not
  // "0.960". One decimal was the old fixed choice and printed "1.0" at
  // both ends of exactly that domain.
  const span = Math.abs(hi - lo);
  let decimals = 1;
  if (span > 0 && Number.isFinite(span)) {
    for (let d = 1; d <= 3; d++) {
      decimals = d;
      const drift = Math.abs(lo - Number(lo.toFixed(d)));
      if (lo.toFixed(d) !== hi.toFixed(d) && drift <= span / 10) break;
    }
  }
  const fmt = (v: number) =>
    Math.abs(v) >= 100 || (v !== 0 && Math.abs(v) < 0.01)
      ? v.toExponential(1)
      : v.toFixed(decimals);

  if (vertical) {
    return (
      <div
        className={className}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          fontFamily: 'Helvetica, Arial, sans-serif',
          fontSize: 12,
          color: 'currentColor',
        }}
      >
        <span>{fmt(hi)}</span>
        <canvas
          ref={canvasRef}
          style={{ display: 'block', imageRendering: 'pixelated', borderRadius: 2 }}
        />
        <span>{fmt(lo)}</span>
      </div>
    );
  }

  return (
    <div className={className} style={{ display: 'inline-block', fontFamily: 'Helvetica, Arial, sans-serif' }}>
      {label && (
        // currentColor, not a fixed grey: this package ships no Tailwind
        // and #6b7280 / #374151 were invisible on the dark-mode panel.
        // The surrounding surface sets a theme-aware text colour, so
        // inheriting it is correct in either theme.
        <div style={{ fontSize: 12, color: 'currentColor', opacity: 0.9, marginBottom: 3 }}>{label}</div>
      )}
      <canvas ref={canvasRef} style={{ display: 'block', imageRendering: 'pixelated' }} />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 12,
          color: 'currentColor',
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
