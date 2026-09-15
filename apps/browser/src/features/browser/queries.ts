// TanStack Query hooks for the browser page.

import { useQuery, useQueries, keepPreviousData } from "@tanstack/react-query";
import {
  getCategoriesWithChildren,
  getDatasets,
  getLibraryStrategyCount,
  getOpenApiSpec,
  getPlatforms,
  getTaxa,
  type DatasetsArgs,
} from "@/api/endpoints";
import { LIBRARY_STRATEGY_FACET, LIBRARY_STRATEGY_GROUPS } from "@/lib/platformConstants";

export interface BrowsingOptions {
  query?: string;
  filter: string[][];
  offset: number;
  limit: number;
  sort?: string;
  ignoreExcludedTerms: boolean;
}

export function useDatasets(opts: BrowsingOptions) {
  return useQuery({
    queryKey: ["datasets", opts],
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => {
      const args: DatasetsArgs = {
        query: opts.query,
        filter: opts.filter,
        offset: opts.offset,
        limit: opts.limit,
        sort: opts.sort,
      };
      return getDatasets(args, signal);
    },
  });
}

export function useTaxa(opts: { query?: string; filter: string[][] }) {
  return useQuery({
    queryKey: ["taxa", opts],
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => getTaxa(opts, signal),
  });
}

export function usePlatforms(opts: { query?: string; filter: string[][] }) {
  return useQuery({
    queryKey: ["platforms", opts],
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => getPlatforms(opts, signal),
  });
}

/** Every count the Type section shows, keyed by strategy value or group
 *  id: one per LIBRARY_STRATEGY_FACET value, one per group. */
const LIBRARY_STRATEGY_COUNTS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ...LIBRARY_STRATEGY_FACET.map((v) => [v, [v]] as const),
  ...LIBRARY_STRATEGY_GROUPS.map((g) => [g.id, g.members.map((m) => m.value)] as const),
];

export function useLibraryStrategyCounts(opts: { query?: string; filter: string[][] }) {
  return useQueries({
    queries: LIBRARY_STRATEGY_COUNTS.map(([key, values]) => ({
      queryKey: ["libraryStrategyCount", key, opts],
      placeholderData: keepPreviousData,
      queryFn: ({ signal }: { signal: AbortSignal }) => getLibraryStrategyCount(values, opts, signal),
    })),
    combine: (results) => ({
      counts: new Map<string, number | null>(
        LIBRARY_STRATEGY_COUNTS.map(([key], i) => [key, results[i].data ?? null]),
      ),
      isFetching: results.some((r) => r.isFetching),
      error: (results.find((r) => r.error)?.error as Error | undefined) ?? null,
    }),
  });
}

export function useCategories(opts: {
  query?: string;
  filter: string[][];
  applyExclusions: boolean;
  /** See CategoriesArgs.keepCategories — a category the visitor has
   *  selected stays in the facet so its count is real. */
  keepCategories?: string[];
}) {
  return useQuery({
    queryKey: ["categoriesWithChildren", opts],
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => getCategoriesWithChildren(opts, signal),
  });
}

export function useOpenApi() {
  return useQuery({
    queryKey: ["openapi"],
    queryFn: ({ signal }) => getOpenApiSpec(signal),
    staleTime: 60 * 60 * 1000,
  });
}

/** Pull technology-types from the OpenAPI spec. */
export function useTechnologyTypeOptions(): Array<{ id: string; label: string }> {
  const { data } = useOpenApi();
  const list =
    data?.components?.schemas?.FilterArgExpressionExperiment?.["x-gemma-filterable-properties"];
  if (!list) return [];
  const found = list.find((p) => p.name === "bioAssays.arrayDesignUsed.technologyType");
  if (!found?.allowedValues) return [];
  return found.allowedValues.map((v) => ({ id: v.value, label: v.label }));
}
