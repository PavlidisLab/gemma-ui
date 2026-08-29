/**
 * @vitest-environment jsdom
 *
 * Tests for the chip-strip source fetch + compose layer.
 *
 * The interesting logic is private to the module — ``fetchSourceDesign``
 * routes a `Source` token to an endpoint, and ``applyAgentProposalToDesign``
 * folds a packaged proposal onto the preboard to synthesise the
 * "agent accepted wholesale" Design. Rather than export them, these
 * drive the real hooks against a mocked api client, so the routing and
 * the compose run for real.
 *
 * What matters and is pinned here:
 *   - Every fetch failure degrades to ``null`` (a chip slot that can't
 *     load must read as "no diff", never throw into the strip).
 *   - The agent_proposal compose uses NEGATIVE synthetic ids so folded
 *     items can't collide with Gemma-assigned preboard ids.
 *   - The compose does not mutate the preboard it was handed — the same
 *     preboard object is shared with the other chip slot via the query
 *     cache.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createElement } from "react";
import type { Design } from "@/features/experiment/types";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
}));
vi.mock("@/api/design", () => ({
  fetchPreboardSnapshot: vi.fn(),
}));

import { api } from "@/api/client";
import { fetchPreboardSnapshot } from "@/api/design";
import {
  useCalibrationAuditReport,
  useChipDesignPair,
  useChipDiffSummary,
} from "./useChipDiff";

const apiGet = api.get as ReturnType<typeof vi.fn>;
const preboardMock = fetchPreboardSnapshot as ReturnType<typeof vi.fn>;

const EID = 91654;

function makeDesign(overrides: Partial<Design> = {}): Design {
  return {
    experiment_id: EID,
    experiment_short_name: "GSE_TEST",
    factors: [],
    biomaterials: [],
    tags: [],
    ...overrides,
  } as Design;
}

/** Fresh QueryClient per render so one test's cache can't answer the
 *  next test's query (the hook keys on [eid, source], which repeats). */
function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Source routing
// ---------------------------------------------------------------------------
describe("useChipDesignPair — source routing", () => {
  it("never fetches for the ``empty`` source and reports it as null", async () => {
    preboardMock.mockResolvedValue(makeDesign());

    const { result } = renderHook(
      () => useChipDesignPair(EID, "preboard", "empty"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.baseline).not.toBeNull());
    expect(result.current.comparator).toBeNull();
    // The disabled slot must not have issued a request.
    expect(apiGet).not.toHaveBeenCalled();
  });

  it("routes ``preboard`` to the preboard snapshot", async () => {
    preboardMock.mockResolvedValue(makeDesign({ experiment_short_name: "PRE" }));

    const { result } = renderHook(
      () => useChipDesignPair(EID, "preboard", "empty"),
      { wrapper },
    );

    await waitFor(() =>
      expect(result.current.baseline?.experiment_short_name).toBe("PRE"),
    );
    expect(preboardMock).toHaveBeenCalledWith(EID);
  });

  it("routes ``polished:<curator>`` to that curator's polished row", async () => {
    apiGet.mockResolvedValue(makeDesign({ experiment_short_name: "POLISHED" }));

    const { result } = renderHook(
      () => useChipDesignPair(EID, "polished:curator-b", "empty"),
      { wrapper },
    );

    await waitFor(() =>
      expect(result.current.baseline?.experiment_short_name).toBe("POLISHED"),
    );
    expect(apiGet).toHaveBeenCalledWith(
      `/curation/v1/datasets/${EID}/polished/curator-b`,
    );
  });

  it("carries a curator name containing a colon through intact", async () => {
    // polishedCuratorOf slices off only the first "polished:" segment.
    apiGet.mockResolvedValue(makeDesign());

    renderHook(() => useChipDesignPair(EID, "polished:consensus_a:b", "empty"), {
      wrapper,
    });

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(apiGet).toHaveBeenCalledWith(
      `/curation/v1/datasets/${EID}/polished/consensus_a:b`,
    );
  });

  it("resolves an unrecognised source to null without fetching", async () => {
    const { result } = renderHook(
      () => useChipDesignPair(EID, "some-opaque-curation-id", "empty"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.baseline).toBeNull();
    expect(apiGet).not.toHaveBeenCalled();
    expect(preboardMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Fetch failures degrade to null
// ---------------------------------------------------------------------------
describe("useChipDesignPair — a slot that cannot load reads as null", () => {
  it("returns null when the preboard fetch throws", async () => {
    preboardMock.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(
      () => useChipDesignPair(EID, "preboard", "empty"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.baseline).toBeNull();
  });

  it("returns null when the polished fetch 404s", async () => {
    apiGet.mockRejectedValue(new Error("404"));

    const { result } = renderHook(
      () => useChipDesignPair(EID, "polished:nobody", "empty"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.baseline).toBeNull();
  });

  it("returns null for agent_proposal when the preboard is unavailable", async () => {
    // No preboard means there is nothing to fold the proposal onto.
    preboardMock.mockRejectedValue(new Error("no preboard"));
    apiGet.mockResolvedValue({ items: [] });

    const { result } = renderHook(
      () => useChipDesignPair(EID, "preboard", "agent_proposal"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.comparator).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// agent_proposal compose
// ---------------------------------------------------------------------------

/** Wire a preboard + a packaged proposal, then read the composed
 *  agent_proposal slot. */
async function composeAgentProposal(
  preboard: Design,
  proposalRows: unknown,
): Promise<Design | null> {
  preboardMock.mockResolvedValue(preboard);
  apiGet.mockResolvedValue(proposalRows);
  const { result } = renderHook(
    () => useChipDesignPair(EID, "empty", "agent_proposal"),
    { wrapper },
  );
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  return result.current.comparator;
}

function rowsWith(proposal: unknown) {
  return { items: [{ evidence: { comparison_proposal: proposal } }] };
}

describe("agent_proposal compose", () => {
  it("returns the bare preboard when no proposal row exists", async () => {
    const out = await composeAgentProposal(
      makeDesign({ experiment_short_name: "PRE" }),
      { items: [] },
    );

    expect(out?.experiment_short_name).toBe("PRE");
    expect(out?.tags).toEqual([]);
  });

  it("returns the bare preboard when the row carries no proposal payload", async () => {
    const out = await composeAgentProposal(makeDesign(), rowsWith(null));

    expect(out).not.toBeNull();
    expect(out?.tags).toEqual([]);
  });

  it("accepts a bare-array response as well as an {items} envelope", async () => {
    const out = await composeAgentProposal(makeDesign(), [
      {
        evidence: {
          comparison_proposal: {
            tags: [{ category: { label: "disease" }, value: { label: "AD" } }],
          },
        },
      },
    ]);

    expect(out?.tags).toHaveLength(1);
    expect(out?.tags[0].value.label).toBe("AD");
  });

  it("returns the bare preboard when the proposals fetch throws", async () => {
    preboardMock.mockResolvedValue(makeDesign({ experiment_short_name: "PRE" }));
    apiGet.mockRejectedValue(new Error("500"));

    const { result } = renderHook(
      () => useChipDesignPair(EID, "empty", "agent_proposal"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // The preboard still resolved, so the slot shows it rather than
    // collapsing the whole comparison to null.
    expect(result.current.comparator?.experiment_short_name).toBe("PRE");
  });

  it("folds proposed tags on with negative synthetic ids", async () => {
    const out = await composeAgentProposal(
      makeDesign({
        tags: [
          {
            id: 7,
            category: { label: "organism part", uri: null },
            value: { label: "liver", uri: null },
            inferred: false,
            inferred_source: "",
            evidence_code: "IC",
          },
        ],
      }),
      rowsWith({
        tags: [
          {
            category: { label: "disease", uri: "http://x/MONDO_1" },
            value: { label: "Alzheimer disease", uri: "http://x/DOID_2" },
          },
          { category: { label: "sex" }, value: { label: "female" } },
        ],
      }),
    );

    expect(out?.tags).toHaveLength(3);
    // The pre-existing preboard tag keeps its server id…
    expect(out?.tags[0].id).toBe(7);
    // …and the folded ones are negative, so they cannot collide.
    expect(out?.tags[1].id).toBe(-1);
    expect(out?.tags[2].id).toBe(-2);
    expect(out?.tags[1].category).toEqual({
      label: "disease",
      uri: "http://x/MONDO_1",
    });
  });

  it("coerces a missing tag label to \"\" and a missing uri to null", async () => {
    const out = await composeAgentProposal(
      makeDesign(),
      rowsWith({ tags: [{}] }),
    );

    expect(out?.tags[0].category).toEqual({ label: "", uri: null });
    expect(out?.tags[0].value).toEqual({ label: "", uri: null });
  });

  it("folds proposed factors on with negative ids and negative FV ids", async () => {
    const out = await composeAgentProposal(
      makeDesign(),
      rowsWith({
        factors: [
          {
            name_in_design: "disease state",
            category: { label: "disease", uri: "http://x/1" },
            description: "primary axis",
            factor_type: "categorical",
            factor_values: [
              {
                free_text_label: "control",
                is_baseline: true,
                biomaterial_short_names: ["GSM1", "GSM2"],
              },
              { free_text_label: "AD", biomaterial_short_names: ["GSM3"] },
            ],
          },
        ],
      }),
    );

    expect(out?.factors).toHaveLength(1);
    const f = out!.factors[0];
    expect(f.id).toBe(-1);
    expect(f.name).toBe("disease state");
    expect(f.description).toBe("primary axis");
    expect(f.factor_values.map((fv) => fv.id)).toEqual([-1000, -1001]);
    expect(f.factor_values[0].is_baseline).toBe(true);
    // ``is_baseline`` absent must read as false, not undefined.
    expect(f.factor_values[1].is_baseline).toBe(false);
    expect(f.factor_values[0].biomaterial_short_names).toEqual([
      "GSM1",
      "GSM2",
    ]);
  });

  it("falls back to the category label, then \"factor\", for the factor name", async () => {
    const out = await composeAgentProposal(
      makeDesign(),
      rowsWith({
        factors: [
          { category: { label: "genotype" } },
          {},
        ],
      }),
    );

    expect(out?.factors[0].name).toBe("genotype");
    expect(out?.factors[1].name).toBe("factor");
  });

  it("defaults an absent factor_type to categorical", async () => {
    const out = await composeAgentProposal(
      makeDesign(),
      rowsWith({ factors: [{ category: { label: "sex" } }] }),
    );

    expect(out?.factors[0].type).toBe("categorical");
  });

  it("maps FV statements, nulling the optional term slots when absent", async () => {
    const out = await composeAgentProposal(
      makeDesign(),
      rowsWith({
        factors: [
          {
            category: { label: "treatment" },
            factor_values: [
              {
                free_text_label: "cisplatin 10mg",
                statements: [
                  {
                    category: { label: "treatment", uri: "http://x/EFO_1" },
                    subject: { label: "cisplatin", uri: "http://x/CHEBI_1" },
                    predicate: { label: "has dose" },
                    object: { label: "10 mg/kg" },
                  },
                  // Bare subject-only statement — the common shape.
                  { subject: { label: "vehicle" } },
                ],
              },
            ],
          },
        ],
      }),
    );

    const stmts = out!.factors[0].factor_values[0].statements;
    expect(stmts).toHaveLength(2);
    expect(stmts[0].subject).toEqual({
      label: "cisplatin",
      uri: "http://x/CHEBI_1",
    });
    expect(stmts[0].predicate).toEqual({ label: "has dose", uri: null });
    expect(stmts[0].category).toEqual({
      label: "treatment",
      uri: "http://x/EFO_1",
    });
    // Absent optional slots are null, NOT an empty term — an empty
    // term would render as a blank chip in the statement widget.
    expect(stmts[1].category).toBeNull();
    expect(stmts[1].predicate).toBeNull();
    expect(stmts[1].object).toBeNull();
  });

  it("does not mutate the preboard it composes onto", async () => {
    // The preboard object is shared with the other chip slot through
    // the query cache; folding must not reach back into it.
    const preboard = makeDesign();
    const out = await composeAgentProposal(
      preboard,
      rowsWith({
        tags: [{ category: { label: "disease" }, value: { label: "AD" } }],
        factors: [{ category: { label: "sex" } }],
      }),
    );

    expect(out?.tags).toHaveLength(1);
    expect(out?.factors).toHaveLength(1);
    expect(preboard.tags).toEqual([]);
    expect(preboard.factors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Diff summary
// ---------------------------------------------------------------------------
describe("useChipDiffSummary", () => {
  it("reports no summary and no loading when either slot is empty", async () => {
    const { result } = renderHook(
      () => useChipDiffSummary(EID, "empty", "empty"),
      { wrapper },
    );

    expect(result.current.summary).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("reports no summary when a populated slot resolves to null", async () => {
    preboardMock.mockRejectedValue(new Error("gone"));
    apiGet.mockResolvedValue(makeDesign());

    const { result } = renderHook(
      () => useChipDiffSummary(EID, "preboard", "polished:curator-b"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.summary).toBeNull();
  });

  it("summarises the diff once both slots resolve", async () => {
    const withTag = makeDesign({
      tags: [
        {
          id: 1,
          category: { label: "disease", uri: null },
          value: { label: "AD", uri: null },
          inferred: false,
          inferred_source: "",
          evidence_code: "IC",
        },
      ],
    });
    preboardMock.mockResolvedValue(makeDesign());
    apiGet.mockResolvedValue(withTag);

    const { result } = renderHook(
      () => useChipDiffSummary(EID, "preboard", "polished:curator-b"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.summary).not.toBeNull());
    // One real (non-inferred) tag present on the comparator only.
    expect(result.current.summary?.addedTags).toBe(1);
    expect(result.current.summary?.removedTags).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Calibration audit report passthrough
// ---------------------------------------------------------------------------
describe("useCalibrationAuditReport", () => {
  it("returns the first row from an {items} envelope", async () => {
    apiGet.mockResolvedValue({ items: [{ audit_id: "a1" }, { audit_id: "a2" }] });

    const { result } = renderHook(() => useCalibrationAuditReport(EID), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).not.toBeUndefined());
    expect(result.current.data).toEqual({ audit_id: "a1" });
  });

  it("accepts a bare-array response", async () => {
    apiGet.mockResolvedValue([{ audit_id: "a1" }]);

    const { result } = renderHook(() => useCalibrationAuditReport(EID), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).not.toBeUndefined());
    expect(result.current.data).toEqual({ audit_id: "a1" });
  });

  it("resolves to null on an empty list", async () => {
    apiGet.mockResolvedValue({ items: [] });

    const { result } = renderHook(() => useCalibrationAuditReport(EID), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBeNull();
  });

  it("resolves to null rather than erroring when the fetch throws", async () => {
    apiGet.mockRejectedValue(new Error("500"));

    const { result } = renderHook(() => useCalibrationAuditReport(EID), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.isError).toBe(false);
  });
});
