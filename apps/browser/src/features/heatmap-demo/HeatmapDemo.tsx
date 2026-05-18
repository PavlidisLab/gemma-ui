import { useMemo, useState } from 'react';
import {
  Heatmap,
  Legend,
  PALETTES,
  type CategoricalAnnotation,
  type CellGeometry,
  type HeatmapData,
} from '@/lib/heatmap';

/**
 * Synthetic-data demo route for the heatmap lib.
 *
 * Generates a 100×60 expression matrix with two latent factor groups so the
 * patterns are visible at a glance, plus two categorical column annotations.
 * Wraps the heatmap in a resizable container so reflow behavior is visible.
 */
export function HeatmapDemo(): JSX.Element {
  const data = useMemo<HeatmapData>(() => buildSyntheticData(100, 60), []);
  const [palette, setPalette] = useState<'ambsky' | 'blackbody'>('ambsky');
  const [maxH, setMaxH] = useState(12);
  const [maxW, setMaxW] = useState(13);
  const [hover, setHover] = useState<CellGeometry | null>(null);

  const config = useMemo(
    () => ({
      palette: PALETTES[palette],
      clip: 3,
      cell: { maxHeight: maxH, maxWidth: maxW },
    }),
    [palette, maxH, maxW],
  );

  return (
    <div style={{ maxWidth: 1200, margin: '24px auto', padding: '0 16px', fontFamily: 'Helvetica, Arial, sans-serif' }}>
      <h1 style={{ fontSize: 18, marginBottom: 4 }}>Heatmap library — demo</h1>
      <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
        Drag the bottom-right corner of the dashed box to resize the viewport.
        The heatmap reflows as the available width changes.
      </p>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12, fontSize: 12, color: '#374151' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>Palette</span>
          <select
            value={palette}
            onChange={(e) => setPalette(e.target.value as 'ambsky' | 'blackbody')}
          >
            <option value="ambsky">ambsky (diverging)</option>
            <option value="blackbody">blackbody (sequential)</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>maxHeight: {maxH}px</span>
          <input type="range" min={2} max={20} value={maxH} onChange={(e) => setMaxH(+e.target.value)} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>maxWidth: {maxW}px</span>
          <input type="range" min={2} max={20} value={maxW} onChange={(e) => setMaxW(+e.target.value)} />
        </label>
        <Legend
          palette={PALETTES[palette]}
          domain={palette === 'ambsky' ? [-3, 3] : [0, 6]}
          label={palette === 'ambsky' ? 'Z-score (clip ±3)' : 'Intensity'}
        />
        <div style={{ fontSize: 11, color: '#6b7280', flex: 1, minWidth: 200 }}>
          {hover
            ? `${data.rowLabels?.[hover.row]} × ${data.colLabels?.[hover.col]}  (merged=${hover.mergedCols})`
            : 'Hover a cell.'}
        </div>
      </div>

      <div
        style={{
          resize: 'both',
          overflow: 'auto',
          border: '1px dashed #cbd5e1',
          padding: 8,
          width: 700,
          height: 520,
          minWidth: 240,
          minHeight: 220,
          background: '#fafafa',
        }}
      >
        <Heatmap
          data={data}
          config={config}
          onCellHover={(c) => setHover(c)}
          onCellLeave={() => setHover(null)}
        />
      </div>
    </div>
  );
}

function buildSyntheticData(numRows: number, numCols: number): HeatmapData {
  const rng = mulberry32(42);
  const values: Array<Array<number | null>> = [];
  const groupIsUp = (i: number) => i % 2 === 0;
  const colIsTreated = (j: number) => j >= numCols / 2;

  for (let i = 0; i < numRows; i++) {
    const row: Array<number | null> = [];
    for (let j = 0; j < numCols; j++) {
      const signal = colIsTreated(j) ? (groupIsUp(i) ? 1.4 : -1.4) : 0;
      const noise = (rng() - 0.5) * 1.2;
      const v = signal + noise;
      row.push(rng() < 0.005 ? null : v);
    }
    values.push(row);
  }

  const rowLabels = Array.from({ length: numRows }, (_, i) => `gene_${String(i + 1).padStart(3, '0')}`);
  const colLabels = Array.from({ length: numCols }, (_, j) => `sample_${j + 1}`);

  const treatment: CategoricalAnnotation = {
    name: 'treatment',
    values: Array.from({ length: numCols }, (_, j) => (colIsTreated(j) ? 'treated' : 'control')),
    palette: { treated: '#ef4444', control: '#9ca3af' },
  };
  const batch: CategoricalAnnotation = {
    name: 'batch',
    values: Array.from({ length: numCols }, (_, j) => `B${(j % 3) + 1}`),
    palette: { B1: '#2563eb', B2: '#10b981', B3: '#f59e0b' },
  };

  return { values, rowLabels, colLabels, colAnnotations: [treatment, batch] };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
