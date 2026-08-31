// Domain types mirroring the Gemma REST shapes consumed by GemBrow.
// Hand-written for now; replace with openapi-typescript codegen later.

// ─── Experimental design ─────────────────────────────────────────────────────

/** One S-P-O triple under a factor value. Mirrors the Gemma REST
 *  ``statements`` array (subject / predicate / object + URIs +
 *  category). The browser surface renders these read-only with the
 *  same chip conventions as the curation UI. */
export interface FactorValueStatement {
  id?: number;
  category?: string | null;
  categoryUri?: string | null;
  subject?: string | null;
  subjectUri?: string | null;
  predicate?: string | null;
  predicateUri?: string | null;
  object?: string | null;
  objectUri?: string | null;
}

export interface FactorValueBasic {
  id: number;
  /** Free-text label. Often empty for ontology-resolved FVs whose
   *  identity is carried by ``statements``. */
  value?: string | null;
  /** Server-rendered summary string — preferred for display when
   *  available since it composes the structured fields into something
   *  human-readable. */
  summary?: string | null;
  /** Numeric FV (continuous factors). */
  isMeasurement?: boolean | null;
  /** ``true`` when this FV is the baseline / reference level for
   *  its factor. The Gemma 1.x design endpoint may not populate
   *  this directly; treat as best-effort. */
  isBaseline?: boolean | null;
  characteristics?: {
    id?: number;
    category?: string | null;
    categoryUri?: string | null;
    value?: string | null;
    valueUri?: string | null;
  }[];
  statements?: FactorValueStatement[];
  /** Legacy field — kept for back-compat with callers that read
   *  ``value.type``. The Factor's ``type`` is the authoritative
   *  signal. */
  type?: string | null;
}

export interface ExperimentalFactorEntry {
  id: number;
  name?: string | null;
  description?: string | null;
  /** "categorical" | "continuous" */
  type?: string | null;
  /** EFC category for the factor. Gemma returns both ``category``
   *  (label) and ``categoryUri`` plus a ``value``/``valueUri`` pair
   *  that mirrors them; the labelled fields are what we display. */
  category?: {
    /** EFC label, e.g. "genotype" / "treatment" / "block". */
    category?: string | null;
    categoryUri?: string | null;
    value?: string | null;
    valueUri?: string | null;
  } | null;
  values: FactorValueBasic[];
}

export interface BioMaterialFactorValueAssignment {
  bioMaterialId: number;
  bioMaterialName: string;
  factorValueIds: number[];
}

export interface ExperimentalDesign {
  name?: string | null;
  description?: string | null;
  experimentalFactors: ExperimentalFactorEntry[];
  bioMaterialAssignments: BioMaterialFactorValueAssignment[];
}

// ─── Samples / BioAssay ───────────────────────────────────────────────────────

/** A factor value as returned inline on a sample (BioMaterial) by the
 *  ``/datasets/{id}/samples`` endpoint. Unlike the design-endpoint
 *  ``FactorValueBasic``, each element here carries the owning factor's
 *  id + category, so callers can pivot samples into one column per
 *  experimental factor. ``summary`` is the server-composed,
 *  human-readable label preferred for display. */
export interface SampleFactorValue {
  id?: number;
  value?: string | null;
  summary?: string | null;
  /** The experimental factor this value belongs to — the column key
   *  when pivoting samples into per-factor columns. */
  experimentalFactorId?: number | null;
  /** "categorical" | "continuous" */
  experimentalFactorType?: string | null;
  experimentalFactorCategory?: {
    category?: string | null;
    categoryUri?: string | null;
    value?: string | null;
    valueUri?: string | null;
  } | null;
}

export interface BioMaterial {
  id?: number;
  name?: string | null;
  description?: string | null;
  /** Per-sample biomaterial annotations (sex, tissue, molecular
   *  entity, …) — the "additional metadata" surfaced in the sample
   *  info popover, distinct from the experimental factor values. Each
   *  carries the annotated category + value plus their ontology URIs
   *  where Gemma mapped them. */
  characteristics?: Array<{
    id?: number;
    value?: string;
    valueUri?: string | null;
    category?: string;
    categoryUri?: string | null;
  }>;
  factorValues?: SampleFactorValue[];
}

export interface BioAssay {
  id: number;
  name?: string | null;
  shortName?: string | null;
  description?: string | null;
  /** Free-text bookkeeping the submitter / importer attached to the
   *  assay (e.g. run notes). Surfaced verbatim in the info popover. */
  metadata?: string | null;
  accession?: { accession?: string } | null;
  arrayDesign?: { shortName?: string; name?: string } | null;
  sample?: BioMaterial | null;
  outlier?: boolean;
  predictedOutlier?: boolean;
  userFlaggedOutlier?: boolean;
  processingDate?: string | null;
}

// ─── Quantitation types ───────────────────────────────────────────────────────

/** One quantitation type on a dataset — the "flavour" of a data vector
 *  (e.g. raw vs. processed, log2 scale, normalized). Mirrors the Gemma
 *  REST ``/datasets/{id}/quantitationTypes`` VO. */
export interface QuantitationType {
  id: number;
  name?: string | null;
  description?: string | null;
  /** e.g. "QUANTITATIVE". */
  generalType?: string | null;
  /** e.g. "AMOUNT". */
  type?: string | null;
  /** e.g. "DOUBLE". */
  representation?: string | null;
  /** e.g. "LOG2" / "LINEAR". */
  scale?: string | null;
  isBackground?: boolean;
  isBackgroundSubtracted?: boolean;
  isBatchCorrected?: boolean;
  isNormalized?: boolean;
  isRatio?: boolean;
  isRecomputedFromRawData?: boolean;
  isPreferred?: boolean;
  isMaskedPreferred?: boolean;
  /** Fully-qualified Java class of the backing data vector. */
  vectorType?: string | null;
}

// ─── Publications ─────────────────────────────────────────────────────────────

export interface Publication {
  id?: number;
  title?: string | null;
  authorList?: string | null;
  publication?: string | null;
  publicationDate?: string | null;
  pubAccession?: string | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  citation?: { citation?: string } | null;
  retracted?: boolean;
}

// ─── Pipeline status ──────────────────────────────────────────────────────────

export interface PipelineStep {
  step: string;
  /** "ok" | "failed" | "notRun" | "notApplicable" */
  state: string;
  lastRun?: string | null;
  eventType?: string | null;
  message?: string | null;
}

export interface PipelineStatus {
  experimentId: number;
  steps: PipelineStep[];
  hasBatchInformation: boolean;
  hasDifferentialExpressionAnalysis: boolean;
  hasCoexpressionAnalysis: boolean;
  troubled: boolean;
  troubleDetails?: string | null;
  needsAttention: boolean;
  isPublic: boolean;
  geeq?: GeeqScores | null;
}

// ─── GEEQ ─────────────────────────────────────────────────────────────────────

/** GEEQ score breakdown as embedded in the Dataset payload. Field
 *  names here mirror what the Gemma REST actually emits (verified
 *  against /datasets/{id} on prod 1.x and against gemma-rest's
 *  GeeqValueObject Java class).
 *
 *  All sub-scores normalised to [-1, 1] (higher = better); the
 *  aggregate ``publicQualityScore`` is bounded to [0, 1].
 *
 *  Suitability is deliberately absent. It was removed from the GEEQ
 *  score, so ``publicSuitabilityScore`` and the ``sScore*`` fields are
 *  no longer declared here even though gemma-rest still emits them —
 *  the index signature below keeps them harmless on the way in. */
export interface GeeqScores {
  publicQualityScore?: number | null;

  // ─── Flags / counts (not in the score-bar table) ───
  /** ``true`` when the dataset has no processed data vectors. */
  noVectors?: boolean | null;
  corrMatIssues?: number | null;
  replicatesIssues?: number | null;
  batchCorrected?: boolean | null;

  // ─── Quality sub-scores ───
  qScoreOutliers?: number | null;
  qScoreSampleMeanCorrelation?: number | null;
  qScoreSampleMedianCorrelation?: number | null;
  qScoreSampleCorrelationVariance?: number | null;
  qScorePlatformsTech?: number | null;
  qScoreReplicates?: number | null;
  qScoreBatchInfo?: number | null;
  qScorePublicBatchEffect?: number | null;
  qScorePublicBatchConfound?: number | null;

  [key: string]: number | boolean | null | undefined;
}

// ─── Differential expression analysis ────────────────────────────────────────

export interface FactorValueVO {
  id?: number;
  value?: string | null;
  factor?: { name?: string | null; id?: number } | null;
}

export interface DiffExAnalysis {
  id: number;
  name?: string | null;
  bioAssaySetId?: number;
  /** Map from factor ID (string key) to list of factor values used. */
  factorValuesUsed?: Record<string, FactorValueVO[]>;
  numberOfDiffExpressedProbes?: number | null;
  subsetFactor?: { name?: string | null; id?: number } | null;
  /** Factor-value the analysis is restricted to (single-cell
   *  per-cell-type analyses), with a `summary` string suitable for
   *  display. */
  subsetFactorValue?:
    | (FactorValueVO & {
        summary?: string | null;
        factorValue?: string | null;
        characteristics?: { value?: string | null }[];
      })
    | null;
  isSubset?: boolean | null;
  /** Nested result sets (one per contrast within the analysis). The
   *  analyses endpoint already returns these with `numberOfDiffExpressedProbes`
   *  and threshold so we don't need a separate fetch for the counts. */
  resultSets?: DiffExNestedResultSet[] | null;
}

/** Result-set as nested under an analysis in
 *  `/datasets/{id}/analyses/differential`. Carries the surface stats
 *  the analyses UI needs (DE counts, FDR threshold, up/down split)
 *  alongside the factors + baseline used for the contrast. */
export interface DiffExNestedResultSet {
  id: number;
  threshold?: number | null;
  numberOfProbesAnalyzed?: number | null;
  numberOfGenesAnalyzed?: number | null;
  numberOfDiffExpressedProbes?: number | null;
  numberOfUpregulatedProbes?: number | null;
  numberOfDownregulatedProbes?: number | null;
  upregulatedCount?: number | null;
  downregulatedCount?: number | null;
  experimentalFactors?:
    | {
        id?: number;
        name?: string | null;
        category?: string | null;
        description?: string | null;
      }[]
    | null;
  baselineGroup?:
    | {
        id?: number;
        factorValue?: string | null;
        characteristics?: { value?: string | null }[];
      }
    | null;
}

/**
 * Binned p-value histogram for one DE result set, returned by
 * `GET /resultSets/{id}/pvalueDistribution`. Bins are equal-width
 * over [0, 1]; the last bin is closed on the right.
 */
export interface PvalueDistribution {
  resultSetId: number;
  /** "raw" or "corrected". */
  column: "raw" | "corrected";
  /** Total number of non-null p-values across all bins. */
  n: number;
  bins: { lo: number; hi: number; count: number }[];
}

/** Per-gene expression vectors returned by
 *  `/datasets/{id}/expressions/differential`. Used to populate the
 *  top-genes heatmap below a result-set row. */
export interface DiffExpressionResponse {
  datasetId?: number;
  geneExpressionLevels: {
    geneOfficialSymbol?: string | null;
    /** Long descriptive gene name (e.g. "transformation related protein 53").
     *  Pending the agents-side enrichment of /datasets/{id}/expressions/differential. */
    geneOfficialName?: string | null;
    /** Gemma-internal gene id. Pending the same enrichment. */
    geneId?: number | null;
    geneNcbiId?: number | null;
    geneEnsemblId?: string | null;
    /** Corrected (FDR) p-value for this gene's contrast in the result
     *  set — the value the endpoint sorts the top-N by. Surfaced in the
     *  DE heatmap's row-label gutter. */
    correctedPvalue?: number | null;
    /** Raw (uncorrected) contrast p-value. */
    pvalue?: number | null;
    /** Contrast log2 fold-change. */
    log2FoldChange?: number | null;
    vectors: {
      designElementId?: number | null;
      designElementName?: string | null;
      bioAssayExpressionLevels: Record<string, number | null>;
    }[];
  }[];
}

/**
 * Differential-expression result set descriptor returned by
 * `/datasets/{id}/analyses/differential/resultSets` (which 302s to
 * `/resultSets?datasets={id}`). Each result set corresponds to one
 * contrast within an analysis; the TSV at `/resultSets/{id}` carries
 * the per-gene stats. Only the fields the Downloads UI surfaces are
 * typed here — the full VO has more (per-factor contrasts, baseline
 * groups, etc.) but we don't render them yet.
 */
export interface DiffExResultSet {
  id: number;
  analysis?: {
    id?: number;
    name?: string | null;
    isSubset?: boolean;
  } | null;
  /** Factors in the linear-model design. Multi-factor analyses list
   *  more than one. The Downloads row labels with the factor name(s);
   *  the contrast pair lives in `contrasts[]` which we don't surface
   *  here yet. */
  experimentalFactors?:
    | {
        id?: number;
        name?: string | null;
        description?: string | null;
        category?: string | null;
      }[]
    | null;
  baselineGroup?: { id?: number; factorValue?: string | null } | null;
}

// ─── SVD + diagnostics ───────────────────────────────────────────────────────

export interface SvdResult {
  /** Fraction of variance explained per component (0-indexed). */
  variances?: number[] | null;
  /** Parallel to ``vmatrix`` rows — the bioAssay ID for each row. */
  bioAssayIds?: number[] | null;
  /** Parallel to ``vmatrix`` rows — the biomaterial ID for each row.
   *  Several bioAssays can share a biomaterial in multi-array studies. */
  bioMaterialIds?: number[] | null;
  /** Right-singular-vector matrix. Rows = bioAssays (parallel to
   *  ``bioAssayIds``), cols = PCs. ``vmatrix[i][pc]`` is bioAssay i's
   *  score on PC ``(pc + 1)``. Flatten via ``bioAssayScoresFromSvd``. */
  vmatrix?: number[][] | null;
  /** Eigenvalues. */
  eigenValues?: number[] | null;
}

/** Pairwise sample-correlation matrix returned by
 *  ``/datasets/{id}/sample-correlation``. Symmetric, values in [-1, 1].
 *  Diagonal is always 1; cards typically mask it. */
export interface SampleCorrelationMatrix {
  bioAssayIds: number[];
  /** Parallel to ``bioAssayIds``. Entries may be null for assays
   *  whose name has not been set on the Gemma side. */
  bioAssayShortNames: (string | null)[];
  /** Row-major N×N. */
  values: number[][];
  /** Curator-flagged outliers. */
  actualOutlierBioAssayIds?: number[] | null;
  /** Outlier-detector suggestions; may overlap with actual. */
  predictedOutlierBioAssayIds?: number[] | null;
  /** Placeholder for a probe-filter caption — currently null. */
  filterDescription?: string | null;
  /** Currently always "pearson". */
  method?: string | null;
}

/** Per-probe mean / variance pairs from ``/datasets/{id}/mean-variance``.
 *  Used to render the M-V scatter that flags overdispersion + bad
 *  normalisation. */
export interface MeanVarianceData {
  /** Reserved — Gemma's ``MeanVarianceRelation`` doesn't currently
   *  carry design-element ids. */
  designElementIds?: (number | null)[] | null;
  designElementNames?: (string | null)[] | null;
  /** Per-probe means (typically log2 CPM or normalized intensity). */
  means: number[];
  /** Per-probe variances, parallel to ``means``. */
  variances: number[];
  /** Reserved — ``MeanVarianceRelation`` doesn't currently expose a
   *  fit curve. */
  fit?: {
    sortedMeans: number[];
    fittedVariances: number[];
  } | null;
  /** Reserved — placeholder for the producing method
   *  (``"limma_voom"`` / ``"edger_glmqlf"`` / ``"naive"``). */
  source?: string | null;
}

/** Flatten the SVD's parallel ``bioAssayIds`` + ``vmatrix`` arrays
 *  into a per-id score record (``{[bioAssayId]: scores[]}``) — the
 *  shape PC×factor's association math wants. */
export function bioAssayScoresFromSvd(
  svd: SvdResult | null | undefined,
): Record<string, number[]> | null {
  if (!svd?.bioAssayIds || !svd?.vmatrix) return null;
  const out: Record<string, number[]> = {};
  const n = Math.min(svd.bioAssayIds.length, svd.vmatrix.length);
  for (let i = 0; i < n; i++) {
    out[String(svd.bioAssayIds[i])] = svd.vmatrix[i];
  }
  return out;
}

export interface Taxon {
  id: number;
  commonName: string;
  scientificName: string;
  numberOfExpressionExperiments?: number;
}

export interface Platform {
  id: number;
  name?: string;
  shortName?: string;
  description?: string;
  technologyType?: string;
  color?: string;
  numberOfExpressionExperiments?: number;
  numberOfExpressionExperimentsForTechnologyType?: number;
  numberOfSwitchedExpressionExperiments?: number;
  taxon?: Taxon;
  taxonID?: number;
  isMerged?: boolean;
  isMergee?: boolean;
  /** The platform this one was folded into, or null. Landed
   *  2026-08-22; before that `isMergee` said a merge had happened
   *  without naming the other side, and no query could recover it. */
  mergedInto?: { id: number; shortName?: string | null } | null;
  /** The platforms folded into this one — `[]` when none. */
  mergees?: Array<{ id: number; shortName?: string | null }> | null;
  /** Gene-mapping counts, only present when the request asked for them
   *  (`withGeneCounts`). Null means NOT COMPUTED, never zero: on a
   *  microarray they come from a report that has to be generated, and
   *  production had never written one as of 2026-08-22. Gene-list
   *  platforms derive them live and always answer. */
  numberOfGenes?: number | null;
  numberOfMappedElements?: number | null;
  /** Age of the report the counts came from. Null on a gene-list
   *  platform means "derived live, current" — not "unknown". */
  geneCountsLastUpdated?: string | null;
  troubled?: boolean;
  needsAttention?: boolean;
  curationNote?: string;
  lastUpdated?: string;
  releaseVersion?: string;
  releaseUrl?: string | null;
  externalReferences?: Array<{ accession?: string; externalDatabase?: { name?: string } }>;
}

export interface AnnotationTerm {
  /** @deprecated Gemma commit b5c6747f68 (merged, not yet deployed —
   *  prod is 5328441870) renames this to `categoryUri` with no
   *  server-side alias. Coalesced from `categoryUri` at fetch time by
   *  `withAnnotationTermCompat` (api/endpoints.ts) so this field stays
   *  populated either way — delete both once every Gemma this app
   *  talks to serves b5c6747f68. */
  classUri: string | null;
  /** @deprecated superseded by `category`; see `classUri`. */
  className: string | null;
  /** @deprecated superseded by `valueUri`; see `classUri`. */
  termUri: string | null;
  /** @deprecated superseded by `value`; see `classUri`. */
  termName: string | null;
  /** Gemma's post-b5c6747f68 name for `classUri`. Absent from a
   *  pre-rename server. */
  categoryUri?: string | null;
  /** Post-b5c6747f68 name for `className`. */
  category?: string | null;
  /** Post-b5c6747f68 name for `termUri`. */
  valueUri?: string | null;
  /** Post-b5c6747f68 name for `termName`. */
  value?: string | null;
  numberOfExpressionExperiments?: number;
  children?: AnnotationTerm[] | null;
}

export interface Category {
  /** @deprecated see `AnnotationTerm.classUri` — same rename, same
   *  coalescing (`withCategoryCompat` in api/endpoints.ts). */
  classUri: string | null;
  /** @deprecated superseded by `category`; see `classUri`. */
  className: string | null;
  /** Gemma's post-b5c6747f68 name for `classUri`. */
  categoryUri?: string | null;
  /** Post-b5c6747f68 name for `className`. */
  category?: string | null;
  numberOfExpressionExperiments?: number;
}

export interface CategoryWithChildren extends Category {
  children: AnnotationTerm[];
}

export interface DatasetCharacteristic {
  value?: string;
  valueUri?: string | null;
  category?: string;
  categoryUri?: string | null;
}

export interface Dataset {
  id: number;
  shortName: string;
  name: string;
  description?: string;
  taxon: Taxon;
  numberOfBioAssays: number;
  lastUpdated?: string;
  geeq?: GeeqScores | null;
  characteristics?: DatasetCharacteristic[];
  curationNote?: string;
  /** Whether everyone can see this dataset. Emitted by gemma-rest on
   *  ``/datasets/{id}`` (verified against 28143). Optional because a
   *  store-backed payload may omit it — and an ABSENT flag is not the
   *  same claim as ``false``, so callers must check presence rather
   *  than truthiness before saying "private". */
  isPublic?: boolean;
  searchResult?: {
    score?: number;
    highlights?: Record<string, string> | null;
  };
  /** 🛑 A STRING on a dataset — `"GSE217927"` — not an object.
   *
   *  This was declared as `{ accession?: string }` and read as
   *  `dataset.accession?.accession`, which is `undefined` on a string.
   *  The source link in the dataset header therefore never rendered,
   *  silently, and the type agreed with the reader so nothing caught
   *  it.
   *
   *  Note a BioAssay's `accession` genuinely IS an object
   *  (`{id, accession, uri, …}`) — see the BioAssay type above. Two
   *  different shapes, one field name, which is how this happened. */
  accession?: string | null;
  /** Deep link to the record in its source database, resolved
   *  server-side. Present on every one of 500 datasets sampled
   *  2026-08-26; prefer it over constructing a URL. */
  externalUri?: string | null;
  /** `GEO`, `ARRAYEXPRESS`, `CELLXGENE`, `SRA`, … Absent for a direct
   *  upload, which is an ordinary case and not missing data. */
  externalDatabase?: string | null;
  /** How the source names it — usually the accession again. */
  externalLabel?: string | null;
  externalDatabaseUri?: string | null;
}

export interface PaginatedResponse<T> {
  data: T[];
  filter?: string;
  query?: string;
  offset: number;
  limit: number;
  sort?: string;
  totalElements: number;
  groupBy?: string[];
  warnings?: Array<{ reason?: string; message?: string }>;
  error?: { code?: number; message?: string };
}

export interface User {
  userName: string;
  group?: string;
}

export interface DatasetAnnotation {
  objectClass: string;
  /** @deprecated Gemma commit b5c6747f68 (merged, not yet deployed —
   *  prod is 5328441870) renames this to `category` with no
   *  server-side alias. Coalesced from `category` at fetch time by
   *  `withDatasetAnnotationCompat` (api/endpoints.ts) so this field
   *  stays populated either way — delete both once every Gemma this
   *  app talks to serves b5c6747f68. */
  className: string;
  /** @deprecated superseded by `categoryUri`; see `className`. */
  classUri: string | null;
  /** @deprecated superseded by `value`; see `className`. Also see the
   *  ``termName`` composition note below, which only applies pre-rename —
   *  post-rename `value` is always the bare term. */
  termName: string;
  /** @deprecated superseded by `valueUri`; see `className`. */
  termUri: string | null;
  /** Gemma's post-b5c6747f68 name for `className`. Absent from a
   *  pre-rename server. */
  category?: string;
  /** Post-b5c6747f68 name for `classUri`. */
  categoryUri?: string | null;
  /** Post-b5c6747f68 name for `termName`. Unlike `termName`, this is
   *  always the bare subject term, never a server-composed sentence —
   *  see `parseAnnotationStatement`. */
  value?: string;
  /** Post-b5c6747f68 name for `termUri`. */
  valueUri?: string | null;
  /** Present when this row is a subject-predicate-object statement
   *  rather than a bare term — `termUri`/`termName` above are the
   *  SUBJECT's own URI/label slot. Pre-rename, Gemma also folds the
   *  object(s) into `termName` itself as a server-composed run-on
   *  string (e.g. "Homozygous negative  Il10 [mouse] interleukin 10"
   *  for subject "Il10 [mouse] interleukin 10" / predicate
   *  "has_genotype" / object "Homozygous negative" — verified against
   *  gemma2.msl.ubc.ca 2026-08-30); that composition isn't a fixed
   *  format across statement shapes, so pre-rename `termName` is NOT
   *  reliably splittable in general. Post-rename, `value` is already
   *  the bare subject and no splitting is needed. See
   *  `parseAnnotationStatement`. */
  predicate?: string | null;
  predicateUri?: string | null;
  object?: string | null;
  objectUri?: string | null;
  secondPredicate?: string | null;
  secondPredicateUri?: string | null;
  secondObject?: string | null;
  secondObjectUri?: string | null;
}

/** Shape returned by GET /annotations/search?query=...  */
export interface AnnotationSearchResult {
  value: string;
  valueUri: string | null;
  category: string | null;
  categoryUri: string | null;
  usageCount?: number;
}

// Search settings ─ mirrors lib/models.js SearchSettings.
export interface SearchSettings {
  query?: string;
  // What's actually typed in the search input (may differ from `query`
  // until Enter is pressed).
  currentQuery?: string;
  taxon: Taxon[];
  platforms: Platform[];
  technologyTypes: string[];
  /** Annotations selected as "include". */
  annotations: AnnotationTerm[];
  /** Annotations selected as "exclude". */
  negativeAnnotations: AnnotationTerm[];
  /** Whole-category includes (any term in this category). */
  categories: Category[];
  /** Whole-category excludes. */
  negativeCategories: Category[];
  ignoreExcludedTerms: boolean;
}

export function emptySearchSettings(): SearchSettings {
  return {
    query: undefined,
    currentQuery: "",
    taxon: [],
    platforms: [],
    technologyTypes: [],
    annotations: [],
    negativeAnnotations: [],
    categories: [],
    negativeCategories: [],
    ignoreExcludedTerms: false,
  };
}
