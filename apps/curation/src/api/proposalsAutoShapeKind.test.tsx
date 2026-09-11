/**
 * @vitest-environment jsdom
 *
 * The proposals sidebar must not show audit output.
 *
 * 🛑 `role` and `kind` are independent axes on an annotation set:
 * `role` is the storage role, `kind` is the audit-vs-proposal split.
 * Measured on gemma2 2026-09-04 (recorded in `proposals.ts`), six of
 * eight `role=proposal` sets are `kind=audit` — so a remote fetch
 * filtered on `role` alone hands back mostly audits, and
 * `SampleDetailsPanel` reads per-cell confidence off the NEWEST set by
 * `ran_at`. Both halves are pinned here: the parameter that filters
 * server-side, and the client-side check that holds when it does not.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
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

const wire = vi.hoisted(() => ({
  urls: [] as string[],
  body: [] as unknown[],
}));
vi.mock("@/api/client", async (orig) => {
  const actual = await orig<typeof import("@/api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: async (url: string) => {
        wire.urls.push(url);
        return wire.body;
      },
    },
  };
});

import { annotationSetsToProposals, useProposalsAutoShape } from "./agentProposals";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** Two sets on one dataset. The audit is the NEWER one — the ordering
 *  that makes this a wrong answer rather than a harmless extra row. */
const AUDIT_SET = {
  id: 9,
  dataset_id: 27438,
  role: "proposal",
  kind: "audit",
  run_id: "audit-run",
  ran_at: "2026-09-04T10:00:00Z",
  payload_json: JSON.stringify({ gse: "GSE27438", findings: [] }),
};

const PROPOSAL_SET = {
  id: 4,
  dataset_id: 27438,
  role: "proposal",
  kind: "proposal",
  run_id: "proposal-run",
  ran_at: "2026-07-21T20:33:46Z",
  payload_json: JSON.stringify({ gse: "GSE27438", proposed_factors: [] }),
};

beforeEach(() => {
  wire.urls.length = 0;
  wire.body = [];
});

describe("annotationSetsToProposals filters on the row's own kind", () => {
  it("🛑 drops a kind=audit set even when its role is proposal", () => {
    const out = annotationSetsToProposals([AUDIT_SET, PROPOSAL_SET]);
    expect(out.map((p) => p.run_id)).toEqual(["proposal-run"]);
  });

  it("keeps a row that carries no kind — absence says nothing", () => {
    // Pre-discriminator rows have no `kind`; dropping them would empty
    // the panel on every dataset curated before the column landed.
    const { kind: _kind, ...noKind } = PROPOSAL_SET;
    expect(annotationSetsToProposals([noKind])).toHaveLength(1);
  });
});

describe("useProposalsAutoShape", () => {
  it("🛑 asks Gemma for kind=proposal, not role alone", async () => {
    mode.current = "remote";
    wire.body = [PROPOSAL_SET];
    const { result } = renderHook(() => useProposalsAutoShape(27438), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(wire.urls[0]).toContain("role=proposal");
    expect(wire.urls[0]).toContain("kind=proposal");
    expect(wire.urls[0]).toContain("shape=full");
  });

  it("🛑 never returns an audit as the newest proposal", async () => {
    // Even if the host serves an unfiltered list, the audit must not
    // reach the panel that reads the newest set.
    mode.current = "remote";
    wire.body = [AUDIT_SET, PROPOSAL_SET];
    const { result } = renderHook(() => useProposalsAutoShape(27438), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data!;
    expect(data.kind).toBe("new");
    expect(data.items).toHaveLength(1);
    expect((data.items[0] as { run_id: string }).run_id).toBe("proposal-run");
  });

  it("local mode still sends kind=proposal to the store", async () => {
    mode.current = "local";
    wire.body = [];
    const { result } = renderHook(() => useProposalsAutoShape(27438), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(wire.urls[0]).toContain("curation-proposals?kind=proposal");
  });
});
