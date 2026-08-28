/**
 * @vitest-environment jsdom
 *
 * The whole-design PUT must not reach a real Gemma.
 *
 * `useUpdateDesign` sends `PUT /rest/v2/datasets/{id}/design`. In local
 * mode that lands on the curation store; in remote mode `/rest` is
 * Gemma, so the same call is a write to production — and
 * `require_gemma_write_base`, which guards the agent's writes, cannot
 * see it, because it never reaches the agent.
 *
 * The gate lives on the mutation rather than only on the button so a
 * second caller cannot be added without meeting it. What this asserts
 * is therefore not "an error is shown" but **that nothing goes on the
 * wire**: `fetch` is stubbed and must never be called.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/gemmaMode", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/gemmaMode")>("@/lib/gemmaMode");
  return { ...actual, useGemmaMode: vi.fn() };
});

import { resolveGemmaMode, useGemmaMode } from "@/lib/gemmaMode";
import { REMOTE_DESIGN_SAVE_REFUSED, useUpdateDesign } from "./design";
import type { Design } from "@/features/experiment/types";

const DESIGN = {
  experiment_id: 9,
  factors: [],
  tags: [],
} as unknown as Design;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(useGemmaMode).mockReset();
});

/** Drive the gate through the REAL resolver, so a change to what counts
 *  as remote shows up here rather than in a hand-set flag. */
function setMode(mode: "local" | "remote") {
  vi.mocked(useGemmaMode).mockReturnValue(
    resolveGemmaMode(
      mode === "remote"
        ? { mode: "remote", gemmaBaseUrl: "https://gemma2.msl.ubc.ca" }
        : { mode: "local" },
    ),
  );
}

/** Stub fetch so any request at all is a visible failure. */
function stubFetch() {
  const spy = vi.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(DESIGN), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function renderUpdater() {
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return renderHook(() => useUpdateDesign(9), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  });
}

describe("useUpdateDesign in remote mode", () => {
  it("🛑 puts NOTHING on the wire", async () => {
    setMode("remote");
    const spy = stubFetch();
    const { result } = renderUpdater();
    await expect(result.current.mutateAsync(DESIGN)).rejects.toThrow(
      /remote mode/i,
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses with a message that says what to do", async () => {
    setMode("remote");
    stubFetch();
    const { result } = renderUpdater();
    await expect(result.current.mutateAsync(DESIGN)).rejects.toThrow(
      REMOTE_DESIGN_SAVE_REFUSED,
    );
  });
});

describe("useUpdateDesign in local mode", () => {
  it("still writes — the gate is remote-only", async () => {
    setMode("local");
    const spy = stubFetch();
    const { result } = renderUpdater();
    await result.current.mutateAsync(DESIGN);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(String(spy.mock.calls[0][0])).toContain(
      "/rest/v2/datasets/9/design",
    );
    expect(spy.mock.calls[0][1]?.method).toBe("PUT");
  });
});
