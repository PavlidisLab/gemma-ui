/**
 * @vitest-environment jsdom
 *
 * Provenance in REMOTE mode.
 *
 * Gemma serves no `provenance` route, so remote runs the store's join
 * in the browser instead: it reads the annotation sets Gemma DOES serve
 * and folds their findings and dispositions onto the refs
 * (`assembleTraces`). Publications are answered off Gemma's own
 * `association` block in either mode.
 *
 * Two regressions this pins, in the order they happened. The panel used
 * to HIDE the control in remote, which hid the half Gemma was holding.
 * Then it offered the control and reported "the curation store … is not
 * served by this backend" — true about the route, wrong about the
 * capability, and it stopped a curator asking a question that had an
 * answer.
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

const reviewCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/api/annotationSetReviews", async (orig) => {
  const actual = await orig<typeof import("@/api/annotationSetReviews")>();
  return {
    ...actual,
    fetchReviewsForExperiment: async () => {
      reviewCalls.n += 1;
      return [
        {
          audit_id: "2564",
          experiment_id: 27103,
          experiment_short_name: "GSE197199",
          kind: "audit",
          audited_at: "2026-09-03T23:40:39.039870+00:00",
          model: "claude-sonnet-5",
          findings: [
            {
              target_id: "tag:cell-type/hepatic-stem-cell",
              target_kind: "tag",
              issue_code: "wrong_value",
              rationale: "The profiled material is a cultured line.",
              severity: "major",
            },
          ],
          dispositions: [
            {
              target_id: "tag:cell-type/hepatic-stem-cell",
              status: "accepted",
              reviewer: "administrator",
              reviewed_at: "2026-09-04T04:00:11.794+00:00",
              notes: "yes, drop it",
            },
          ],
        },
      ] as unknown as Awaited<
        ReturnType<typeof actual.fetchReviewsForExperiment>
      >;
    },
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
    tags: [
      {
        id: 1,
        category: { label: "cell type", uri: "http://www.ebi.ac.uk/efo/EFO_0000324" },
        value: { label: "hepatic stem cell", uri: "http://purl.obolibrary.org/obo/CL_0002195" },
      },
    ],
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
    reviewCalls.n = 0;
    mode.current = "remote";
  });

  it("🛑 offers the control — hiding it hid the half Gemma does serve", () => {
    mount();
    expect(screen.getByRole("button", { name: /Populate provenance/ })).toBeTruthy();
  });

  it("reads Gemma's reviews instead of the doomed store request", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Populate provenance/ }));
    await waitFor(() => expect(reviewCalls.n).toBe(1));
    // Gemma has no provenance route; asking would 404 on every run.
    expect(lookupCalls.n).toBe(0);
  });

  it("🛑 answers the tag AND the paper — 2 with a source, no store excuse", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Populate provenance/ }));
    // The tag comes from the join over Gemma's reviews, the paper from
    // Gemma's own association block. Both halves, one sentence.
    await waitFor(() =>
      expect(screen.getByText(/2 with a source/)).toBeTruthy(),
    );
    expect(screen.queryByText(/curation store/)).toBeNull();
  });

  it("local mode still asks the store", async () => {
    mode.current = "local";
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Populate provenance/ }));
    await waitFor(() => expect(lookupCalls.n).toBe(1));
  });
});
