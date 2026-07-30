/**
 * @vitest-environment jsdom
 *
 * Regression test for the cross-experiment commit-stamp guard: the
 * commit body is re-stamped to the routed experiment id in
 * ``useUpdateDesign`` before the PUT. This is the belt-and-suspenders
 * net — it closes the cross-experiment leak regardless of how the
 * editing buffer got mis-seeded, because the wire body can never
 * diverge from the URL path.
 *
 * Lives in its own file because it exercises the REAL ``useUpdateDesign``
 * against a mocked api client; the provider tests in
 * ``DesignDraftContext.render.test.tsx`` mock ``@/api/design`` wholesale,
 * which would shadow the hook under test here.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createElement } from "react";
import type { Design } from "@/features/experiment/types";

vi.mock("@/api/client", () => ({
  api: { put: vi.fn() },
}));

import { api } from "@/api/client";
import { useUpdateDesign } from "@/api/design";

const apiPut = api.put as ReturnType<typeof vi.fn>;

const ROUTE_EID = 91654;
const FOREIGN_EID = 38401;

function makeDesign(experimentId: number): Design {
  return {
    experiment_id: experimentId,
    experiment_short_name: "GSE_TEST",
    factors: [],
    biomaterials: [],
    tags: [],
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Echo the body back so the hook's post-PUT normalisation has a
  // well-formed Design to work with.
  apiPut.mockImplementation(async (_url: string, body: Design) => body);
});

describe("useUpdateDesign — commit body is re-stamped to the route id", () => {
  it("overwrites a foreign body experiment_id with the routed id before PUT", async () => {
    const { result } = renderHook(
      () => useUpdateDesign(ROUTE_EID, "local-curator"),
      { wrapper },
    );

    // A mis-seeded buffer carrying the WRONG experiment id.
    await result.current.mutateAsync(makeDesign(FOREIGN_EID));

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    const [url, body] = apiPut.mock.calls[0] as [string, Design];
    // URL targets the route experiment…
    expect(url).toContain(`/datasets/${ROUTE_EID}/design`);
    // …and the body id was re-stamped to match it (not the foreign id).
    expect(body.experiment_id).toBe(ROUTE_EID);
    expect(body.experiment_id).not.toBe(FOREIGN_EID);
  });

  it("is a no-op stamp when the body already matches the route", async () => {
    const { result } = renderHook(() => useUpdateDesign(ROUTE_EID), {
      wrapper,
    });

    await result.current.mutateAsync(makeDesign(ROUTE_EID));

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    const [, body] = apiPut.mock.calls[0] as [string, Design];
    expect(body.experiment_id).toBe(ROUTE_EID);
  });
});
