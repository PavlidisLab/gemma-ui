// Routes for the new Gemma browser.
//
// Shape change vs. the Vue legacy:
//   - "/" now lands on the new HomePage (was: dropped straight into
//     the Browser). The legacy Browser routes move under /browser/*.
//   - "/platforms" is a new top-level page replacing
//     /arrays/showAllArrayDesigns.html.
//   - Legacy preset URLs (/scrnaseq etc.) are preserved under
//     /browser/$preset so existing links don't break.

import {
  createRootRouteWithContext,
  createRoute,
  Outlet,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { HomePage } from "@/features/home/HomePage";
import { HomeDashboard } from "@/features/home/variants/HomeDashboard";
import { BrowserPage } from "@/features/browser/BrowserPage";
import { PlatformsPage } from "@/features/platforms/PlatformsPage";
import { PlatformDetailPage } from "@/features/platforms/PlatformDetailPage";
import { HeatmapDemo } from "@/features/heatmap-demo/HeatmapDemo";
import { HeatmapDemoV2 } from "@/features/heatmap-demo/HeatmapDemoV2";
import { DatasetPage } from "@/features/dataset/DatasetPage";
import { GenePage } from "@/features/gene/GenePage";
import { GenesPage } from "@/features/gene/GenesPage";
import { AboutPage } from "@/features/about/AboutPage";
import { McpPage } from "@/features/mcp/McpPage";
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
  component: () => <HomePage />,
});

// Browser routes — same Vue-side semantics, now nested under /browser.
const browserRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/browser",
  component: () => <BrowserPage />,
});

const browserQueryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/browser/q/$query",
  component: () => <BrowserPage />,
});

const browserTaxonRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/browser/t/$initialTaxon",
  component: () => <BrowserPage />,
});

const browserTaxonQueryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/browser/t/$initialTaxon/q/$query",
  component: () => <BrowserPage />,
});

const browserPresetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/browser/$preset",
  component: () => <BrowserPage />,
});

const platformsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/platforms",
  component: () => <PlatformsPage />,
});

const platformDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/platforms/$shortName",
  component: () => <PlatformDetailPage />,
});

// Standalone "summary" destination — reuses the Dashboard variant
// so curators who want the deep stats view have a stable URL,
// independent of whichever home variant they've pinned.
const summaryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/summary",
  component: () => <HomeDashboard />,
});

const heatmapDemoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/heatmap-demo",
  component: () => <HeatmapDemo />,
});

const heatmapDemoV2Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/heatmap-demo-v2",
  component: () => <HeatmapDemoV2 />,
});

// Public expression-experiment page. Accepts either numeric id or
// short-name (GSE...) — getDatasetById takes both.
const datasetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dataset/$id",
  component: () => <DatasetPage />,
});

// Gene search landing page.
const genesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/genes",
  component: () => <GenesPage />,
});

// Per-gene page. Accepts numeric id or official symbol.
const geneRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/gene/$id",
  component: () => <GenePage />,
});

const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/about",
  component: () => <AboutPage />,
});

const mcpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/mcp",
  component: () => <McpPage />,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  browserRoute,
  browserQueryRoute,
  browserTaxonRoute,
  browserTaxonQueryRoute,
  browserPresetRoute,
  platformsRoute,
  platformDetailRoute,
  summaryRoute,
  heatmapDemoRoute,
  heatmapDemoV2Route,
  datasetRoute,
  genesRoute,
  geneRoute,
  aboutRoute,
  mcpRoute,
]);
