/**
 * Wire-shaped types for the Gemma `HeatmapDataValueObject` endpoint
 * (see HEATMAP_SPEC.md §2). Mirrors the curation app's `Factor` /
 * `FactorValue` / `Statement` / `OntologyTerm` shapes
 * (`apps/curation/src/features/experiment/types.ts`) — *don't* import
 * cross-app; this is a deliberate local copy so the browser app
 * compiles standalone. When the two diverge, Python is canonical.
 *
 * The widget v1 (`HeatmapData`) types stay intact for back-compat.
 * v2 callers feed a `HeatmapPayload` (rich, server-shaped) which the
 * widget walks itself.
 */
export interface OntologyTerm {
  label: string;
  uri?: string | null;
}

export interface Statement {
  category?: OntologyTerm | null;
  subject: OntologyTerm;
  predicate?: OntologyTerm | null;
  object?: OntologyTerm | null;
}

export interface FactorValue {
  id: number;
  free_text_label: string;
  is_baseline: boolean;
  statements: Statement[];
  /** Canonical scalar reading for a continuous-factor FV — mirrors
   *  Gemma's ``FactorValue.measurement.value``. Null / absent on
   *  categorical FVs. ``free_text_label`` carries the human
   *  rendering ("86 years") for display. */
  numeric_value?: number | null;
}

export type FactorType = 'categorical' | 'continuous';

export type BaselineRelevance = 'required' | 'not_applicable' | 'uncertain';

export interface Factor {
  id: number;
  name: string;
  category: OntologyTerm;
  description?: string;
  type: FactorType;
  baseline_relevance?: BaselineRelevance;
  baseline_relevance_reason?: string;
  factor_values: FactorValue[];
  /** Per-sample numeric measurements for continuous factors. Open
   *  Q #1 from the spec — leaves room for the Java side to ship
   *  per-factor measurements as a denormalised map. When absent
   *  the widget falls back to `factor_values[].numeric_value`
   *  (one FV per sample). */
  continuousMeasurements?: Record<number, number>;
}

export interface HeatmapPayloadColumn {
  bioAssayId: number;
  bioMaterialId: number;
  name: string;
  outlier: boolean;
  /** Map of `factorId -> factorValueId`. Missing key = no
   *  assignment for that factor on this sample. */
  factorValueIds: Record<number, number>;
}

export interface HeatmapPayloadRow {
  designElementId: number;
  designElementName: string;
  geneIds: number[];
  geneSymbols: string[];
  pvalue?: number;
  validated?: boolean;
}

export interface HeatmapQuantitationType {
  name: string;
  isPreferred: boolean;
  isRatio: boolean;
  scale: string;
}

export interface HeatmapPayload {
  datasetId: number;
  matrix: {
    /** Row-major numeric matrix; nulls are missing cells. */
    values: Array<Array<number | null>>;
    rows: number;
    cols: number;
    quantitationType: HeatmapQuantitationType;
  };
  rows: HeatmapPayloadRow[];
  columns: HeatmapPayloadColumn[];
  factors: Factor[];
}

/** Per-sample numeric source for a continuous factor.
 *
 *  Tries `factor.continuousMeasurements[bioAssayId]` first (recce-favoured
 *  shape), then falls back to looking up the column's assigned FV's
 *  `numeric_value`. Returns `null` when neither resolves — strip cell
 *  paints as nanColor and the column-ordering sort sends the sample to
 *  the right.
 *
 *  Pure. Exported so the column-ordering + render code can share the
 *  same access path; swap the body when the wire shape settles. */
export function continuousValueOf(
  factor: Factor,
  column: HeatmapPayloadColumn,
): number | null {
  const direct = factor.continuousMeasurements?.[column.bioAssayId];
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  const fvId = column.factorValueIds[factor.id];
  if (fvId == null) return null;
  const fv = factor.factor_values.find((v) => v.id === fvId);
  const num = fv?.numeric_value;
  if (typeof num === 'number' && Number.isFinite(num)) return num;
  return null;
}

/** Parse a unit suffix from a continuous factor's name.
 *
 *  Examples: ``"age (years)" -> "years"``, ``"weight (kg)" -> "kg"``.
 *  Returns `null` when the name doesn't carry parenthesised units. */
export function parseFactorUnit(name: string): string | null {
  const m = name.match(/\(([^)]+)\)\s*$/);
  return m ? m[1].trim() : null;
}
