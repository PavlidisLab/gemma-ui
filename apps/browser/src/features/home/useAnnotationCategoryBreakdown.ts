/**
 * Per-annotation-category distinct-term breakdown for the home
 * page bar chart.
 *
 * Two-phase fetch:
 *   1. ``GET /rest/v2/datasets/categories?limit=<N>`` returns the
 *      categories Gemma uses + ``numberOfExpressionExperiments`` per
 *      category. We take the top ``N`` ranked by experiment count
 *      as the chart's row set.
 *   2. For each category, ``GET /rest/v2/datasets/annotations/count
 *      ?category=<URI-or-label>&excludeFreeText=true`` returns the
 *      distinct ontology-term count for THAT category.
 *
 * The fan-out is N parallel queries. Each is cheap and HTTP-cached
 * server-side for ~1200 s, so a second visit is near-free.
 *
 * What we'd ideally have instead — file when convenient:
 *   ``GET /rest/v2/datasets/annotations/category-counts
 *      ?excludeFreeText=true&limit=<N>``
 *   →  ``{ data: [{ category, categoryUri, count }, ...] }``
 *
 * Until then this hook does the fan-out.
 */

import { useQueries, useQuery } from "@tanstack/react-query";
import { apiGet } from "@/api/client";
import type { PaginatedResponse } from "@/lib/types";

const BASE = "/rest/v2";

interface CategoryRow {
  classUri: string | null;
  className: string | null;
  numberOfExpressionExperiments?: number;
}

export interface CategoryBreakdownRow {
  label: string;
  /** URI passed to the count endpoint. ``null`` → label-form was
   *  used (free-text or uncategorised category). */
  uri: string | null;
  /** Experiments using any annotation in this category. From
   *  ``/datasets/categories``. */
  experiments: number;
  /** Distinct ontology-backed terms used to annotate within this
   *  category (excludes free-text variants). ``null`` while loading
   *  or if the count query failed. */
  terms: number | null;
}

export interface AnnotationCategoryBreakdown {
  rows: CategoryBreakdownRow[];
  isLoading: boolean;
  isError: boolean;
}

/** Drop categories that aren't useful to surface on a public home
 *  page — uncategorised free-text and Gemma-internal slots. */
function isInterestingCategory(c: CategoryRow): boolean {
  if (!c.className) return false;
  const name = c.className.trim().toLowerCase();
  if (!name) return false;
  // "uncategorized" / "uncategorised" — free-text bucket, not a
  // user-facing category.
  if (name.includes("uncategor")) return false;
  return true;
}

export function useAnnotationCategoryBreakdown(
  topN = 12,
): AnnotationCategoryBreakdown {
  // Phase 1 — categories list. Pull 30 so we have headroom after
  // filtering uninteresting buckets; slice to ``topN`` after.
  const categories = useQuery({
    queryKey: ["category-breakdown", "categories", 30],
    queryFn: async ({ signal }) => {
      const r = await apiGet<PaginatedResponse<CategoryRow>>(
        `${BASE}/datasets/categories?limit=30`,
        { signal },
      );
      return r.data ?? [];
    },
    staleTime: 10 * 60_000,
    retry: false,
  });

  const top = (categories.data ?? [])
    .filter(isInterestingCategory)
    .sort(
      (a, b) =>
        (b.numberOfExpressionExperiments ?? 0) -
        (a.numberOfExpressionExperiments ?? 0),
    )
    .slice(0, topN);

  // Phase 2 — fan out one count query per category. Prefer URI
  // form (bro's reply doc: URIs are canonical; labels can drift),
  // fall back to className when no URI is present.
  const counts = useQueries({
    queries: top.map((c) => {
      const param = c.classUri
        ? `category=${encodeURIComponent(c.classUri)}`
        : `category=${encodeURIComponent(c.className ?? "")}`;
      return {
        queryKey: ["category-breakdown", "count", c.classUri ?? c.className],
        queryFn: async ({ signal }: { signal?: AbortSignal }) => {
          const r = await apiGet<{ data?: number }>(
            `${BASE}/datasets/annotations/count?${param}&excludeFreeText=true`,
            { signal },
          );
          return r.data ?? 0;
        },
        staleTime: 10 * 60_000,
        retry: false,
      };
    }),
  });

  const rows: CategoryBreakdownRow[] = top.map((c, i) => ({
    label: c.className ?? "(unlabelled)",
    uri: c.classUri,
    experiments: c.numberOfExpressionExperiments ?? 0,
    terms: counts[i]?.data ?? null,
  }));

  return {
    rows,
    isLoading:
      categories.isLoading || counts.some((q) => q.isLoading && !q.isFetched),
    isError: categories.isError,
  };
}
