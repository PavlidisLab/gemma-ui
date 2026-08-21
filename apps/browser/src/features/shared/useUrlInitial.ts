// Read initial state from the URL (router params) once, on mount.
//
// We don't bind the SearchSettings two-way to the URL — typing in
// the search box shouldn't navigate. The Vue browser also follows
// this pattern: the URL reflects the **applied** query (set after
// the user presses Enter).

import { useRouterState } from "@tanstack/react-router";

export interface UrlInitial {
  query?: string;
  initialTaxon?: string;
  preset?: string;
  /** Optional initial sort key — read once from
   *  ``window.location.search`` (``?sort=…``). Lets external entry
   *  points like the home page's recent-activity "see all" land
   *  the browser with a different default sort than the route-tree
   *  fallback. Bound at mount only; user-triggered column sorts
   *  don't propagate back to the URL today. */
  sort?: string;
  /** Optional ``YYYY-MM-DD`` lower bound on ``lastUpdated`` — read
   *  once from ``?updatedSince=``. The home page's "N updated this
   *  week" stat links here so the list the visitor lands on is
   *  exactly the set that was counted. */
  updatedSince?: string;
  /** Whole-category include, from ``?categoryUri=`` (+ optional
   *  ``?categoryLabel=`` for the side-panel row). */
  categoryUri?: string;
  categoryLabel?: string;
  /** A single annotation term to arrive with selected, from
   *  ``?annotationUri=`` (+ ``?annotationLabel=``). Scoped by
   *  ``categoryUri`` / ``categoryLabel`` when those are present, which
   *  is what lets the side panel show it ticked under its category
   *  rather than floating loose. */
  annotationUri?: string;
  annotationLabel?: string;
  /** Species hint for ``/gene/$id`` — see GeneRedirect. */
  taxon?: string;
}

/** ``updatedSince`` goes straight into a Gemma filter clause, so only
 *  a bare ISO date is accepted — anything else is dropped rather than
 *  forwarded. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Same reasoning for ``categoryUri`` / ``annotationUri`` — they end up
 *  in filter clauses, so only an ontology-shaped URI gets through. */
const HTTP_URI = /^https?:\/\/\S+$/;

export function useUrlInitial(): UrlInitial {
  const params = useRouterState({
    select: (s) => (s.matches[s.matches.length - 1]?.params ?? {}) as Record<string, string>,
  });
  // window.location.search is the source of truth for query-string
  // params without declaring them in the route's ``validateSearch``.
  // Defensive guard for non-browser environments (vitest happy path).
  const search =
    typeof window === "undefined" ? "" : window.location.search;
  const qs = search ? new URLSearchParams(search) : null;
  const sort = qs?.get("sort") ?? null;
  const updatedSince = qs?.get("updatedSince") ?? null;
  const categoryUri = qs?.get("categoryUri") ?? null;
  const annotationUri = qs?.get("annotationUri") ?? null;
  return {
    query: params.query ? decodeURIComponent(params.query) : undefined,
    initialTaxon: params.initialTaxon,
    preset: params.preset,
    sort: sort ?? undefined,
    updatedSince: ISO_DATE.test(updatedSince ?? "") ? updatedSince! : undefined,
    categoryUri: HTTP_URI.test(categoryUri ?? "") ? categoryUri! : undefined,
    categoryLabel: qs?.get("categoryLabel") ?? undefined,
    annotationUri: HTTP_URI.test(annotationUri ?? "") ? annotationUri! : undefined,
    annotationLabel: qs?.get("annotationLabel") ?? undefined,
    taxon: qs?.get("taxon") ?? undefined,
  };
}
