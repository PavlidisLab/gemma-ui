import { useMemo } from 'react';
import { HeatmapWidget } from '@gemma/heatmap';
import type {
  Factor,
  HeatmapPayload,
  HeatmapPayloadColumn,
  HeatmapPayloadRow,
} from '@gemma/heatmap';

/**
 * Heatmap widget v2 demo — synthetic `HeatmapPayload` with the full
 * factor / factor-value / statement / outlier surface that exercises
 * the v2 additions from HEATMAP_SPEC.md:
 *
 *   - Continuous annotation strip (§3.2) — "age (years)" with a
 *     log10-ish age distribution.
 *   - Categorical annotation strips (§3.1) with explicit baselines.
 *   - Main grouping factor (§4) — click a strip's left gutter.
 *   - Tooltip on hover (§5.1) + side panel on click (§5.2) — exposes
 *     the structured statements (§5.3) with subject → predicate →
 *     object triples and ontology URIs.
 *   - Outlier indicator (§3.3) — every 17th column.
 *   - p-value + validated chip on the first 10 rows (§5.2).
 *
 * No server roundtrip — payload is generated client-side from a fixed
 * RNG seed so the demo is reproducible across reloads.
 */
export function HeatmapDemoV2(): JSX.Element {
  const payload = useMemo(() => buildSyntheticPayload(80, 48), []);

  return (
    <div
      style={{
        maxWidth: 1280,
        margin: '24px auto',
        padding: '0 16px',
        fontFamily: 'Helvetica, Arial, sans-serif',
        color: '#1f2937',
      }}
    >
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 18, margin: 0, fontWeight: 600 }}>
          Heatmap widget — v2 demo
        </h1>
        <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>
          Synthetic `HeatmapPayload`. Hover for tooltip; click a matrix
          cell or strip cell for the pinned side panel. Click a strip's
          left gutter to re-order columns by that factor (re-click to
          clear).
        </p>
      </header>

      <div
        style={{
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          padding: 12,
          background: '#fff',
        }}
      >
        <HeatmapWidget payload={payload} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Synthetic data
// ---------------------------------------------------------------------------

/** Deterministic LCG so the layout reproduces across reloads. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function buildSyntheticPayload(rows: number, cols: number): HeatmapPayload {
  const rng = makeRng(42);

  // Three factors: two categorical (with a baseline each), one
  // continuous (age in years).
  const factors: Factor[] = [
    {
      id: 1,
      name: 'tissue',
      category: { label: 'OrganismPart', uri: 'http://purl.obolibrary.org/obo/UBERON_0000465' },
      description: 'Anatomic origin of the sample.',
      type: 'categorical',
      baseline_relevance: 'required',
      factor_values: [
        {
          id: 101,
          free_text_label: 'brain',
          is_baseline: true,
          statements: [
            {
              category: { label: 'OrganismPart' },
              subject: { label: 'brain', uri: 'http://purl.obolibrary.org/obo/UBERON_0000955' },
            },
          ],
        },
        {
          id: 102,
          free_text_label: 'liver',
          is_baseline: false,
          statements: [
            {
              category: { label: 'OrganismPart' },
              subject: { label: 'liver', uri: 'http://purl.obolibrary.org/obo/UBERON_0002107' },
            },
          ],
        },
        {
          id: 103,
          free_text_label: 'kidney',
          is_baseline: false,
          statements: [
            {
              category: { label: 'OrganismPart' },
              subject: { label: 'kidney', uri: 'http://purl.obolibrary.org/obo/UBERON_0002113' },
            },
          ],
        },
      ],
    },
    {
      id: 2,
      name: 'treatment',
      category: { label: 'Treatment', uri: 'http://www.ebi.ac.uk/efo/EFO_0000727' },
      description: 'Chemical treatment applied to the sample.',
      type: 'categorical',
      baseline_relevance: 'required',
      factor_values: [
        {
          id: 201,
          free_text_label: 'vehicle',
          is_baseline: true,
          statements: [
            {
              category: { label: 'Treatment' },
              subject: {
                label: 'reference substance role',
                uri: 'http://purl.obolibrary.org/obo/OBI_0000025',
              },
            },
          ],
        },
        {
          id: 202,
          free_text_label: 'rotenone, 3 hours',
          is_baseline: false,
          statements: [
            {
              category: { label: 'Treatment' },
              subject: {
                label: 'rotenone',
                uri: 'http://purl.obolibrary.org/obo/CHEBI_28201',
              },
              predicate: {
                label: 'has duration',
                uri: 'http://purl.obolibrary.org/obo/RO_0002488',
              },
              object: { label: '3 hours' },
            },
          ],
        },
        {
          id: 203,
          free_text_label: 'rotenone, 3 days',
          is_baseline: false,
          statements: [
            {
              category: { label: 'Treatment' },
              subject: {
                label: 'rotenone',
                uri: 'http://purl.obolibrary.org/obo/CHEBI_28201',
              },
              predicate: {
                label: 'has duration',
                uri: 'http://purl.obolibrary.org/obo/RO_0002488',
              },
              object: { label: '3 days' },
            },
          ],
        },
      ],
    },
    {
      id: 3,
      name: 'age (years)',
      category: { label: 'TimeSinceBirth' },
      description: 'Donor age at sample collection.',
      type: 'continuous',
      baseline_relevance: 'not_applicable',
      factor_values: [],
      // Per-sample measurements: log-uniform 20..90 years
      continuousMeasurements: Object.fromEntries(
        Array.from({ length: cols }, (_, i) => [
          // bioAssayId starts at 1
          i + 1,
          Math.round(20 + Math.pow(rng(), 1.8) * 70),
        ]),
      ),
    },
  ];

  // Columns: round-robin tissue, randomised treatment.
  const columns: HeatmapPayloadColumn[] = Array.from({ length: cols }, (_, i) => {
    const tissueFv = [101, 102, 103][i % 3];
    const treatmentFv = [201, 202, 203][Math.floor(rng() * 3)];
    return {
      bioAssayId: i + 1,
      bioMaterialId: 10_000 + i + 1,
      name: `GSM${1_000_000 + i}`,
      // Every 17th sample is an outlier.
      outlier: i > 0 && i % 17 === 0,
      factorValueIds: {
        1: tissueFv,
        2: treatmentFv,
        // The continuous factor maps each column to itself via
        // `continuousMeasurements` — no FV-id mapping needed.
      },
    };
  });

  // Rows: probe IDs + gene symbols. First 10 carry diffex metadata.
  const geneStems = [
    'BRCA',
    'TP',
    'EGFR',
    'KRAS',
    'PTEN',
    'APC',
    'TNF',
    'IL6',
    'CD4',
    'CD8A',
  ];
  const rowsArr: HeatmapPayloadRow[] = Array.from({ length: rows }, (_, i) => {
    const stem = geneStems[i % geneStems.length];
    const sym = `${stem}${1 + (i % 5)}`;
    return {
      designElementId: 5_000_000 + i,
      designElementName: `ILMN_${2_000_000 + i}`,
      geneIds: [10_000 + i],
      geneSymbols: [sym],
      pvalue: i < 10 ? Math.pow(10, -rng() * 6) : undefined,
      validated: i < 10 ? rng() > 0.5 : undefined,
    };
  });

  // Matrix: row-by-row gaussian noise with a small treatment effect
  // (rotenone-treated samples shifted +0.4 on first 20 probes), so
  // the heatmap shows visible structure when sorted by treatment.
  const values: number[][] = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const col = columns[c];
      const shift =
        r < 20 && col.factorValueIds[2] !== 201 ? 0.4 : 0;
      // box-muller
      const u1 = Math.max(rng(), 1e-6);
      const u2 = rng();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return Math.round((z + shift) * 100) / 100;
    }),
  );

  return {
    datasetId: 999_999,
    matrix: {
      values,
      rows,
      cols,
      quantitationType: {
        name: 'log2 ratio',
        isPreferred: true,
        isRatio: true,
        scale: 'log2',
      },
    },
    rows: rowsArr,
    columns,
    factors,
  };
}
