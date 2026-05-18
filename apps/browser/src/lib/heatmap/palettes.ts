import type { Palette } from './types';

/**
 * Built-in palettes.
 *
 * Defaults reflect the Pavlab "pavlab_heatmap" style:
 * - `ambsky`    : diverging amber → black → sky, centered at zero. Default
 *                 for signed / Z-score-like data; zero-ish values look "off"
 *                 against the dark midpoint, which is the desired property.
 * - `blackbody` : sequential black → red → orange → yellow → white. Matches
 *                 the legacy Gemma heatmap palette; used for non-diverging
 *                 data (intensities, counts, etc.).
 *
 * Other lab-approved palettes will land here as needed.
 */

const AMBSKY_STOPS = [
  '#f59e0b', // amber-500
  '#c2840a',
  '#8e6a09',
  '#5b4f07',
  '#2c2c0a',
  '#000000',
  '#093247',
  '#0c5277',
  '#0e72a6',
  '#0c93cf',
  '#0ea5e9', // sky-500
];

const BLACKBODY_STOPS = [
  'rgb(0,0,0)',
  'rgb(32,0,0)',
  'rgb(64,0,0)',
  'rgb(96,0,0)',
  'rgb(128,0,0)',
  'rgb(159,32,0)',
  'rgb(191,64,0)',
  'rgb(223,96,0)',
  'rgb(255,128,0)',
  'rgb(255,159,32)',
  'rgb(255,191,64)',
  'rgb(255,223,96)',
  'rgb(255,255,128)',
  'rgb(255,255,159)',
  'rgb(255,255,191)',
  'rgb(255,255,223)',
  'rgb(255,255,255)',
];

export const PALETTES = {
  ambsky: { kind: 'diverging', stops: AMBSKY_STOPS } satisfies Palette,
  blackbody: { kind: 'sequential', stops: BLACKBODY_STOPS } satisfies Palette,
} as const;

export const DEFAULT_PALETTE: Palette = PALETTES.ambsky;
