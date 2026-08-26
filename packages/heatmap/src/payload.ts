/**
 * Wire-shaped types for the Gemma `HeatmapDataValueObject` endpoint.
 * Mirrors the curation app's `Factor` /
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
  /** Parallel to ``geneSymbols``. Optional — when present, the
   *  row-label gutter renders a second column with the full gene
   *  name. Use the empty string when a gene has no name on file. */
  geneNames?: string[];
  /** Display override for the gutter's symbol column. Absent ⇒ the
   *  gutter falls back to ``geneSymbols[0]``, which is right whenever
   *  a row's headline IS its first matched gene.
   *
   *  Set it when the headline differs — the Visualize tab joins the
   *  genes the viewer actually searched for and marks the probe when
   *  it also hits genes they didn't. The per-gene arrays above stay
   *  authoritative for the tooltip / side panel; this is presentation
   *  only. */
  labelSymbol?: string;
  /** Display override paired with ``labelSymbol`` for the gutter's
   *  gene-name column. Absent ⇒ falls back to ``geneNames[0]``. */
  labelName?: string;
  /** Optional coloured-disc tag rendered in the leading slot of the
   *  row-label gutter. Carries arbitrary CSS colour. Use to surface
   *  a row's origin (e.g. which GO term it came from) or cluster
   *  membership. */
  originColor?: string | null;
  /** Optional hover title for ``originColor`` — typically the source
   *  GO term label or similar provenance. */
  originTitle?: string | null;
  /** Contrast p-value. When present on any row, the widget renders a
   *  leading numeric column in the row-label gutter (to the LEFT of the
   *  gene symbol) — used by the DE top-genes heatmap. */
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

/** A gene a design element maps to, as Gemma serves it on the
 *  heatmap-data and svd/loadings rows. */
export interface HeatmapRowGene {
  id: number;
  officialSymbol?: string | null;
  name?: string | null;
}

/** Marker appended to a row's gutter symbol when the probe also maps to
 *  genes outside the viewer's search — i.e. the row is not specific to
 *  what they asked for. */
export const NONSPECIFIC_MARK = '*';
/** Separator between co-hybridising genes in the gutter. Tight for
 *  symbols (identifiers, and gutter width is scarce), spaced for the
 *  name column (prose runs together otherwise). */
const SYMBOL_SEP = ';';
const NAME_SEP = '; ';
/** Stands in for a gene with no official name, so the joined name
 *  column stays positionally aligned with the symbol column. */
const NAME_PLACEHOLDER = '—';

/**
 * Row-gutter label for a design element, given the genes it maps to.
 *
 * A design element can map to several genes, and naming only the first
 * — the long-standing behaviour — silently asserts a 1:1 mapping that
 * isn't there. Which genes the gutter should name depends on whether
 * the viewer asked for any of them:
 *
 *   - Some are in ``queried`` → name exactly those, joined. Mark the
 *     row when the probe also reaches genes they didn't ask for: the
 *     signal in that row isn't attributable to the searched gene alone.
 *   - ``queried`` is empty (no search at all — the random-sample
 *     preview, the PC-loadings popup) → name every gene the probe hits.
 *     Nothing was "specifically matched", so nothing is marked.
 *
 * Returns empty strings when there's nothing to say; the caller decides
 * the fallback (usually the design-element name).
 *
 * Pure.
 */
export function buildGeneRowLabel(
  rowGenes: HeatmapRowGene[],
  queried: ReadonlySet<number> = new Set(),
): { labelSymbol: string; labelName: string } {
  const hits = queried.size > 0 ? rowGenes.filter((g) => queried.has(g.id)) : [];
  const shown = hits.length > 0 ? hits : rowGenes;
  const nonSpecific = queried.size > 0 && hits.length < rowGenes.length;

  const symbols = shown.map((g) => g.officialSymbol || '').filter(Boolean);
  const names = shown.map((g) => g.name || '');
  return {
    labelSymbol:
      symbols.length > 0
        ? symbols.join(SYMBOL_SEP) + (nonSpecific ? NONSPECIFIC_MARK : '')
        : '',
    // All-blank stays blank (matches the single-gene case); otherwise
    // placeholder the gaps so symbol i lines up with name i.
    labelName: names.some((n) => n)
      ? names.map((n) => n || NAME_PLACEHOLDER).join(NAME_SEP)
      : '',
  };
}

/** What a heatmap row needs to carry for the gutter to label it.
 *
 *  Deliberately loose: the expression heatmap feeds it a
 *  ``HeatmapPayloadRow`` (parallel symbol/name arrays, plus the
 *  pre-resolved overrides its wire adapter computes), the PC-loadings
 *  popup feeds it a raw ``/svd/loadings`` row (a ``genes`` array and
 *  nothing else). Both satisfy this shape. */
export interface ProbeRowLabelSource {
  genes?: HeatmapRowGene[] | null;
  geneSymbols?: string[];
  geneNames?: string[];
  labelSymbol?: string;
  labelName?: string;
  designElementName?: string | null;
  designElementId?: number | null;
}

/** The gutter's two columns for one row. */
export interface ProbeRowLabel {
  /** Emphasised primary column — the gene symbol(s), falling back to
   *  the probe's own identity when it maps to nothing nameable. */
  symbol: string;
  /** Secondary column — the gene name(s). Empty when unknown; the
   *  gutter drops the column entirely when no row has one. */
  name: string;
}

/**
 * The single owner of what a heatmap row's gutter says.
 *
 * Every heatmap that labels rows by probe→gene goes through here — the
 * Expression tab, the DE top-genes pop-out, the PC-loadings popup — so
 * the same probe reads the same way on all of them. It had drifted
 * before this existed: two fallback ladders, and two different ideas
 * of the one-line form used for the TSV export.
 *
 * The ladder, in order:
 *   1. ``labelSymbol`` — a caller that already resolved the label,
 *      because it knows something this function can't. The Visualize
 *      tab is the case: only it knows which genes were *searched for*,
 *      which decides both which to name and whether to mark the row.
 *   2. the genes on the row, via ``buildGeneRowLabel``.
 *   3. ``geneSymbols[0]`` — payload rows built before the label
 *      overrides existed, which set the parallel arrays only.
 *   4. the probe's name, then its id. A row with no gene is still a
 *      row and still needs an identifier.
 *
 * ``||`` throughout, never ``??``: a gene with no official symbol on
 * file arrives as the empty string, which is non-nullish, so
 * coalescing would stop at rung 2 and render a blank gutter.
 *
 * Pure.
 */
export function probeRowLabel(
  row: ProbeRowLabelSource,
  queried: ReadonlySet<number> = new Set(),
): ProbeRowLabel {
  const resolved =
    row.labelSymbol || row.labelName
      ? { labelSymbol: row.labelSymbol ?? '', labelName: row.labelName ?? '' }
      : buildGeneRowLabel(row.genes ?? [], queried);
  return {
    symbol:
      resolved.labelSymbol ||
      row.geneSymbols?.[0] ||
      row.designElementName ||
      (row.designElementId != null ? `probe ${row.designElementId}` : ''),
    name: resolved.labelName || row.geneNames?.[0] || '',
  };
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
