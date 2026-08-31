/**
 * @vitest-environment jsdom
 *
 * Provenance in REMOTE mode.
 *
 * Gemma serves no `provenance` route — verified against the live
 * OpenAPI on gemma2 2026-08-31 — so the store-backed half of a run has
 * no answer there. The publication half does: Gemma ships the
 * `association` block on `/datasets/{id}/publications` and
 * `publicationTraces` converts it from the page.
 *
 * The panel used to hide the control entirely in remote mode, which
 * hid the half Gemma was holding.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mode = vi.hoisted(() => ({ current: "remote" as "remote" | "local" }));
vi.mock("@/lib/gemmaMode", async (orig) => {
  const actual = await orig<typeof import("@/lib/gemmaMode")>();
  return {
    ...actual,
    useGemmaMode: () => ({ ...actual.resolveGemmaMode(), mode: mode.current }),
    resolveGemmaMode: () => ({ ...actual.resolveGemmaMode(), mode: mode.current }),
  };
});

const lookupCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/api/provenance", async (orig) => {
  const actual = await orig<typeof import("@/api/provenance")>();
  return {
    ...actual,
    useProvenanceLookup: () => ({
      mutate: () => {
        lookupCalls.n += 1;
      },
    }),
  };
});

const draft = vi.hoisted(() => ({
  current: {
    factors: [],
    tags: [],
    samples: [],
    publications: [
      {
        pubmed_id: "36395955",
        doi: "",
        citation: "",
        title: "Neil3 paper",
        association: {
          status: "accepted",
          role: "primary",
          source: "geo_submitter_link",
          evidence:
            "Checked against GEO on 2026-08-19: GSE197199 lists !Series_pubmed_id 36395955 as its first (primary) publication.",
          evidence_code: "TAS",
          asserted_by: "administrator",
          asserted_at: "2026-08-19T00:46:52.382+00:00",
        },
      },
    ],
  } as unknown,
}));
vi.mock("@/features/design/DesignDraftContext", async (orig) => {
  const actual = await orig<
    typeof import("@/features/design/DesignDraftContext")
  >();
  return { ...actual, useDesignDraft: () => ({ draft: draft.current }) };
});

import { ProvenancePanel } from "./ProvenancePanel";
import { ProvenanceProvider } from "./ProvenanceContext";

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ProvenanceProvider>
        <ProvenancePanel experimentId={27103} />
      </ProvenanceProvider>
    </QueryClientProvider>,
  );
}

describe("provenance in remote mode", () => {
  beforeEach(() => {
    cleanup();
    lookupCalls.n = 0;
    mode.current = "remote";
  });

  it("🛑 offers the control — hiding it hid the half Gemma does serve", () => {
    mount();
    expect(screen.getByRole("button", { name: /Populate provenance/ })).toBeTruthy();
  });

  it("does not fire the doomed store request", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Populate provenance/ }));
    await waitFor(() =>
      expect(screen.getByText(/curation store/)).toBeTruthy(),
    );
    // Gemma has no such route; asking would 404 on every run.
    expect(lookupCalls.n).toBe(0);
  });

  it("still resolves the publication's provenance from Gemma's own block", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Populate provenance/ }));
    // "1 with a source" — the derived half survived, and the sentence
    // says which half did not.
    await waitFor(() =>
      expect(screen.getByText(/1 with a source/)).toBeTruthy(),
    );
    expect(screen.getByText(/curation store/)).toBeTruthy();
  });

  it("local mode still asks the store", async () => {
    mode.current = "local";
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Populate provenance/ }));
    await waitFor(() => expect(lookupCalls.n).toBe(1));
  });
});
