/**
 * Reading curation REVIEWS out of Gemma instead of the local store.
 *
 * Paul, 2026-09-03: *"we're going to use gemma remote for everything,
 * so we need full capabilities … 'remote' means all remote!"*
 *
 * The envelope shapes here are verbatim from gemma2 — set 2563 on
 * dataset 2706 (`curation-audit`, `kind=audit`, 4,033 bytes of
 * `payloadJson`), fetched before these were written. Envelope keys are
 * snake_case because `client.ts` snakeifies every response at the
 * boundary; `payloadJson` is a JSON STRING and escapes that boundary,
 * which is why the adapter snakeifies again after parsing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  annotationSetToReview,
  annotationSetsToReviews,
  asAnnotationSetRows,
  isReviewPayload,
  parseReviewPayload,
  reviewsPath,
} from "./annotationSetReviews";

/** Set 2563's envelope, as it arrives post-snakeify. */
const SET_2563 = {
  id: 2563,
  dataset_id: 2706,
  role: "proposal",
  kind: "audit",
  source: "agent",
  run_id: "2026-09-03_silence50_v2",
  created_by: null,
  created_at: "2026-09-04T01:15:33.900+00:00",
  finalized_at: null,
  finalized_by: null,
  agent_version: null,
  model: "claude-sonnet-5",
  agent_name: "curation-audit",
  ran_at: "2026-09-04T01:15:33.000+00:00",
};

/** A review payload — what the finding cards render. */
function reviewPayload(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    experiment_id: 2706,
    experiment_short_name: "GSE6966",
    audited_at: "2026-09-03T00:00:00Z",
    findings: [
      { target_id: "tag:5", severity: "major", issue_code: "wrong_value" },
    ],
    summary: { n_blocker: 0, n_major: 1, overall_verdict: "major_issues" },
    dispositions: [],
    ...extra,
  });
}

describe("reviewsPath", () => {
  it("asks Gemma for the full payload in remote mode", () => {
    expect(reviewsPath(2706, true, "audits")).toBe(
      "/rest/v2/datasets/2706/annotation-sets?role=proposal&shape=full",
    );
  });

  it("keeps the store path in local mode, per surface", () => {
    expect(reviewsPath(2706, false, "audits")).toBe(
      "/curation/v1/datasets/2706/audits",
    );
    expect(reviewsPath(2706, false, "proposals")).toBe(
      "/curation/v1/datasets/2706/proposals",
    );
  });
});

describe("annotationSetsToReviews", () => {
  it("adapts a review-shaped set and addresses it by the SET id", () => {
    const { items, total } = annotationSetsToReviews(
      [{ ...SET_2563, payload_json: reviewPayload({ audit_id: "store-99" }) }],
      "audit",
    );
    expect(total).toBe(1);
    // The write routes (`/annotation-sets/{id}/finalize`) take the
    // set's id — a producer-side `audit_id` would address the store.
    expect(items[0].audit_id).toBe("2563");
    expect(items[0].experiment_id).toBe(2706);
    expect(items[0].kind).toBe("audit");
    expect(items[0].findings).toHaveLength(1);
  });

  it("splits audit from proposal on `kind`, not on the path", () => {
    const rows = [
      { ...SET_2563, id: 1, kind: "audit", payload_json: reviewPayload() },
      { ...SET_2563, id: 2, kind: "proposal", payload_json: reviewPayload() },
    ];
    expect(annotationSetsToReviews(rows, "audit").items.map((r) => r.audit_id))
      .toEqual(["1"]);
    expect(
      annotationSetsToReviews(rows, "proposal").items.map((r) => r.audit_id),
    ).toEqual(["2"]);
  });

  it("reads a set with no `kind` as an audit", () => {
    const rows = [{ ...SET_2563, kind: null, payload_json: reviewPayload() }];
    expect(annotationSetsToReviews(rows, "audit").total).toBe(1);
    expect(annotationSetsToReviews(rows, "proposal").total).toBe(0);
  });

  it("normalizes a camelCase payload — the JSON string escapes snakeify", () => {
    const camel = JSON.stringify({
      experimentShortName: "GSE6966",
      auditedAt: "2026-09-03T00:00:00Z",
      findings: [{ targetId: "tag:5", issueCode: "wrong_value" }],
    });
    const { items } = annotationSetsToReviews(
      [{ ...SET_2563, payload_json: camel }],
      "audit",
    );
    expect(items[0].experiment_short_name).toBe("GSE6966");
    expect(items[0].audited_at).toBe("2026-09-03T00:00:00Z");
    expect(items[0].findings[0].target_id).toBe("tag:5");
  });

  it("drops an agent-proposal payload rather than inventing findings", () => {
    // Set 2563's real payload: root-level tags / proposed_factors /
    // experiment_summary, no `findings` array. It has its own reader
    // (`parseAgentProposalPayload`); manufacturing findings out of it
    // here would invent structure the producer never sent.
    const agentShape = JSON.stringify({
      gse: "GSE6966",
      tags: [{ category: "developmental stage", value: "embryo stage" }],
      n_proposed: 0,
      proposed_factors: [],
      experiment_summary: "…",
      audit_proposal: { finding: { target_id: "tag:x" } },
    });
    const { items, total } = annotationSetsToReviews(
      [{ ...SET_2563, payload_json: agentShape }],
      "audit",
    );
    expect(total).toBe(0);
    expect(items).toEqual([]);
  });

  it("drops a set with no payload (shape=meta) and one that won't parse", () => {
    expect(
      annotationSetsToReviews(
        [
          { ...SET_2563, id: 1, payload_json: null },
          { ...SET_2563, id: 2, payload_json: "{not json" },
        ],
        "audit",
      ).total,
    ).toBe(0);
  });

  it("returns nothing for a non-array body", () => {
    expect(annotationSetsToReviews(null, "audit")).toEqual({
      items: [],
      total: 0,
    });
  });
});

describe("asAnnotationSetRows", () => {
  // The two Gemma routes answer with different envelopes, measured on
  // gemma2 2026-09-03: the per-dataset list is a bare array, the
  // cross-experiment list is paginated and `client.ts` leaves it whole.
  it("takes the bare array the per-dataset route answers with", () => {
    expect(asAnnotationSetRows([{ id: 1 }])).toEqual([{ id: 1 }]);
  });

  it("unwraps the paginated envelope the cross-experiment route answers with", () => {
    const paginated = {
      data: [{ id: 2563 }],
      groupBy: null,
      sort: "-createdAt",
      offset: 0,
      limit: 100,
      totalElements: 2495,
    };
    expect(asAnnotationSetRows(paginated)).toEqual([{ id: 2563 }]);
  });

  it("reads a review list out of the paginated envelope too", () => {
    const rows = annotationSetsToReviews(
      { data: [{ ...SET_2563, payload_json: reviewPayload() }], totalElements: 1 },
      "audit",
    );
    expect(rows.total).toBe(1);
  });

  it("is empty, not throwing, for anything else", () => {
    expect(asAnnotationSetRows(null)).toEqual([]);
    expect(asAnnotationSetRows({ detail: "Not Found" })).toEqual([]);
  });
});

describe("annotationSetToReview", () => {
  it("lets the ENVELOPE win for the finalize state Gemma owns", () => {
    const row = {
      ...SET_2563,
      finalized_at: "2026-09-04T12:00:00Z",
      finalized_by: "paul",
      payload_json: reviewPayload({
        finalized_at: null,
        finalized_by: null,
      }),
    };
    const payload = parseReviewPayload(row)!;
    const report = annotationSetToReview(row, payload);
    expect(report.finalized_at).toBe("2026-09-04T12:00:00Z");
    expect(report.finalized_by).toBe("paul");
  });

  it("falls back to the envelope's run stamps when the payload is silent", () => {
    const row = { ...SET_2563, payload_json: JSON.stringify({ findings: [] }) };
    const report = annotationSetToReview(row, parseReviewPayload(row)!);
    expect(report.model).toBe("claude-sonnet-5");
    expect(report.audited_at).toBe("2026-09-04T01:15:33.000+00:00");
    expect(report.experiment_id).toBe(2706);
  });
});

describe("isReviewPayload", () => {
  it("keys on `findings`, the array every card iterates", () => {
    expect(isReviewPayload({ findings: [] })).toBe(true);
    expect(isReviewPayload({ tags: [], proposed_factors: [] })).toBe(false);
  });
});

describe("fetchReviewsForExperiment", () => {
  const CALLS: string[] = [];

  beforeEach(() => {
    CALLS.length = 0;
    vi.resetModules();
  });

  /** Load the module under a chosen mode, with `api.get` recording the
   *  paths it was asked for. */
  async function load(mode: "local" | "remote", answer: (p: string) => unknown) {
    vi.doMock("./client", async () => {
      const actual = await vi.importActual<typeof import("./client")>("./client");
      return {
        ...actual,
        api: {
          ...actual.api,
          get: async (path: string) => {
            CALLS.push(path);
            return answer(path);
          },
        },
      };
    });
    vi.doMock("@/lib/gemmaMode", () => ({
      resolveGemmaMode: () => ({ mode }),
    }));
    return import("./annotationSetReviews");
  }

  it("asks Gemma ONCE in remote mode and splits both kinds out of it", async () => {
    const { fetchReviewsForExperiment } = await load("remote", () => [
      {
        ...SET_2563,
        id: 10,
        kind: "audit",
        payload_json: reviewPayload({ audited_at: "2026-09-01T00:00:00Z" }),
      },
      {
        ...SET_2563,
        id: 11,
        kind: "proposal",
        payload_json: reviewPayload({ audited_at: "2026-09-03T00:00:00Z" }),
      },
    ]);
    const all = await fetchReviewsForExperiment(2706);
    // One round trip, not two: both kinds live behind the one route.
    expect(CALLS).toEqual([
      "/rest/v2/datasets/2706/annotation-sets?role=proposal&shape=full",
    ]);
    // Newest first across the merge, not within each kind.
    expect(all.map((r) => r.audit_id)).toEqual(["11", "10"]);
  });

  it("keeps the two store calls in local mode", async () => {
    const { fetchReviewsForExperiment } = await load("local", (p) => ({
      items: [
        {
          audit_id: p.endsWith("audits") ? "a1" : "p1",
          audited_at: p.endsWith("audits")
            ? "2026-09-01T00:00:00Z"
            : "2026-09-02T00:00:00Z",
          findings: [],
        },
      ],
    }));
    const all = await fetchReviewsForExperiment(2706);
    expect(CALLS.sort()).toEqual([
      "/curation/v1/datasets/2706/audits",
      "/curation/v1/datasets/2706/proposals",
    ]);
    expect(all.map((r) => r.audit_id)).toEqual(["p1", "a1"]);
  });

  it("reads a 404 as no reviews, and lets anything else through", async () => {
    const { fetchReviewsForExperiment } = await load("remote", () => {
      throw Object.assign(new Error("nope"), { status: 404 });
    });
    expect(await fetchReviewsForExperiment(2706)).toEqual([]);

    vi.resetModules();
    const mod = await load("remote", () => {
      // 🛑 403 is an authorization failure, never "no reviews" — the
      // annotation-sets route answers it to a session without
      // GROUP_CURATOR / GROUP_ADMIN / GROUP_AGENT.
      throw Object.assign(new Error("forbidden"), { status: 403 });
    });
    await expect(mod.fetchReviewsForExperiment(2706)).rejects.toThrow(
      "forbidden",
    );
  });
});
