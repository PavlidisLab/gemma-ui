import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import type { OntologyTerm } from "@/features/experiment/types";

const KEY = ["categories"] as const;

/**
 * Fetch the canonical list of factor / statement categories Gemma
 * accepts. Today this is served by the mock at
 * `/rest/v2/categories`; once the real Gemma side ships an endpoint
 * (see TODO-gemma-api.md) the URL stays the same.
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
