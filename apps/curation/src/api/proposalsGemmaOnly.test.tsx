/**
 * @vitest-environment jsdom
 *
 * A proposal that exists ONLY in Gemma (no store row) must reach the
 * three readers that used to ask the store route in every mode:
 * `useProposalsForExperiment`, the design overlay and the
 * agent-proposal availability probe. One source per mode, no merge.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";

const mode = vi.hoisted(() => ({ current: "remote" as "remote" | "local" }));
vi.mock("@/lib/gemmaMode", async (orig) => {
  const actual = await orig<typeof import("@/lib/gemmaMode")>();
  return {
    ...actual,
    resolveGemmaMode: () => ({ ...actual.resolveGemmaMode(), mode: mode.current }),
    useGemmaMode: () => ({ ...actual.resolveGemmaMode(), mode: mode.current }),
  };
});

const wire = vi.hoisted(() => ({ urls: [] as string[], gemma: [] as unknown[] }));
vi.mock("@/api/client", async (orig) => {
  const actual = await orig<typeof import("@/api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: async (url: string) => {
        wire.urls.push(url);
        if (url.includes("/curation/v1/")) return { items: [], total: 0 };
        return wire.gemma;
      },
    },
  };
});

import { fetchProposalRows } from "./agentProposals";
import { useProposalsForExperiment } from "./proposals";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const mkSet = (id: number, ranAt: string, status = "pending", kind = "proposal") => ({
  id,
  dataset_id: 93632,
  role: "proposal",
  kind,
  status,
  ran_at: ranAt,
  payload_json: JSON.stringify({
    experiment_id: 93632,
    tags: [],
    factors: [],
    evidence: { paper_excerpt: `excerpt ${id}`, paper_source: "PMID:1" },
  }),
});

beforeEach(() => {
  mode.current = "remote";
  wire.urls = [];
  wire.gemma = [
    mkSet(1, "2026-10-01T00:00:00Z"),
    mkSet(3, "2026-10-03T00:00:00Z"),
    mkSet(2, "2026-10-02T00:00:00Z", "pending", "audit"),
  ];
});

describe("Gemma-only proposals, remote mode", () => {
  it("fetchProposalRows reads Gemma only, newest first, audits dropped", async () => {
    const rows = await fetchProposalRows(93632);
    expect(rows.map((r) => r.id)).toEqual([3, 1]);
    expect(wire.urls).toHaveLength(1);
    expect(wire.urls[0]).toContain("/rest/v2/datasets/93632/annotation-sets");
    expect(wire.urls[0]).not.toContain("kind=");
  });

  it("useProposalsForExperiment returns the Gemma set and never asks the store", async () => {
    const { result } = renderHook(() => useProposalsForExperiment(93632, "pending"), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const items = result.current.data!.items;
    expect(items.map((p) => p.proposal_id)).toEqual(["3", "1"]);
    expect(items.find((p) => p.proposal_id === "3")?.evidence.paper_excerpt).toBe("excerpt 3");
    expect(wire.urls.some((u) => u.includes("/curation/v1/"))).toBe(false);
  });

  it("reads a review-wrapped set (evidence.comparison_proposal) as the raw proposal", async () => {
    const inner = { experiment_id: 93632, tags: [], factors: [], evidence: { paper_excerpt: "wrapped" } };
    wire.gemma = [
      {
        ...mkSet(7, "2026-10-07T00:00:00Z"),
        payload_json: JSON.stringify({
          kind: "proposal",
          findings: [],
          evidence: { comparison_proposal: inner },
        }),
      },
    ];
    const { result } = renderHook(() => useProposalsForExperiment(93632), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.items[0].evidence.paper_excerpt).toBe("wrapped");
  });

  it("camelCase payload keys come out snake_case", async () => {
    wire.gemma = [
      {
        ...mkSet(8, "2026-10-08T00:00:00Z"),
        payload_json: JSON.stringify({ experimentId: 93632, factors: [{ factorValues: [{ isBaseline: true }] }] }),
      },
    ];
    const rows = await fetchProposalRows(93632);
    expect(JSON.parse(rows[0].payload_json as string).factors[0].factor_values[0].is_baseline).toBe(true);
  });

  it("a finalized set is not pending even though its status still says so", async () => {
    wire.gemma = [
      { ...mkSet(9, "2026-10-09T00:00:00Z"), finalized_at: "2026-10-09T01:11:25Z" },
      mkSet(10, "2026-10-08T00:00:00Z"),
    ];
    const { result } = renderHook(() => useProposalsForExperiment(93632, "pending"), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.items.map((p) => p.proposal_id)).toEqual(["10"]);
  });

  it("status filter applies to the set's status", async () => {
    wire.gemma = [mkSet(5, "2026-10-05T00:00:00Z", "accepted")];
    const { result } = renderHook(() => useProposalsForExperiment(93632, "pending"), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.items).toEqual([]);
  });

  it("local mode still reads the store route and not Gemma", async () => {
    mode.current = "local";
    await fetchProposalRows(93632);
    expect(wire.urls[0]).toContain("/curation/v1/datasets/93632/curation-proposals");
    expect(wire.urls.some((u) => u.includes("/rest/v2/"))).toBe(false);
  });
});
