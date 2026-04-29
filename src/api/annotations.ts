import { useQuery } from "@tanstack/react-query";
import { api } from "./client";

/**
 * One typeahead candidate. Shape matches what we want from Gemma's
 * `/annotations/search` (with a `usage_count` field that the real
 * endpoint doesn't currently expose — see TODO-gemma-api.md).
 */
export interface AnnotationCandidate {
  label: string;
  uri: string | null;
  category_label: string;
  category_uri: string | null;
  /** How many times this term has been used across Gemma. Drives
   *  the bold/regular split in the picker. */
  usage_count: number;
}

const KEY = (q: string, category: string | null, limit: number) =>
  ["annotations-search", q, category ?? "", limit] as const;

/**
 * Debounced typeahead query. Empty `query` returns the full list
 * (still category-filtered) so an unprimed picker still shows
 * suggestions ranked by usage. Long stale-time — usage counts
 * barely move within a session.
 */
export function useAnnotationSearch(
  query: string,
  category: string | null,
  options: { limit?: number; enabled?: boolean } = {},
) {
  const { limit = 10, enabled = true } = options;
  return useQuery({
    queryKey: KEY(query, category, limit),
    queryFn: () => {
      const params = new URLSearchParams();
      if (query) params.set("query", query);
      if (category) params.set("category", category);
      params.set("limit", String(limit));
      return api.get<AnnotationCandidate[]>(
        `/rest/v2/annotations/search?${params.toString()}`,
      );
    },
    staleTime: 1000 * 60 * 5,
    enabled,
  });
}
