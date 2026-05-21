/**
 * Side panel for pinned matrix-cell / strip-cell detail
 * (HEATMAP_SPEC §5.2). Docked to the right of the heatmap, ~360px
 * wide. Closes via the × button, Esc, or click outside.
 *
 * The panel content branches on what the curator clicked:
 *   - matrix cell  → probe/gene + sample + value sections
 *   - strip cell   → factor metadata + clicked sample's FV + statements
 */
import { useEffect, useRef, type CSSProperties } from 'react';
import { OntologyTermLink } from '../ontology/OntologyTermLink';
import { continuousValueOf, parseFactorUnit } from './payload';
import type {
  Factor,
  HeatmapPayload,
  HeatmapPayloadColumn,
  HeatmapPayloadRow,
  Statement,
} from './payload';

const TEXT = '#1f2937';
const SUBTLE = '#6b7280';
const BORDER = '#e5e7eb';
const ACCENT = '#2563eb';
const ACCENT_3 = '#f59e0b';
const SURFACE_SUNK = '#fafafa';
const MONO = '"SFMono-Regular", "Menlo", "Consolas", monospace';

export type SidePanelClick =
  | { kind: 'cell'; row: number; col: number; value: number | null }
  | { kind: 'strip'; stripIndex: number; col: number };

export interface SidePanelProps {
  payload: HeatmapPayload;
  click: SidePanelClick;
  onClose: () => void;
  /** Optional matrix data for the sparkline (row of values across
   *  all samples — usually the row-standardised row). */
  rowValues?: Array<number | null>;
  /** Format numbers consistently with the matrix tooltip / legend. */
  formatValue?: (v: number) => string;
}

export function SidePanel({
  payload,
  click,
  onClose,
  rowValues,
  formatValue,
}: SidePanelProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);

  // Esc + click-outside dismiss.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onClickOutside = (e: MouseEvent) => {
      const node = ref.current;
      if (!node) return;
      if (e.target instanceof Node && !node.contains(e.target)) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    // `mousedown` fires before `click` synthesised by canvas + React;
    // using mousedown lets us tell "click outside" from "click on
    // canvas that opened this panel" reliably (the panel mounts
    // after the canvas click).
    window.addEventListener('mousedown', onClickOutside);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClickOutside);
    };
  }, [onClose]);

  const fmt =
    formatValue ??
    ((v: number) =>
      Math.abs(v) >= 100 || (Math.abs(v) < 0.01 && v !== 0)
        ? v.toExponential(2)
        : v.toFixed(2));

  const containerStyle: CSSProperties = {
    width: 360,
    flex: '0 0 360px',
    border: `1px solid ${BORDER}`,
    borderRadius: 4,
    background: '#fff',
    color: TEXT,
    fontFamily: 'Helvetica, Arial, sans-serif',
    fontSize: 12,
    boxShadow: '0 2px 8px rgba(15, 23, 42, 0.06)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '80vh',
  };

  return (
    <div ref={ref} style={containerStyle}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: `1px solid ${BORDER}`,
          background: SURFACE_SUNK,
        }}
      >
        <div style={{ fontSize: 11, color: SUBTLE, letterSpacing: 0.3 }}>
          {click.kind === 'cell' ? 'CELL DETAIL' : 'STRIP DETAIL'}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            border: 0,
            background: 'transparent',
            color: SUBTLE,
            fontSize: 16,
            lineHeight: 1,
            cursor: 'pointer',
            padding: 2,
          }}
        >
          ×
        </button>
      </header>
      <div style={{ overflow: 'auto', padding: 12 }}>
        {click.kind === 'cell' ? (
          <CellDetail
            payload={payload}
            row={click.row}
            col={click.col}
            value={click.value}
            rowValues={rowValues}
            fmt={fmt}
          />
        ) : (
          <StripDetail
            payload={payload}
            stripIndex={click.stripIndex}
            col={click.col}
            fmt={fmt}
          />
        )}
      </div>
    </div>
  );
}

// ─── matrix cell ────────────────────────────────────────────────────

function CellDetail({
  payload,
  row,
  col,
  value,
  rowValues,
  fmt,
}: {
  payload: HeatmapPayload;
  row: number;
  col: number;
  value: number | null;
  rowValues?: Array<number | null>;
  fmt: (v: number) => string;
}): JSX.Element {
  const rowMeta = payload.rows[row];
  const colMeta = payload.columns[col];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ProbeGeneSection row={rowMeta} qt={payload.matrix.quantitationType} />
      <SampleSection payload={payload} column={colMeta} />
      <ValueSection
        value={value}
        rowValues={rowValues}
        colIndex={col}
        fmt={fmt}
      />
    </div>
  );
}

function ProbeGeneSection({
  row,
  qt,
}: {
  row: HeatmapPayloadRow | undefined;
  qt: HeatmapPayload['matrix']['quantitationType'];
}) {
  if (!row) return <SectionHeader>Probe / gene (unknown)</SectionHeader>;
  return (
    <section>
      <SectionHeader>Probe / gene</SectionHeader>
      <KV label="Design elt.">{row.designElementName}</KV>
      <KV label="Gene(s)">
        {row.geneSymbols.length === 0 ? (
          <em style={{ color: SUBTLE }}>none</em>
        ) : (
          row.geneSymbols.map((sym, i) => (
            <span key={i}>
              {i > 0 ? ', ' : ''}
              <a
                href={`/gene/${row.geneIds[i] ?? sym}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: ACCENT, textDecoration: 'none' }}
              >
                {sym}
              </a>
            </span>
          ))
        )}
      </KV>
      <KV label="QT">
        {qt.name}{' '}
        <span style={{ color: SUBTLE }}>
          ({qt.scale}
          {qt.isRatio ? ', ratio' : ''}
          {qt.isPreferred ? ', preferred' : ''})
        </span>
      </KV>
      {row.pvalue != null && (
        <KV label="p-value">
          <span style={{ fontFamily: MONO }}>{row.pvalue.toExponential(2)}</span>
          {row.validated ? (
            <Chip color={ACCENT_3} style={{ marginLeft: 8 }}>
              validated
            </Chip>
          ) : null}
        </KV>
      )}
    </section>
  );
}

function SampleSection({
  payload,
  column,
}: {
  payload: HeatmapPayload;
  column: HeatmapPayloadColumn | undefined;
}) {
  if (!column) return <SectionHeader>Sample (unknown)</SectionHeader>;
  return (
    <section>
      <SectionHeader>Sample</SectionHeader>
      <KV label="Name">{column.name}</KV>
      <KV label="BioAssay">
        <span style={{ fontFamily: MONO }}>{column.bioAssayId}</span>
      </KV>
      <KV label="BioMaterial">
        <span style={{ fontFamily: MONO }}>{column.bioMaterialId}</span>
      </KV>
      {column.outlier && (
        <KV label="Status">
          <Chip color="#ef4444">outlier</Chip>
        </KV>
      )}
      <div style={{ marginTop: 8 }}>
        <FactorAssignmentTable payload={payload} column={column} />
      </div>
    </section>
  );
}

function FactorAssignmentTable({
  payload,
  column,
}: {
  payload: HeatmapPayload;
  column: HeatmapPayloadColumn;
}) {
  if (payload.factors.length === 0) {
    return (
      <div style={{ color: SUBTLE, fontStyle: 'italic' }}>
        no factors on this dataset
      </div>
    );
  }
  return (
    <table
      style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: 11,
        tableLayout: 'fixed',
      }}
    >
      <thead>
        <tr style={{ color: SUBTLE, textAlign: 'left' }}>
          <th style={{ padding: '4px 4px', fontWeight: 500, width: '34%' }}>
            Factor
          </th>
          <th style={{ padding: '4px 4px', fontWeight: 500 }}>Assignment</th>
        </tr>
      </thead>
      <tbody>
        {payload.factors.map((factor) => (
          <FactorRow key={factor.id} factor={factor} column={column} />
        ))}
      </tbody>
    </table>
  );
}

function FactorRow({
  factor,
  column,
}: {
  factor: Factor;
  column: HeatmapPayloadColumn;
}) {
  const fvId = column.factorValueIds[factor.id];
  const fv = fvId != null ? factor.factor_values.find((v) => v.id === fvId) : undefined;
  const isContinuous = factor.type === 'continuous';
  const numericValue = isContinuous ? continuousValueOf(factor, column) : null;
  const unit = parseFactorUnit(factor.name);
  return (
    <tr style={{ borderTop: `1px solid ${BORDER}` }}>
      <td style={{ padding: '4px 4px', verticalAlign: 'top' }}>
        <div>
          <OntologyTermLink term={factor.category} />
        </div>
        <div style={{ fontSize: 10, color: SUBTLE }}>{factor.name}</div>
        {isContinuous && (
          <Chip color={SUBTLE} style={{ marginTop: 2 }}>
            continuous
          </Chip>
        )}
      </td>
      <td style={{ padding: '4px 4px', verticalAlign: 'top' }}>
        {isContinuous ? (
          numericValue == null ? (
            <em style={{ color: SUBTLE }}>—</em>
          ) : (
            <span style={{ fontFamily: MONO }}>
              {numericValue}
              {unit ? <span style={{ color: SUBTLE }}> {unit}</span> : null}
            </span>
          )
        ) : !fv ? (
          <em style={{ color: SUBTLE }}>unassigned</em>
        ) : (
          <>
            <div>
              {fv.free_text_label}
              {fv.is_baseline && (
                <Chip color={ACCENT_3} style={{ marginLeft: 6 }}>
                  baseline
                </Chip>
              )}
            </div>
            {fv.statements.length > 1 ? (
              <div style={{ marginTop: 4 }}>
                {fv.statements.map((s, i) => (
                  <StatementLine key={i} statement={s} />
                ))}
              </div>
            ) : fv.statements[0] ? (
              <div style={{ marginTop: 4 }}>
                <StatementLine statement={fv.statements[0]} />
              </div>
            ) : null}
          </>
        )}
      </td>
    </tr>
  );
}

function StatementLine({ statement }: { statement: Statement }) {
  if (!statement.predicate && !statement.object) {
    return (
      <div style={{ fontSize: 11 }}>
        <OntologyTermLink term={statement.subject} />
      </div>
    );
  }
  return (
    <div style={{ fontSize: 11 }}>
      <OntologyTermLink term={statement.subject} />
      {statement.predicate ? (
        <>
          {' '}
          <span style={{ color: SUBTLE }}>→</span>{' '}
          <OntologyTermLink term={statement.predicate} />
        </>
      ) : null}
      {statement.object ? (
        <>
          {' '}
          <span style={{ color: SUBTLE }}>→</span>{' '}
          <OntologyTermLink term={statement.object} />
        </>
      ) : null}
    </div>
  );
}

function ValueSection({
  value,
  rowValues,
  colIndex,
  fmt,
}: {
  value: number | null;
  rowValues?: Array<number | null>;
  colIndex: number;
  fmt: (v: number) => string;
}) {
  return (
    <section>
      <SectionHeader>Value</SectionHeader>
      <KV label="Cell value">
        {value == null ? (
          <em style={{ color: SUBTLE }}>NA</em>
        ) : (
          <span style={{ fontFamily: MONO }}>{fmt(value)}</span>
        )}
      </KV>
      {rowValues && rowValues.length > 0 ? (
        <div style={{ marginTop: 6 }}>
          <Sparkline values={rowValues} highlightIndex={colIndex} />
        </div>
      ) : null}
    </section>
  );
}

/** 80×40 SVG sparkline of the row's values with the current sample marked.
 *  Reused by `ValueSection` AND by `StripDetail` (for the continuous-
 *  factor mini-histogram) — see §5.4. */
function Sparkline({
  values,
  highlightIndex,
  width = 200,
  height = 36,
}: {
  values: Array<number | null>;
  highlightIndex: number;
  width?: number;
  height?: number;
}) {
  const finite = values
    .map((v, i) => ({ v, i }))
    .filter((d): d is { v: number; i: number } => d.v != null && Number.isFinite(d.v));
  if (finite.length < 2) {
    return (
      <div style={{ color: SUBTLE, fontStyle: 'italic', fontSize: 11 }}>
        not enough values to plot
      </div>
    );
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const d of finite) {
    if (d.v < lo) lo = d.v;
    if (d.v > hi) hi = d.v;
  }
  const range = hi - lo || 1;
  const xs = values.length;
  const sx = (i: number) => (i / Math.max(1, xs - 1)) * width;
  const sy = (v: number) => height - ((v - lo) / range) * height;
  // Polyline through finite values.
  const points: Array<[number, number]> = finite.map((d) => [sx(d.i), sy(d.v)]);
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
    .join(' ');
  const hv = values[highlightIndex];
  const hx = sx(highlightIndex);
  return (
    <svg
      width={width}
      height={height}
      style={{ display: 'block', overflow: 'visible' }}
    >
      <path d={path} fill="none" stroke={SUBTLE} strokeWidth={1} />
      <line
        x1={hx}
        x2={hx}
        y1={0}
        y2={height}
        stroke={ACCENT_3}
        strokeWidth={1}
      />
      {hv != null && Number.isFinite(hv) ? (
        <circle cx={hx} cy={sy(hv)} r={2.5} fill={ACCENT_3} />
      ) : null}
    </svg>
  );
}

// ─── strip cell ─────────────────────────────────────────────────────

function StripDetail({
  payload,
  stripIndex,
  col,
  fmt: _fmt,
}: {
  payload: HeatmapPayload;
  stripIndex: number;
  col: number;
  fmt: (v: number) => string;
}): JSX.Element {
  const factor = payload.factors[stripIndex];
  const column = payload.columns[col];
  if (!factor) {
    return (
      <div style={{ color: SUBTLE, fontStyle: 'italic' }}>
        unknown strip
      </div>
    );
  }
  const isContinuous = factor.type === 'continuous';
  const fvId = column?.factorValueIds[factor.id];
  const clickedFv = fvId != null
    ? factor.factor_values.find((v) => v.id === fvId)
    : undefined;
  const unit = parseFactorUnit(factor.name);
  const numericValue = isContinuous && column ? continuousValueOf(factor, column) : null;

  // For continuous: build the strip's per-sample values for the mini
  // histogram (we re-derive here rather than threading the built
  // strip; cheap at typical column counts).
  const continuousSeries: Array<number | null> | null = isContinuous
    ? payload.columns.map((c) => continuousValueOf(factor, c))
    : null;

  // Sample counts per FV — for categorical factors.
  let fvCounts: Map<number, number> | null = null;
  if (!isContinuous) {
    fvCounts = new Map<number, number>();
    for (const c of payload.columns) {
      const id = c.factorValueIds[factor.id];
      if (id != null) fvCounts.set(id, (fvCounts.get(id) ?? 0) + 1);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section>
        <SectionHeader>Factor</SectionHeader>
        <KV label="Name">{factor.name}</KV>
        <KV label="Category">
          <OntologyTermLink term={factor.category} />
        </KV>
        <KV label="Type">{factor.type}</KV>
        {factor.description && (
          <KV label="Description">
            <span style={{ color: SUBTLE }}>{factor.description}</span>
          </KV>
        )}
        {factor.baseline_relevance && (
          <KV label="Baseline">
            <span style={{ color: SUBTLE }}>
              {factor.baseline_relevance}
              {factor.baseline_relevance_reason
                ? ` — ${factor.baseline_relevance_reason}`
                : ''}
            </span>
          </KV>
        )}
        {isContinuous && (
          <div style={{ marginTop: 4, fontSize: 11, color: SUBTLE }}>
            no baseline applies
          </div>
        )}
      </section>

      {column && (
        <section>
          <SectionHeader>Sample</SectionHeader>
          <KV label="Name">{column.name}</KV>
          {isContinuous ? (
            <>
              <KV label="Value">
                {numericValue == null ? (
                  <em style={{ color: SUBTLE }}>—</em>
                ) : (
                  <span style={{ fontFamily: MONO }}>
                    {numericValue}
                    {unit ? <span style={{ color: SUBTLE }}> {unit}</span> : null}
                  </span>
                )}
              </KV>
              {continuousSeries && (
                <div style={{ marginTop: 6 }}>
                  <Sparkline
                    values={continuousSeries}
                    highlightIndex={col}
                  />
                  <div style={{ fontSize: 10, color: SUBTLE, marginTop: 2 }}>
                    distribution across {payload.columns.length} samples
                  </div>
                </div>
              )}
            </>
          ) : clickedFv ? (
            <>
              <KV label="Factor value">
                {clickedFv.free_text_label}
                {clickedFv.is_baseline && (
                  <Chip color={ACCENT_3} style={{ marginLeft: 6 }}>
                    baseline
                  </Chip>
                )}
              </KV>
              {clickedFv.statements.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 10, color: SUBTLE, marginBottom: 3 }}>
                    statements
                  </div>
                  {clickedFv.statements.map((s, i) => (
                    <StatementLine key={i} statement={s} />
                  ))}
                </div>
              )}
            </>
          ) : (
            <em style={{ color: SUBTLE }}>unassigned</em>
          )}
        </section>
      )}

      {!isContinuous && fvCounts && (
        <section>
          <SectionHeader>Factor values</SectionHeader>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {factor.factor_values.map((fv) => {
              const isClicked = fv.id === fvId;
              const n = fvCounts!.get(fv.id) ?? 0;
              return (
                <li
                  key={fv.id}
                  style={{
                    padding: '3px 4px',
                    borderBottom: `1px solid ${BORDER}`,
                    background: isClicked ? '#fffbeb' : undefined,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: 11,
                  }}
                >
                  <span>
                    {fv.free_text_label}
                    {fv.is_baseline && (
                      <Chip color={ACCENT_3} style={{ marginLeft: 4 }}>
                        baseline
                      </Chip>
                    )}
                  </span>
                  <span
                    style={{
                      color: SUBTLE,
                      fontFamily: MONO,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    n={n}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

// ─── tiny shared primitives ─────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h4
      style={{
        fontSize: 10,
        color: SUBTLE,
        fontWeight: 600,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        margin: '0 0 4px',
      }}
    >
      {children}
    </h4>
  );
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '2px 0', fontSize: 11 }}>
      <div style={{ width: 90, color: SUBTLE, flex: '0 0 90px' }}>{label}</div>
      <div style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{children}</div>
    </div>
  );
}

function Chip({
  children,
  color,
  style,
}: {
  children: React.ReactNode;
  color: string;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0px 4px',
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: 0.3,
        textTransform: 'uppercase',
        color,
        border: `1px solid ${color}`,
        borderRadius: 2,
        lineHeight: 1.5,
        ...style,
      }}
    >
      {children}
    </span>
  );
}
