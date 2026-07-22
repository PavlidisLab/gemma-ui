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
import { BrowserPage } from "@/features/browser/BrowserPage";
import { PlatformsPage } from "@/features/platforms/PlatformsPage";
import { PlatformDetailPage } from "@/features/platforms/PlatformDetailPage";
import { HeatmapDemo } from "@/features/heatmap-demo/HeatmapDemo";
import { HeatmapDemoV2 } from "@/features/heatmap-demo/HeatmapDemoV2";
import { DatasetPage } from "@/features/dataset/DatasetPage";
import { GenePage } from "@/features/gene/GenePage";
import { GeneRedirect } from "@/features/gene/GeneRedirect";
import { GenesPage } from "@/features/gene/GenesPage";
import { McpPage } from "@/features/mcp/McpPage";
import { ExtjsMockup } from "@/features/mockup-extjs/ExtjsMockup";
import { SystemMonitoringPage } from "@/features/admin/SystemMonitoringPage";
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

// /summary route removed 2026-05-26 — pointed at the (now-deleted)
// HomeDashboard variant. With only one home layout, the route was
// indistinguishable from "/".

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

// Per-gene page, keyed by NCBI gene id (symbols collide across taxa).
const geneRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/gene/ncbi/$ncbiId",
  component: () => <GenePage />,
});

// Legacy redirect — old /gene/$id links (symbol or bare id) resolve to
// an NCBI id and forward to the canonical /gene/ncbi/$ncbiId.
const geneLegacyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/gene/$id",
  component: () => <GeneRedirect />,
});

const mcpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/mcp",
  component: () => <McpPage />,
});

// Skin mockup — ExtJS-classic re-skin of the public surfaces. Static
// data, no API. Lives behind a hidden route so a stylesheet pass
// doesn't leak into the main app while the look is under review.
const extjsMockupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/mockup-extjs",
  component: () => <ExtjsMockup />,
});

// Systems Monitoring — admin-only diagnostics dashboard (replaces
// the legacy systemStats.jsp + activeUsers.jsp). Gates client-side
// on the first 401/403 from /admin/system; auth comes via the
// Spring session cookie set by the legacy Gemma admin login.
const adminSystemRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/system",
  component: () => <SystemMonitoringPage />,
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
  heatmapDemoRoute,
  heatmapDemoV2Route,
  datasetRoute,
  genesRoute,
  geneRoute,
  geneLegacyRoute,
  mcpRoute,
  extjsMockupRoute,
  adminSystemRoute,
]);
