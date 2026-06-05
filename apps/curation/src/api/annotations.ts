import { useQuery } from "@tanstack/react-query";
import { api } from "./client";

/**
 * One typeahead candidate. Shape mirrors what the curation mock /
 * adapter emits — snake_case fields that the design-tab pickers
 * consume directly. Gemma's `/annotations/search` carries
 * `usageCount` (camelCase) on the wire; whichever adapter feeds
 * this hook is responsible for translating to the snake_case shape
 * declared here. The 2026-05-xx "endpoint doesn't expose
 * usage_count" TODO is stale — the field is exposed, just under a
 * different name on the wire.
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
  const { limit = 25, enabled = true } = options;
  return useQuery({
    queryKey: KEY(query, category, limit),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (query) params.set("query", query);
      if (category) params.set("category", category);
      params.set("limit", String(limit));
      // Bias by how often each term has actually been used in
      // Gemma curations rather than the default Lucene tf-idf
      // ranking. Without this, common multi-word labels like
      // "wild type genotype" get tokenised and the matching term
      // sinks past the visible window — curators have to type
      // quoted phrases to find them. ``rank=usage`` lands in
      // Gemma 2.0 (phase2-acl-migrate); older servers ignore
      // unknown params, so this degrades to lucene ordering.
      params.set("rank", "usage");
      // Two response shapes live on the wire today (2026-05-23):
      //   - local_api returns the bare list ``[{label, uri,
      //     category_label, category_uri, usage_count}, …]``.
      //   - real Gemma's ``AnnotationsWebService`` wraps it in a
      //     ``ResponseDataObject<List<…>>`` envelope AND uses
      //     different field names on the value object:
      //     ``{value, valueUri, category, categoryUri, usageCount}``.
      //     The client's ``unwrapGemmaEnvelope`` + ``snakeify`` strip
      //     the envelope and lowercase the keys, but the
      //     ``value``/``valueUri``/``category`` rename has to happen
      //     here.
      // The ontology-routing exception in vite.config.ts can send this
      // request to either backend, so accept either shape and
      // normalise. Drop the gemma-shape branch when the routing
      // exception goes away (see project_ontology_routing_exception).
      type GemmaShape = {
        value?: string | null;
        value_uri?: string | null;
        category?: string | null;
        category_uri?: string | null;
        usage_count?: number | null;
      };
      type LocalShape = AnnotationCandidate;
      const raw = await api.get<
        Array<LocalShape | GemmaShape> | { data?: Array<LocalShape | GemmaShape> }
      >(`/rest/v2/annotations/search?${params.toString()}`);
      const rows: Array<LocalShape | GemmaShape> = Array.isArray(raw)
        ? raw
        : raw && Array.isArray(raw.data)
          ? raw.data
          : [];
      return rows.map((r): AnnotationCandidate => {
        // Local shape carries ``label``; Gemma shape carries
        // ``value``. ``label`` is what every consumer of
        // ``AnnotationCandidate`` reads, so coalesce here.
        const asLocal = r as Partial<LocalShape>;
        const asGemma = r as Partial<GemmaShape>;
        return {
          label: asLocal.label ?? asGemma.value ?? "",
          uri: asLocal.uri ?? asGemma.value_uri ?? null,
          category_label: asLocal.category_label ?? asGemma.category ?? "",
          category_uri: asLocal.category_uri ?? asGemma.category_uri ?? null,
          usage_count: asLocal.usage_count ?? asGemma.usage_count ?? 0,
        };
      });
    },
    staleTime: 1000 * 60 * 5,
    enabled,
  });
}
