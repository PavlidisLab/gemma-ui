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
import { ApiError } from "./api/client";
import { initAnalytics } from "./lib/analytics";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // A 4xx is the server saying the request itself is wrong, so
      // sending it again cannot change the answer. Measured: one
      // `tumour OR normal` in the annotation search fired TWO 400s at
      // gemma2, and the second only delayed the message the user was
      // waiting for. 408 and 429 are the exceptions — those do invite
      // a retry.
      retry: (failureCount, error) => {
        if (
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 408 &&
          error.status !== 429
        ) {
          return false;
        }
        return failureCount < 1;
      },
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

// Google Analytics. Called once, outside the React tree: StrictMode
// double-invokes effects in development, and this must not load the tag
// twice. It self-gates to a public origin — see lib/analytics.ts.
initAnalytics(router);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
