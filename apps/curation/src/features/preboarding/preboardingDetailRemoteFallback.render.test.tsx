/**
 * @vitest-environment jsdom
 *
 * Real Gemma has no `preboarding:N`-id-aware `/datasets/{id}` route —
 * that convention only exists in local_api's mock backend. Against real
 * Gemma, `GET /rest/v2/datasets/preboarding%3AN` is a SEARCH call, not a
 * lookup: the id string becomes a `shortName` filter, matches nothing,
 * and returns an empty list (confirmed live, 2026-09-04) — no error,
 * just every field on this page rendering blank.
 *
 * The fix: in remote mode, fetch `GET /rest/v2/preboarded/{numeric id}`
 * instead — the same real endpoint `TriageRow`'s fallback already uses
 * (see triageRealTicketFallback.render.test.tsx) — and map its response
 * into the same `PreboardingRow` shape this page already renders.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/tickets", () => ({
  useTicket: () => ({ data: null }),
  usePatchTicketTarget: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

vi.mock("@/lib/gemmaMode", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/gemmaMode")>("@/lib/gemmaMode");
  return { ...actual, useGemmaMode: vi.fn() };
});

const getMock = vi.fn();
// Mock `api.get` only, same reason as triageRealTicketFallback's own test:
// the identifying_metadata blob is a JSON string that never passes through
// snakeify, so a wholesale module mock would silently make key-casing bugs
// in the real mapper invisible.
vi.mock("@/api/client", async (orig) => ({
  ...(await orig<typeof import("@/api/client")>()),
  api: { get: (...args: unknown[]) => getMock(...args) },
}));

import { useGemmaMode } from "@/lib/gemmaMode";
import { PreboardingDetailPage } from "./PreboardingDetailPage";

function open(experimentId = "preboarding:16429") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PreboardingDetailPage experimentId={experimentId} embedded />
    </QueryClientProvider>,
  );
}

describe("PreboardingDetailPage against a real Gemma preboarded row", () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockResolvedValue({
      accession: "GSE141040",
      source: "GEO",
      // Verbatim shape from a real /preboarded/{id} response: Gemma
      // writes camelCase into this JSON string and never parses it.
      identifying_metadata: JSON.stringify({
        title: "Comparative analysis of CreER transgenic mice",
        numSamples: 32,
        seriesType: "Expression profiling by high throughput sequencing",
      }),
    });
  });
  afterEach(() => vi.mocked(useGemmaMode).mockReset());

  it("fetches /preboarded/{numeric id} in remote mode, not /datasets/{prefixed id}", async () => {
    vi.mocked(useGemmaMode).mockReturnValue({ mode: "remote" } as ReturnType<
      typeof useGemmaMode
    >);
    open();
    await screen.findByText("Comparative analysis of CreER transgenic mice");
    expect(getMock).toHaveBeenCalledWith("/rest/v2/preboarded/16429");
    expect(getMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/datasets/"),
    );
  });

  it("renders the title from the real row instead of blank", async () => {
    vi.mocked(useGemmaMode).mockReturnValue({ mode: "remote" } as ReturnType<
      typeof useGemmaMode
    >);
    open();
    expect(
      await screen.findByText("Comparative analysis of CreER transgenic mice"),
    ).toBeTruthy();
  });

  it("renders the accession from the real row", async () => {
    vi.mocked(useGemmaMode).mockReturnValue({ mode: "remote" } as ReturnType<
      typeof useGemmaMode
    >);
    open();
    await screen.findByText("Comparative analysis of CreER transgenic mice");
    // Rendered twice (the accession header + the grid's own Accession
    // field) -- both must show the real value, not a blank/placeholder.
    expect(screen.getAllByText("GSE141040").length).toBeGreaterThan(0);
  });

  it("derives the sample count from identifying_metadata.numSamples", async () => {
    vi.mocked(useGemmaMode).mockReturnValue({ mode: "remote" } as ReturnType<
      typeof useGemmaMode
    >);
    open();
    await screen.findByText("Comparative analysis of CreER transgenic mice");
    expect(screen.getByText("32")).toBeTruthy();
  });

  it("does not call the remote fallback in local mode", () => {
    vi.mocked(useGemmaMode).mockReturnValue({ mode: "local" } as ReturnType<
      typeof useGemmaMode
    >);
    open();
    expect(getMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/preboarded/"),
    );
  });

  it("still calls /datasets/{id} in local mode, unchanged", () => {
    vi.mocked(useGemmaMode).mockReturnValue({ mode: "local" } as ReturnType<
      typeof useGemmaMode
    >);
    open();
    expect(getMock).toHaveBeenCalledWith(
      expect.stringContaining("/rest/v2/datasets/"),
    );
  });
});
