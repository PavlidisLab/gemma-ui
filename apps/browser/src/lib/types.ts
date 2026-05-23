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

export interface BioMaterial {
  id?: number;
  name?: string | null;
  description?: string | null;
  characteristics?: Array<{ value?: string; category?: string; valueUri?: string | null }>;
  factorValues?: Array<{ id?: number; value?: string | null }>;
}

export interface BioAssay {
  id: number;
  name?: string | null;
  shortName?: string | null;
  description?: string | null;
  accession?: { accession?: string } | null;
  arrayDesign?: { shortName?: string; name?: string } | null;
  sample?: BioMaterial | null;
  outlier?: boolean;
  predictedOutlier?: boolean;
  userFlaggedOutlier?: boolean;
  processingDate?: string | null;
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
  geeq?: { publicQualityScore?: number } | null;
}

// ─── GEEQ ─────────────────────────────────────────────────────────────────────

export interface GeeqScores {
  publicQualityScore?: number | null;
  publicSuitabilityScore?: number | null;
  /** Suitability scores — range −1 to 1 */
  sScorePublication?: number | null;
  sScoreOutliers?: number | null;
  sScoreSampleMeanCorrelation?: number | null;
  sScoreExperimentDesignProblems?: number | null;
  sScoreReplicates?: number | null;
  sScorePlatformTechMulti?: number | null;
  sScorePlatformPopularity?: number | null;
  /** Quality scores — range −1 to 1 */
  qScoreOutlierLow?: number | null;
  qScoreOutlierHigh?: number | null;
  qScoreSampleCorrelation?: number | null;
  qScorePlatformAmount?: number | null;
  qScoreReplicateCorrelation?: number | null;
  qScoreRawDataAvailable?: number | null;
  qScoreRawDataSuitable?: number | null;
  qScorePublicBatchEffect?: number | null;
  qScorePublicBatchConfound?: number | null;
  [key: string]: number | null | undefined;
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
    geneNcbiId?: number | null;
    vectors: {
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

// ─── SVD ─────────────────────────────────────────────────────────────────────

export interface SvdResult {
  /** Fraction of variance explained per component (0-indexed). */
  variances?: number[] | null;
  /** Bio-assay scores on the top components. Map from bioAssay ID to component scores. */
  bioAssayScores?: Record<string, number[]> | null;
  /** Eigenvalues. */
  eigenValues?: number[] | null;
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
  troubled?: boolean;
  needsAttention?: boolean;
  curationNote?: string;
  lastUpdated?: string;
  releaseVersion?: string;
  releaseUrl?: string | null;
  externalReferences?: Array<{ accession?: string; externalDatabase?: { name?: string } }>;
}

export interface AnnotationTerm {
  classUri: string | null;
  className: string | null;
  termUri: string | null;
  termName: string | null;
  numberOfExpressionExperiments?: number;
  children?: AnnotationTerm[] | null;
}

export interface Category {
  classUri: string | null;
  className: string | null;
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
  geeq?: { publicQualityScore?: number };
  characteristics?: DatasetCharacteristic[];
  curationNote?: string;
  searchResult?: {
    score?: number;
    highlights?: Record<string, string> | null;
  };
  accession?: { accession?: string };
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
  className: string;
  classUri: string | null;
  termName: string;
  termUri: string | null;
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
