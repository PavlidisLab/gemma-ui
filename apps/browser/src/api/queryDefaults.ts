import type { DefaultOptions } from "@tanstack/react-query";
import { ApiError } from "./client";

/**
 * The app's query defaults. Shared with the render-test harness
 * (`test/renderRoute.tsx`) so a test sees the same caching the app
 * does: with a different `staleTime` there, a component that mounts
 * after a query has answered refetches under test and not in the app,
 * and a spec counting requests measures the harness.
 */
export const queryDefaults: DefaultOptions["queries"] = {
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
};
