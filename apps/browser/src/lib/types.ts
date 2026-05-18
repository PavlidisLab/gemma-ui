// Domain types mirroring the Gemma REST shapes consumed by GemBrow.
// Hand-written for now; replace with openapi-typescript codegen later.

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
