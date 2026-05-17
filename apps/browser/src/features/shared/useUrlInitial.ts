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
}

export function useUrlInitial(): UrlInitial {
  const params = useRouterState({
    select: (s) => (s.matches[s.matches.length - 1]?.params ?? {}) as Record<string, string>,
  });
  return {
    query: params.query ? decodeURIComponent(params.query) : undefined,
    initialTaxon: params.initialTaxon,
    preset: params.preset,
  };
}
