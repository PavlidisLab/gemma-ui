import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import type { OntologyTerm } from "@/features/experiment/types";

const KEY = ["categories"] as const;

/**
 * Fetch the canonical list of factor / statement categories Gemma
 * accepts. Served by `/rest/v2/categories`, which on real Gemma
 * 302-redirects to `/datasets/categories` (RootWebService alias).
 * Same URL as the curation mock, so the call site doesn't care
 * which one it's hitting.
 *
 * The list is functionally immutable per session — its source
 * (`EFO.factor.categories.txt` in the Gemma java repo) only
 * changes between releases, and we re-fetch on full page load
 * anyway. So `staleTime: Infinity` and a long gcTime: TanStack
 * Query never refetches in the background once we have a hit.
 */
export function useCategories() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get<OntologyTerm[]>("/rest/v2/categories"),
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 24, // hold the entry 24h before GC
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });
}
