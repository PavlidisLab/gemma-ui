import React from "react";
import ReactDOM from "react-dom/client";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import App from "./App";
import { ApiError } from "./api/client";
import { saveStoredSession } from "./api/session";
import { initTheme } from "./features/settings/useTheme";
import "./index.css";

/**
 * Global 401 handler — clears the session and busts the ``["me"]``
 * cache so the App's ``useMe`` consumer drops to ``<LoginPage/>``
 * on the next render. Without this, an expired session leaves the
 * curator staring at cryptic mid-page "401 Unauthorized" errors
 * with no way to recover except a hard refresh + login.
 *
 * Both QueryCache and MutationCache get the handler — TanStack
 * Query routes errors through one or the other depending on the
 * call shape. We trigger on the typed ``ApiError`` only; bare
 * ``Error`` instances flow through unchanged.
 */
function handle401(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 401) return;
  saveStoredSession(null);
  // Drop ``me`` so the next render sees no user and routes to login.
  // Don't ``invalidateQueries()`` broadly — that would refetch every
  // active observer and produce a flood of further 401s.
  queryClient.setQueryData(["me"], null);
}

const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
  queryCache: new QueryCache({ onError: handle401 }),
  mutationCache: new MutationCache({ onError: handle401 }),
});

// Apply the saved theme before React mounts so the first paint
// already reflects the curator's preference.
initTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
