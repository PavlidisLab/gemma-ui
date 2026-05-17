// Routes for the Gemma Browser.
//
// Vue parity:
//   /                                  → Browser
//   /q/:query                          → Browser, with initial query
//   /t/:initialTaxon                   → Browser, with initial taxon
//   /t/:initialTaxon/q/:query          → Browser, with both
//   /:preset (only "scrnaseq" is real) → Browser, with preset
//   /404                               → NotFound

import {
  createRootRouteWithContext,
  createRoute,
  Outlet,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { BrowserPage } from "@/features/browser/BrowserPage";
import { NotFound } from "@/features/shared/NotFound";
import { AppShell } from "@/features/shared/AppShell";

interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
  notFoundComponent: NotFound,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <BrowserPage />,
});

const queryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/q/$query",
  component: () => <BrowserPage />,
});

const taxonRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/t/$initialTaxon",
  component: () => <BrowserPage />,
});

const taxonQueryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/t/$initialTaxon/q/$query",
  component: () => <BrowserPage />,
});

const presetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/$preset",
  component: () => <BrowserPage />,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  queryRoute,
  taxonRoute,
  taxonQueryRoute,
  presetRoute,
]);
