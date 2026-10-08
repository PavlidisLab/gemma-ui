/**
 * ``fetchProposalReviewsForExperiment`` — the merge behind the
 * Proposal-review sidebar.
 *
 * Regression-pins a real, live-reproduced bug: a proposal submitted by
 * the proposer service to the local store (`GEMMA_RECORD_RESULTS`
 * unset / `"store"`, Amanda's setup — proposals get reviewed before
 * anything reaches Gemma) was invisible in the sidebar while the
 * curation-ui ran in remote mode, because the fetch read ONLY Gemma's
 * `/annotation-sets?role=proposal` there — which this experiment never
 * had anything in. Confirmed on GSE247339 / experiment 93632,
 * 2026-10-08: a complete, correctly-submitted proposal (3 factors, 4
 * tags) sat in the local store while the sidebar read "Nothing
 * proposed yet."
 *
 * The fix merges both sources in remote mode rather than picking one —
 * the ORIGINAL reason remote mode read Gemma at all (cab, 2026-09-03,
 * GSE6966: a `GEMMA_RECORD_RESULTS=gemma`/`both` setup writes straight
 * into Gemma, which the local store never sees) is a real, separate
 * case this suite also has to keep working.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuditReport } from "./auditTypes";

const mode = vi.hoisted(() => ({ current: "local" as "remote" | "local" }));
vi.mock("@/lib/gemmaMode", async (orig) => {
  const actual = await orig<typeof import("@/lib/gemmaMode")>();
  return {
    ...actual,
    resolveGemmaMode: () => ({ ...actual.resolveGemmaMode(), mode: mode.current }),
  };
});

const storeResponses = vi.hoisted(() => ({
  queue: [] as Array<{ status: number } | { items: AuditReport[]; total: number }>,
}));
const getCalls = vi.hoisted(() => ({ urls: [] as string[] }));
vi.mock("./client", async (orig) => {
  const actual = await orig<typeof import("./client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: async (url: string) => {
        getCalls.urls.push(url);
        const next = storeResponses.queue.shift();
        if (next && "status" in next) {
          const err = new Error(`HTTP ${next.status}`) as Error & { status: number };
          err.status = next.status;
          throw err;
        }
        return next ?? { items: [], total: 0 };
      },
    },
  };
});

// `annotationSetsToReviews`'s own correctness (envelope shapes, kind
// filtering) is covered by proposalsFromAnnotationSets.test.ts / the
// AnnotationSetRow suite — stub it here so this file only tests the
// merge/branching logic, not that transform a second time.
const gemmaItemsToReturn = vi.hoisted(() => ({ items: [] as AuditReport[] }));
vi.mock("./annotationSetReviews", async (orig) => {
  const actual = await orig<typeof import("./annotationSetReviews")>();
  return {
    ...actual,
    annotationSetsToReviews: () => ({
      items: gemmaItemsToReturn.items,
      total: gemmaItemsToReturn.items.length,
    }),
  };
});

const { fetchProposalReviewsForExperiment } = await import("./reviewProposals");

function report(over: Partial<AuditReport> & { audit_id: string; audited_at: string }): AuditReport {
  return {
    experiment_id: 93632,
    experiment_short_name: "GSE247339",
    model: "claude-sonnet-5",
    scope: { include: [] },
    findings: [],
    evidence: {} as AuditReport["evidence"],
    summary: { overall_verdict: "ok", n_blocker: 0, n_major: 0, n_minor: 0, n_ok: 0 },
    dispositions: [],
    ...over,
  };
}

afterEach(() => {
  mode.current = "local";
  storeResponses.queue = [];
  getCalls.urls = [];
  gemmaItemsToReturn.items = [];
});

describe("local mode", () => {
  it("reads only the local store, never calls Gemma", async () => {
    const storeItem = report({ audit_id: "store-1", audited_at: "2026-10-08T21:00:00Z" });
    storeResponses.queue = [{ items: [storeItem], total: 1 }];

    const result = await fetchProposalReviewsForExperiment(93632);

    expect(result.items).toEqual([storeItem]);
    expect(getCalls.urls).toEqual(["/curation/v1/datasets/93632/proposals"]);
  });

  it("treats a 404 from the store as no proposals, not an error", async () => {
    storeResponses.queue = [{ status: 404 }];
    const result = await fetchProposalReviewsForExperiment(93632);
    expect(result).toEqual({ items: [], total: 0 });
  });

  it("does NOT swallow a non-404 failure (403 is a real auth error, not 'empty')", async () => {
    storeResponses.queue = [{ status: 403 }];
    await expect(fetchProposalReviewsForExperiment(93632)).rejects.toThrow();
  });
});

describe("remote mode — the real bug, and the case it must not re-break", () => {
  it("🛑 surfaces a store-only proposal (Amanda's setup, GSE247339) — the bug this file pins", async () => {
    mode.current = "remote";
    const storeItem = report({ audit_id: "store-1", audited_at: "2026-10-08T21:09:28Z" });
    storeResponses.queue = [{ items: [storeItem], total: 1 }]; // store call
    gemmaItemsToReturn.items = []; // Gemma genuinely has nothing

    const result = await fetchProposalReviewsForExperiment(93632);

    expect(result.items).toContainEqual(storeItem);
    expect(result.total).toBe(1);
  });

  it("still surfaces a Gemma-only proposal (cab's 2026-09-03 case, GSE6966) — the branch this replaces used to exist for exactly this", async () => {
    mode.current = "remote";
    storeResponses.queue = [{ items: [], total: 0 }]; // store has nothing
    const gemmaItem = report({ audit_id: "gemma-1", audited_at: "2026-09-03T12:00:00Z" });
    gemmaItemsToReturn.items = [gemmaItem];

    const result = await fetchProposalReviewsForExperiment(93632);

    expect(result.items).toContainEqual(gemmaItem);
    expect(result.total).toBe(1);
  });

  it("merges both when both have rows, newest first", async () => {
    mode.current = "remote";
    const older = report({ audit_id: "store-old", audited_at: "2026-09-01T00:00:00Z" });
    const newer = report({ audit_id: "gemma-new", audited_at: "2026-10-08T00:00:00Z" });
    storeResponses.queue = [{ items: [older], total: 1 }];
    gemmaItemsToReturn.items = [newer];

    const result = await fetchProposalReviewsForExperiment(93632);

    expect(result.total).toBe(2);
    expect(result.items.map((r) => r.audit_id)).toEqual(["gemma-new", "store-old"]);
  });

  it("still calls the store even in remote mode (this is the one-line regression: it used to skip it entirely)", async () => {
    mode.current = "remote";
    storeResponses.queue = [{ items: [], total: 0 }];
    await fetchProposalReviewsForExperiment(93632);
    expect(getCalls.urls).toContain("/curation/v1/datasets/93632/proposals");
  });

  it("a 404 from Gemma's side alone doesn't hide a real store proposal", async () => {
    mode.current = "remote";
    const storeItem = report({ audit_id: "store-1", audited_at: "2026-10-08T21:09:28Z" });
    storeResponses.queue = [{ items: [storeItem], total: 1 }, { status: 404 }];

    const result = await fetchProposalReviewsForExperiment(93632);
    expect(result.items).toEqual([storeItem]);
  });
});
