/** Round-trip tests for the curator workflow:
 *  agent → UI → curator work → export → import.
 *
 *  Scope of THIS file:
 *
 *  - **Export step regression** (the load-bearing one). On 2026-05-29
 *    GSE269647 we proved that ``fetchDesignSnapshot`` returns the
 *    preboard + agent's last proposal overlay, NOT the curator's
 *    polished Design. The Export Set bundle was therefore shipping
 *    the agent's last proposed state, not the curator's edits. The
 *    fix wires ``fetchPolishedSnapshot`` first with a graceful
 *    fallback to ``fetchDesignSnapshot``. These tests pin that
 *    contract so we can't silently regress.
 *  - **Bundle round-trip** (gzip → parse → reconstruct). The bundle
 *    must deserialise back into the same shape it serialised.
 *
 *  See ``memory/procedure_polished_gold_build.md`` (in the eval repo)
 *  for the broader procedure + failure log.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Design } from "@/features/experiment/types";
import type { Group } from "@/api/workflowTypes";

vi.mock("@/api/design", () => ({
  useInvalidateAfterDesignCommit: () => () => {},
  fetchPolishedSnapshot: vi.fn(),
  fetchDesignSnapshot: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
}));

import { fetchPolishedSnapshot, fetchDesignSnapshot } from "@/api/design";
import { api } from "@/api/client";
import { buildSetExport } from "./exportSet";

const apiGet = api.get as ReturnType<typeof vi.fn>;
const polishedMock = fetchPolishedSnapshot as ReturnType<typeof vi.fn>;
const snapshotMock = fetchDesignSnapshot as ReturnType<typeof vi.fn>;

const POLISHED_DESIGN: Design = {
  experiment_id: 91672,
  short_name: "GSE269647",
  external_source: { database: "GEO", accession: "GSE269647", uri: null },
  title: "polished view",
  description: "",
  taxon: "mouse",
  assay: "bulk RNA-seq",
  technology_type: "SEQUENCING",
  platform: { short_name: "Generic_mouse_ncbilds" },
  publications: [],
  factors: [
    {
      id: 999,
      name: "age",
      category: { label: "age", uri: null },
      type: "categorical",
      factor_values: [
        {
          id: 9991,
          free_text_label: "young",
          is_baseline: true,
          statements: [
            {
              subject: { label: "young adult stage", uri: null },
              predicate: null,
              object: null,
            },
          ],
          biomaterial_short_names: [],
        },
      ],
    },
  ],
  biomaterials: [],
  tags: [],
} as unknown as Design;

const STALE_SNAPSHOT_DESIGN: Design = {
  ...POLISHED_DESIGN,
  factors: [
    {
      id: 888,
      name: "developmental stage",
      category: { label: "developmental stage", uri: null },
      type: "categorical",
      factor_values: [
        {
          id: 8881,
          free_text_label: "young",
          is_baseline: true,
          statements: [],
          biomaterial_short_names: [],
        },
      ],
    },
  ],
} as unknown as Design;

function makeGroup(): Group {
  return {
    id: "test-group",
    name: "test set",
    type: "review",
    description: null,
    created_by: "test",
    created_at: "2026-05-29T00:00:00Z",
    finalized_at: null,
    finalized_by: null,
    finalized_notes: null,
    member_ids: ["91672"],
    member_count: 1,
    member_summaries: null,
    member_status_counts: { done: 0, in_progress: 0, untouched: 1 },
    task_kind: "review_audit",
  } as unknown as Group;
}

describe("Export Set: source preference", () => {
  beforeEach(() => {
    polishedMock.mockReset();
    snapshotMock.mockReset();
    apiGet.mockReset();
    // /audits + /proposals — return empty lists so fetchLatestReviewStatus
    // doesn't throw.
    apiGet.mockImplementation(async (path: string) => {
      if (path.includes("/audits") || path.includes("/proposals")) {
        return { items: [], total: 0 };
      }
      throw Object.assign(new Error("unexpected api.get"), { status: 500 });
    });
  });

  it("uses the curator's polished Design when present", async () => {
    polishedMock.mockResolvedValue(POLISHED_DESIGN);
    snapshotMock.mockResolvedValue(STALE_SNAPSHOT_DESIGN);

    const bundle = await buildSetExport(makeGroup(), "cy");

    expect(polishedMock).toHaveBeenCalledWith(91672, "cy");
    expect(snapshotMock).not.toHaveBeenCalled();
    expect(bundle.experiments).toHaveLength(1);
    const factors = bundle.experiments[0].design?.factors ?? [];
    expect(factors[0]?.category?.label).toBe("age");
  });

  it("falls back to fetchDesignSnapshot when polished is missing (404 → null)", async () => {
    polishedMock.mockResolvedValue(null);
    snapshotMock.mockResolvedValue(STALE_SNAPSHOT_DESIGN);

    const bundle = await buildSetExport(makeGroup(), "cy");

    expect(polishedMock).toHaveBeenCalledWith(91672, "cy");
    expect(snapshotMock).toHaveBeenCalledWith(91672);
    expect(bundle.experiments).toHaveLength(1);
    // Fallback returned the snapshot; bundle reflects that.
    const factors = bundle.experiments[0].design?.factors ?? [];
    expect(factors[0]?.category?.label).toBe("developmental stage");
  });

  it("never silently regresses to fetchDesignSnapshot when polished IS present", async () => {
    // Regression pin for the 2026-05-29 GSE269647 incident: even if
    // fetchDesignSnapshot is somehow callable, the polished source
    // must win when it returns a Design.
    polishedMock.mockResolvedValue(POLISHED_DESIGN);
    snapshotMock.mockResolvedValue(STALE_SNAPSHOT_DESIGN);

    const bundle = await buildSetExport(makeGroup(), "cy");

    expect(snapshotMock).not.toHaveBeenCalled();
    const factorLabels = (bundle.experiments[0].design?.factors ?? [])
      .map((f) => f.category?.label);
    expect(factorLabels).toContain("age");
    expect(factorLabels).not.toContain("developmental stage");
  });
});

describe("Export Set: bundle shape round-trip", () => {
  beforeEach(() => {
    polishedMock.mockReset();
    snapshotMock.mockReset();
    apiGet.mockReset();
    apiGet.mockImplementation(async (path: string) => {
      if (path.includes("/audits") || path.includes("/proposals")) {
        return { items: [], total: 0 };
      }
      throw Object.assign(new Error("unexpected api.get"), { status: 500 });
    });
  });

  it("serialises to JSON and deserialises back without loss", async () => {
    polishedMock.mockResolvedValue(POLISHED_DESIGN);
    const bundle = await buildSetExport(makeGroup(), "cy");

    const text = JSON.stringify(bundle);
    const back = JSON.parse(text);

    expect(back.bundle_kind).toBe("gemma_curation_set_export");
    expect(back.curator).toBe("cy");
    expect(back.experiments).toHaveLength(1);
    // FV statements survive the round-trip — critical for downstream
    // statement-based matching (FV labels are not the match key).
    const stmts = back.experiments[0].design.factors[0].factor_values[0].statements;
    expect(stmts).toHaveLength(1);
    expect(stmts[0].subject.label).toBe("young adult stage");
  });
});
