import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createHashHistory,
  createRouter,
} from "@tanstack/react-router";
import "./index.css";
import { routeTree } from "./routeTree";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Hash routing: routes live after the "#" (…/#/dataset/123).
//
// Not a style choice. This app is deployed as plain static files behind
// a web server we don't control, and a request for a real route path
// looks to that server like a request for a *file* of that name — it
// 404s before any JS runs. The usual cure is one directive telling the
// server to fall back to index.html (Apache's `FallbackResource`,
// nginx's `try_files`), which we cannot install where this is hosted.
//
// The fragment is never sent to the server, so hash routing sidesteps
// the whole problem: every route resolves against index.html, the one
// URL the server reliably serves. Swap back to the default browser
// history the day that directive lands — see "Routing" in CLAUDE.md
// for what else changes.
//
// No `basepath` here on purpose: the fragment is its own path universe
// starting at "/", so a sub-path mount point is *not* part of it.
// Vite's `base` carries that prefix for asset URLs, and
// createHashHistory re-attaches it to generated hrefs by keeping the
// live window.location.pathname. Setting basepath here would make the
// router look for #/<mount>/browser and match nothing.
const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: "intent",
  context: { queryClient },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
