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
   *  points like the home page's "Recently updated → see all" land
   *  the browser with a different default sort than the route-tree
   *  fallback. Bound at mount only; user-triggered column sorts
   *  don't propagate back to the URL today. */
  sort?: string;
}

export function useUrlInitial(): UrlInitial {
  const params = useRouterState({
    select: (s) => (s.matches[s.matches.length - 1]?.params ?? {}) as Record<string, string>,
  });
  // window.location.search is the source of truth for query-string
  // params without declaring them in the route's ``validateSearch``.
  // Defensive guard for non-browser environments (vitest happy path).
  const search =
    typeof window === "undefined" ? "" : window.location.search;
  const sort = search ? new URLSearchParams(search).get("sort") : null;
  return {
    query: params.query ? decodeURIComponent(params.query) : undefined,
    initialTaxon: params.initialTaxon,
    preset: params.preset,
    sort: sort ?? undefined,
  };
}
