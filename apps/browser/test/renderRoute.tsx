/**
 * Mount the real app at a route, in jsdom.
 *
 * Uses the app's own `routeTree` and a memory history rather than a
 * hand-built router around one component: the pages read `useParams` /
 * `useSearch` / `useNavigate`, and a stub router would be a second
 * definition of the routing that the app would then be free to drift
 * from. The cost is that `AppShell` (bar, footer) mounts too, which is
 * also coverage.
 *
 * Pair with `installGemmaFetch` — with no fetch stub the app talks to
 * whatever `fetch` jsdom has, which is a real network call.
 */
import { render, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from "@tanstack/react-router";

import { routeTree } from "@/routeTree";
import { queryDefaults } from "@/api/queryDefaults";

export interface RenderRouteResult extends RenderResult {
  queryClient: QueryClient;
}

export function renderRoute(path: string): RenderRouteResult {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // The app's own caching — see `queryDefaults` for why a test
        // must not differ here.
        ...queryDefaults,
        // Except retries: a test asserts on one render, so a retry only
        // delays the failure it is meant to show.
        retry: false,
      },
    },
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient },
    defaultPendingMinMs: 0,
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      {/* The router's type is generic over the route tree; the provider
          wants that exact instance type, which is what this is. */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return Object.assign(view, { queryClient });
}
