/**
 * Lightweight cursor-following tooltip.
 *
 * Three variants:
 *   - matrix cell      — probe / sample / value (+ p-value if diffex)
 *   - categorical strip — factor / sample / FV (+ baseline + subject term)
 *   - continuous strip — factor / sample / value + unit
 *
 * Plain text, two-column key/value layout, 4px cursor offset, dark
 * background. Dismissed by `mouseleave` from the widget — driven by
 * the parent's `null` state, no internal lifecycle.
 */
import type { CSSProperties } from 'react';
import { continuousValueOf, parseFactorUnit } from './payload';
import type { Factor, HeatmapPayload } from './payload';

const MONO = '"SFMono-Regular", "Menlo", "Consolas", monospace';

const containerStyle: CSSProperties = {
  position: 'fixed',
  zIndex: 1000,
  background: 'rgba(17, 24, 39, 0.96)',
  color: '#f3f4f6',
  padding: '6px 8px',
  fontSize: 11,
  lineHeight: 1.35,
  borderRadius: 3,
  pointerEvents: 'none',
  maxWidth: 320,
  boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
  fontFamily: 'Helvetica, Arial, sans-serif',
};

export type TooltipState =
  | { kind: 'cell'; row: number; col: number; value: number | null; clientX: number; clientY: number }
  | { kind: 'strip'; stripIndex: number; col: number; clientX: number; clientY: number };

export interface HeatmapTooltipProps {
  payload: HeatmapPayload;
  state: TooltipState;
  formatValue?: (v: number) => string;
}

export function HeatmapTooltip({
  payload,
  state,
  formatValue,
}: HeatmapTooltipProps): JSX.Element {
  const fmt =
    formatValue ??
    ((v: number) =>
      Math.abs(v) >= 100 || (Math.abs(v) < 0.01 && v !== 0)
        ? v.toExponential(2)
        : v.toFixed(2));

  const { clientX, clientY } = state;
  // Position with 4px cursor offset (spec §5.1). Flip to the cursor's
  // left when the tooltip would clip past the right edge.
  const W = 320;
  const left =
    typeof window !== 'undefined' && clientX + 4 + W > window.innerWidth
      ? clientX - 4 - W
      : clientX + 4;
  const top = clientY + 4;
  const pos: CSSProperties = { top, left };

  if (state.kind === 'cell') {
    return (
      <div style={{ ...containerStyle, ...pos }}>
        <CellRows payload={payload} state={state} fmt={fmt} />
      </div>
    );
  }
  return (
    <div style={{ ...containerStyle, ...pos }}>
      <StripRows payload={payload} state={state} fmt={fmt} />
    </div>
  );
}

function CellRows({
  payload,
  state,
  fmt,
}: {
  payload: HeatmapPayload;
  state: Extract<TooltipState, { kind: 'cell' }>;
  fmt: (v: number) => string;
}) {
  const row = payload.rows[state.row];
  const col = payload.columns[state.col];
  const qt = payload.matrix.quantitationType;
  return (
    <table style={{ borderSpacing: 0, fontSize: 11 }}>
      <tbody>
        <Row label="PROBE">
          {row?.designElementName ?? '—'}
          {row?.geneSymbols.length ? (
            <span style={{ color: '#9ca3af' }}>
              {' '}
              ({row.geneSymbols.join(', ')})
            </span>
          ) : null}
        </Row>
        <Row label="SAMPLE">
          {col?.name ?? '—'}
        </Row>
        <Row label="VALUE">
          {state.value == null ? (
            <em style={{ color: '#9ca3af' }}>NA</em>
          ) : (
            <>
              <span style={{ fontFamily: MONO }}>{fmt(state.value)}</span>
              <span style={{ color: '#9ca3af' }}> ({qt.scale})</span>
            </>
          )}
        </Row>
        {row?.pvalue != null && (
          <Row label="P-VALUE">
            <span style={{ fontFamily: MONO }}>
              {row.pvalue.toExponential(2)}
            </span>
          </Row>
        )}
      </tbody>
    </table>
  );
}

function StripRows({
  payload,
  state,
  fmt: _fmt,
}: {
  payload: HeatmapPayload;
  state: Extract<TooltipState, { kind: 'strip' }>;
  fmt: (v: number) => string;
}) {
  const factor: Factor | undefined = payload.factors[state.stripIndex];
  const col = payload.columns[state.col];
  if (!factor) return <em>unknown strip</em>;
  if (factor.type === 'continuous' && col) {
    const value = continuousValueOf(factor, col);
    const unit = parseFactorUnit(factor.name);
    return (
      <div style={{ fontSize: 11, maxWidth: 320 }}>
        <div style={{ fontSize: 12, fontWeight: 600, fontFamily: MONO }}>
          {value == null ? (
            <em style={{ opacity: 0.6, fontFamily: 'inherit' }}>—</em>
          ) : (
            <>
              {value}
              {unit ? ` ${unit}` : ''}
            </>
          )}
        </div>
        <div style={{ opacity: 0.6, marginTop: 2 }}>
          {factor.name === factor.category.label
            ? factor.name
            : `${factor.name} · ${factor.category.label}`}
          {col.name ? ` · ${col.name}` : ''}
        </div>
      </div>
    );
  }
  // Categorical.
  const fvId = col?.factorValueIds[factor.id];
  const fv =
    fvId != null
      ? factor.factor_values.find((v) => v.id === fvId)
      : undefined;
  // 🛑 The VALUE leads, unlabelled. This is what the reader hovered a
  // coloured cell to find out; FACTOR / SAMPLE / VALUE in a labelled
  // three-row table made them read three field names to reach it, and
  // the factor row printed its own name beside its category — usually
  // the same word twice ("organism part (organism part)"). Context
  // belongs under the answer, quietly, not above it.
  const factorLine =
    factor.name === factor.category.label
      ? factor.name
      : `${factor.name} · ${factor.category.label}`;
  return (
    <div style={{ fontSize: 11, maxWidth: 320 }}>
      <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3 }}>
        {fv ? fv.free_text_label : <em style={{ opacity: 0.6 }}>unassigned</em>}
      </div>
      <div style={{ opacity: 0.6, marginTop: 2 }}>
        {factorLine}
        {col?.name ? ` · ${col.name}` : ''}
      </div>
      {fv?.statements[0]?.subject?.label &&
      fv.statements[0].subject.label !== fv.free_text_label ? (
        <div style={{ opacity: 0.6, marginTop: 3 }}>
          ↳ {fv.statements[0].subject.label}
          {fv.statements[0].subject.uri
            ? ` (${truncateUri(fv.statements[0].subject.uri)})`
            : ''}
        </div>
      ) : null}
      {fv?.is_baseline ? (
        <div style={{ color: '#fbbf24', marginTop: 3 }}>baseline</div>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <td
        style={{
          color: '#9ca3af',
          paddingRight: 10,
          verticalAlign: 'top',
          fontSize: 9,
          letterSpacing: 0.4,
        }}
      >
        {label}
      </td>
      <td style={{ verticalAlign: 'top' }}>{children}</td>
    </tr>
  );
}

function truncateUri(uri: string): string {
  // Pull the trailing accession (anything after the last `/` or `#`).
  const m = uri.match(/[/#]([^/#]+)$/);
  return m ? m[1] : uri;
}
