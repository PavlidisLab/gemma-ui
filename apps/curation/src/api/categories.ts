import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import type { OntologyTerm } from "@/features/experiment/types";

const KEY = ["categories"] as const;

/**
 * Fetch the canonical list of factor / statement categories Gemma
 * accepts — `/rest/v2/annotations/categories`, which serves
 * `AnnotationCategoryValueObject`: `{uri, label, preferredPrefixes,
 * excludedPrefixes}`, exactly `OntologyTerm`'s shape.
 *
 * 🛑 **NOT `/rest/v2/categories`**, which is what this called until
 * 2026-08-31. That path is a RootWebService alias that 302-redirects
 * to `/datasets/categories` — the dataset USAGE FACET, a different
 * list for a different job — and reading it here was wrong three
 * times over (all measured on gemma2 2.9.4):
 *
 *   - **Wrong fields.** It serves `{category, categoryUri,
 *     numberOfExpressionExperiments}`. Nothing fills `label` / `uri`,
 *     so every entry read blank.
 *   - **Wrong envelope.** It answers with pagination siblings
 *     (`filter`, `groupBy`, `sort`, `limit`, `query`, `inferredTerms`),
 *     and `unwrapGemmaEnvelope` deliberately keeps those wrapped — so
 *     `api.get` handed back the envelope OBJECT where the caller
 *     expects an array, and `CategoryPicker` filtered over a non-array.
 *     `/annotations/categories` answers `{data}` alone and unwraps.
 *   - **Wrong list, and truncated.** The facet is a RANKING of the
 *     categories datasets actually carry, cut off by `limit` — 20 rows
 *     on the route's own default, which is what this call got, since it
 *     sent no limit. The published list is 28 and complete, and is what
 *     Gemma *accepts*, which is the question a category picker asks.
 *     The rest of the app already reasons over that number:
 *     `stripObsoletePrefix` in `lib/ontologyTerm.ts` and
 *     `categoryVerdict` in `features/design/termValidation.ts` both
 *     cite the same measurement. 28 is what the route published on
 *     2026-08-31 and again on 2026-09-04; it is a snapshot of a list
 *     that grows between Gemma releases, and no code here depends on
 *     the count.
 *   - **Different labels for the same URI.** `EFO_0000408` is in both
 *     lists, but the facet calls it `disease` and the published list
 *     calls it `obsolete_disease` — and the published spelling is the
 *     one `stripObsoletePrefix` exists to render and `categoryVerdict`
 *     exists to forgive. Reading the facet would have quietly made both
 *     of them dead code.
 *
 * Consumers key on URI, never on label (the EFO label is the obsolete
 * one) — see `validateTerms.ts`.
 *
 * The list is functionally immutable per session — its source
 * (`EFO.factor.categories.txt` in the Gemma java repo) only
 * changes between releases, and we re-fetch on full page load
 * anyway. So `staleTime: Infinity` and a long gcTime: TanStack
 * Query never refetches in the background once we have a hit.
 */
/** The one place the route is written. Exported so the contract test
 *  exercises the real request rather than a copy of the string — a test
 *  that hardcodes its own URL passes happily while this one drifts. */
export const CATEGORIES_ROUTE = "/rest/v2/annotations/categories";

/** The query function, exported for the same reason. */
export const fetchCategories = () =>
  api.get<OntologyTerm[]>(CATEGORIES_ROUTE);

export function useCategories() {
  return useQuery({
    queryKey: KEY,
    queryFn: fetchCategories,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 24, // hold the entry 24h before GC
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });
}
