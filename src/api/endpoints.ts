// Endpoint helpers + TanStack Query keys for Gemma REST.
//
// Mirrors the actions registered in legacy-vue/src/store/modules/vapi.js.

import { apiGet, type Params } from "./client";
import { compressFilter, compressArg } from "@/lib/utils";
import { excludedCategories, excludedTerms } from "@/lib/gemmaConfig";
import type {
  AnnotationSearchResult,
  AnnotationTerm,
  CategoryWithChildren,
  Dataset,
  DatasetAnnotation,
  PaginatedResponse,
  Platform,
  Taxon,
  User,
} from "@/lib/types";

const BASE = "/rest/v2";

/* --------------------- requests --------------------- */

export interface DatasetsArgs {
  query?: string;
  filter: string[][];
  offset: number;
  limit: number;
  sort?: string;
  gid?: string;
}

export async function getDatasets(args: DatasetsArgs, signal?: AbortSignal): Promise<PaginatedResponse<Dataset>> {
  const compressed = await compressFilter(args.filter);
  const params: Params = {
    filter: compressed,
    offset: args.offset,
    limit: args.limit,
    sort: args.sort,
    query: args.query,
    gid: args.gid,
  };
  return apiGet<PaginatedResponse<Dataset>>(`${BASE}/datasets`, { params, signal });
}

export interface CategoriesArgs {
  query?: string;
  filter: string[][];
  limit?: number;
  applyExclusions: boolean; // true ⇒ send excludedCategories/Terms
  gid?: string;
}

const DISALLOWED_CATEGORY_FILTER_PREFIXES = [
  "allCharacteristics.",
  "characteristics.",
  "bioAssays.sampleUsed.characteristics.",
  "experimentalDesign.experimentalFactors.factorValues.characteristics.",
];

export async function getCategories(args: CategoriesArgs, signal?: AbortSignal) {
  // Strip annotation-style sub-clauses from the filter — we don't want
  // selecting a value to hide the category it belongs to.
  let mFilter = args.filter
    .map((c) => c.filter((sc) => !DISALLOWED_CATEGORY_FILTER_PREFIXES.some((p) => sc.startsWith(p))))
    .filter((c) => c.length > 0);
  const compressed = await compressFilter(mFilter);
  const params: Params = {
    filter: compressed,
    limit: args.limit ?? 20,
    query: args.query,
    gid: args.gid,
  };
  if (args.applyExclusions) {
    params.excludedCategories = await compressArg(excludedCategories.join(","));
    params.excludeFreeTextCategories = "true";
    params.excludeUncategorizedTerms = "true";
    params.excludedTerms = await compressArg(excludedTerms.join(","));
  }
  return apiGet<PaginatedResponse<{
    classUri: string | null;
    className: string | null;
    numberOfExpressionExperiments?: number;
  }>>(`${BASE}/datasets/categories`, { params, signal });
}

export interface AnnotationsByCategoryArgs {
  category: string;
  query?: string;
  filter: string[][];
  limit?: number;
  excludeFreeText?: boolean;
  applyExclusions: boolean;
  gid?: string;
}

export async function getAnnotationsByCategory(args: AnnotationsByCategoryArgs, signal?: AbortSignal) {
  const compressed = await compressFilter(args.filter);
  const params: Params = {
    category: args.category,
    filter: compressed,
    limit: args.limit ?? 200,
    exclude: ["parentTerms"],
    retainMentionedTerms: true,
    query: args.query,
    gid: args.gid,
  };
  if (args.applyExclusions) {
    params.excludedTerms = await compressArg(excludedTerms.join(","));
    if (args.excludeFreeText) params.excludeFreeTextTerms = "true";
  }
  return apiGet<PaginatedResponse<AnnotationTerm>>(`${BASE}/datasets/annotations`, { params, signal });
}

export interface PlatformsArgs {
  query?: string;
  filter: string[][];
  limit?: number;
  gid?: string;
}

export async function getPlatforms(args: PlatformsArgs, signal?: AbortSignal) {
  let mFilter = args.filter
    .map((c) => c.filter((sc) => !sc.startsWith("bioAssays.arrayDesignUsed.") && !sc.startsWith("bioAssays.originalPlatform.")))
    .filter((c) => c.length > 0);
  const compressed = await compressFilter(mFilter);
  const params: Params = {
    filter: compressed,
    limit: args.limit ?? 200,
    query: args.query,
    gid: args.gid,
  };
  return apiGet<PaginatedResponse<Platform>>(`${BASE}/datasets/platforms`, { params, signal });
}

export interface TaxaArgs {
  query?: string;
  filter: string[][];
  gid?: string;
}

export async function getTaxa(args: TaxaArgs, signal?: AbortSignal) {
  let mFilter = args.filter
    .map((c) => c.filter((sc) => !sc.startsWith("taxon.")))
    .filter((c) => c.length > 0);
  const compressed = await compressFilter(mFilter);
  const params: Params = {
    filter: compressed,
    query: args.query,
    gid: args.gid,
  };
  return apiGet<PaginatedResponse<Taxon>>(`${BASE}/datasets/taxa`, { params, signal });
}

export async function getMyself(signal?: AbortSignal): Promise<User | null> {
  try {
    const r = await apiGet<{ data?: User; error?: { code?: number } }>(`${BASE}/users/me`, { signal });
    if (r.error?.code === 401) return null;
    return r.data ?? null;
  } catch (e) {
    // 401 ⇒ not logged in, not an error
    if (e && typeof e === "object" && "status" in e && (e as { status: number }).status === 401) {
      return null;
    }
    throw e;
  }
}

export async function getDatasetAnnotations(datasetId: number, signal?: AbortSignal) {
  return apiGet<PaginatedResponse<DatasetAnnotation>>(
    `${BASE}/datasets/${datasetId}/annotations`,
    { signal },
  );
}

/**
 * Free-text search over the full ontology — used as a fallback when
 * the local AnnotationSelector tree is capped at 200 terms per
 * category and the user types something not in that window.
 *
 * The endpoint does not carry per-experiment counts in our corpus
 * (usageCount tends to be 0); we surface results as "more matches"
 * and the click-to-add path attaches the term to filters, after
 * which counts update via the normal dataset query.
 */
export async function searchAnnotations(
  query: string,
  limit = 30,
  signal?: AbortSignal,
): Promise<AnnotationSearchResult[]> {
  const r = await apiGet<{ data?: AnnotationSearchResult[] }>(
    `${BASE}/annotations/search`,
    { params: { query, limit }, signal },
  );
  return r.data ?? [];
}

export async function getOpenApiSpec(signal?: AbortSignal) {
  return apiGet<{
    components?: {
      schemas?: {
        FilterArgExpressionExperiment?: {
          "x-gemma-filterable-properties"?: Array<{
            name: string;
            allowedValues?: Array<{ value: string; label: string }>;
          }>;
        };
      };
    };
  }>(`${BASE}/openapi.json`, { signal });
}

/** Categories endpoint also returns annotations under each category as a separate call. */
export async function getCategoriesWithChildren(
  args: CategoriesArgs,
  signal?: AbortSignal,
): Promise<CategoryWithChildren[]> {
  const cats = await getCategories(args, signal);
  const list = cats.data ?? [];
  if (!list.length) return [];

  const children = await Promise.all(
    list.map(async (cat) => {
      const catId = cat.classUri || cat.className?.toLowerCase() || "";
      if (!catId) return { ...cat, children: [] };
      try {
        const r = await getAnnotationsByCategory(
          {
            category: catId,
            query: args.query,
            filter: args.filter,
            applyExclusions: args.applyExclusions,
            excludeFreeText: args.applyExclusions,
            gid: args.gid,
          },
          signal,
        );
        return { ...cat, children: r.data ?? [] };
      } catch {
        return { ...cat, children: [] };
      }
    }),
  );

  return children.filter((c) => c.children.length > 0);
}
