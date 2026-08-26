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
  /** Whole serialised search + filter state, from ``?s=`` — what the
   *  Browser's "Copy link" button writes. See ``shareLink.ts``. */
  shared?: string;
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
  // The router's parsed search — NOT ``window.location.search``. Under
  // hash routing the app's query string lives inside the fragment
  // (/gemmaui/#/browser?s=…), so the real one is empty and reading it
  // would silently drop every param below. The router parses whatever
  // the active history hands it, which is the right string in both
  // modes; it also keeps these readable without declaring them in any
  // route's ``validateSearch``.
  const search = useRouterState({
    select: (s) => s.location.search as Record<string, unknown>,
  });
  const str = (k: string): string | null => {
    const v = search[k];
    return typeof v === "string" && v !== "" ? v : null;
  };
  const sort = str("sort");
  const updatedSince = str("updatedSince");
  const categoryUri = str("categoryUri");
  const annotationUri = str("annotationUri");
  return {
    query: params.query ? decodeURIComponent(params.query) : undefined,
    initialTaxon: params.initialTaxon,
    preset: params.preset,
    sort: sort ?? undefined,
    updatedSince: ISO_DATE.test(updatedSince ?? "") ? updatedSince! : undefined,
    categoryUri: HTTP_URI.test(categoryUri ?? "") ? categoryUri! : undefined,
    categoryLabel: str("categoryLabel") ?? undefined,
    annotationUri: HTTP_URI.test(annotationUri ?? "") ? annotationUri! : undefined,
    annotationLabel: str("annotationLabel") ?? undefined,
    taxon: str("taxon") ?? undefined,
    shared: str("s") ?? undefined,
  };
}
