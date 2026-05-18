import { useMemo, useState } from 'react';
import {
  HeatmapWidget,
  type CategoricalAnnotation,
  type HeatmapData,
} from '@/lib/heatmap';

/**
 * Demo route for the HeatmapWidget. Renders the widget two ways:
 *   1. Embedded in the page (with chrome on).
 *   2. Inside a popover-style modal — the same widget, chromeless and
 *      sitting on top of the page, to verify it works as a drop-in
 *      popup component as well as an inline one.
 */
export function HeatmapDemo(): JSX.Element {
  const data = useMemo<HeatmapData>(() => buildSyntheticData(100, 60), []);
  const [popupOpen, setPopupOpen] = useState(false);

  return (
    <div
      style={{
        maxWidth: 1100,
        margin: '24px auto',
        padding: '0 16px',
        fontFamily: 'Helvetica, Arial, sans-serif',
        color: '#1f2937',
      }}
    >
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 18, margin: 0, fontWeight: 600 }}>
          Heatmap widget — demo
        </h1>
        <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>
          A self-contained, drop-in widget. Same component used inline and
          inside the popup.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setPopupOpen(true)}
          style={{
            padding: '6px 12px',
            fontSize: 12,
            border: '1px solid #2563eb',
            background: '#2563eb',
            color: '#fff',
            borderRadius: 4,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Open in popup
        </button>
      </div>

      <HeatmapWidget
        data={data}
        title="Expression — 100 genes × 60 samples"
        caption="Synthetic data; two latent factor groups."
      />

      {popupOpen && (
        <Popup onClose={() => setPopupOpen(false)}>
          <HeatmapWidget
            data={data}
            title="Expression heatmap"
            caption="Embedded as a popup widget."
          />
        </Popup>
      )}
    </div>
  );
}

function Popup({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.5)',
        zIndex: 900,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          maxWidth: '90vw',
          maxHeight: '90vh',
          overflow: 'auto',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="close"
          style={{
            position: 'absolute',
            top: 6,
            right: 8,
            zIndex: 2,
            background: 'transparent',
            border: 0,
            cursor: 'pointer',
            fontSize: 18,
            color: '#6b7280',
            lineHeight: 1,
            fontFamily: 'inherit',
          }}
        >
          ×
        </button>
        {children}
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
