/**
 * @vitest-environment jsdom
 *
 * The commit sends the EDIT alongside the snapshot.
 *
 * `editLog.test.ts` pins what a log says about a pair of designs. This
 * pins the wiring: that `commit()` captures the edit at the click,
 * sends it once the design PUT lands, and that nothing about the log
 * can cost a curator their commit.
 *
 * The last point is the one worth guarding. Until the reconcile reads
 * these logs (step 2 of
 * `UI_WRITE_THE_EDIT_NOT_THE_DESIGN_2026_08_17`), a store without the
 * sink is the expected state — so a commit against such a store has to
 * behave exactly as it did before this landed.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { Design } from "@/features/experiment/types";
import type { CurationEditLog } from "./editLog";

vi.mock("@/api/design", () => ({
  useDesign: vi.fn(),
  useUpdateDesign: vi.fn(),
  useUpdatePolished: vi.fn(),
}));
vi.mock("@/api/designEdits", () => ({
  sendCurationEditLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/features/comparison/useSourceAvailability", () => ({
  useCurations: vi.fn(),
}));
vi.mock("@/features/comparison/resolveCuration", () => ({
  resolveCuration: vi.fn(),
}));
vi.mock("@/features/proposal/proposalDispositions", () => ({
  clearAllProposalStateForExperiment: vi.fn(),
  notifyProposalStateReset: vi.fn(),
}));
vi.mock("@/features/audit/appliedBatches", () => ({
  clearAppliedBatches: vi.fn(),
}));
vi.mock("@/features/proposal/paperDismissal", () => ({
  clearPaperDismissals: vi.fn(),
}));

import { useDesign, useUpdateDesign, useUpdatePolished } from "@/api/design";
import { sendCurationEditLog } from "@/api/designEdits";
import { useCurations } from "@/features/comparison/useSourceAvailability";
import { resolveCuration } from "@/features/comparison/resolveCuration";
import { DesignDraftProvider, useDesignDraft } from "./DesignDraftContext";

const useDesignMock = useDesign as ReturnType<typeof vi.fn>;
const useUpdateDesignMock = useUpdateDesign as ReturnType<typeof vi.fn>;
const useUpdatePolishedMock = useUpdatePolished as ReturnType<typeof vi.fn>;
const useCurationsMock = useCurations as ReturnType<typeof vi.fn>;
const resolveCurationMock = resolveCuration as ReturnType<typeof vi.fn>;
const sendLogMock = sendCurationEditLog as ReturnType<typeof vi.fn>;

const EID = "42";

function makeDesign(overrides: Partial<Design> = {}): Design {
  return {
    experiment_id: 42,
    experiment_short_name: "GSE96826",
    factors: [
      {
        id: 10,
        name: "treatment",
        category: { label: "treatment", uri: "obo:EFO_0000727" },
        description: "drug vs vehicle",
        type: "categorical",
        gemma_factor_id: 23079,
        factor_values: [
          {
            id: 1,
            free_text_label: "control",
            is_baseline: true,
            statements: [],
            biomaterial_short_names: ["S1"],
          },
        ],
      },
    ],
    biomaterials: [],
    tags: [],
    title: "a title",
    ...overrides,
  };
}

/** The design PUT resolves; the polished mirror is configurable so we
 *  can prove the log rides on the PUT, not the full checkpoint. */
function stubUpdater({ mirrorFails = false } = {}) {
  useUpdateDesignMock.mockReturnValue({
    mutate: vi.fn((body: Design, opts?: { onSuccess?: (d: Design) => void }) => {
      opts?.onSuccess?.(body);
    }),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  });
  useUpdatePolishedMock.mockReturnValue({
    mutate: vi.fn(
      (
        body: Design,
        opts?: { onSuccess?: (d: Design) => void; onError?: (e: Error) => void },
      ) => {
        if (mirrorFails) opts?.onError?.(new Error("mirror down"));
        else opts?.onSuccess?.(body);
      },
    ),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  });
}

/**
 * Edit and commit are SEPARATE clicks, as they are for a curator.
 * Doing both in one handler would have `commit()` close over the
 * pre-edit draft and log nothing — a property of the callback, not of
 * the log.
 */
function Probe() {
  const { draft, apply, commit } = useDesignDraft();
  return (
    <div>
      <span data-testid="ready">{draft ? "y" : "n"}</span>
      <span data-testid="label">
        {draft?.factors?.[0]?.factor_values?.[0]?.free_text_label ?? ""}
      </span>
      <button
        data-testid="edit"
        onClick={() =>
          apply((d) => ({
            ...d,
            factors: d.factors.map((f) => ({
              ...f,
              factor_values: f.factor_values.map((fv) => ({
                ...fv,
                free_text_label: "vehicle",
              })),
            })),
          }))
        }
      >
        relabel
      </button>
      <button
        data-testid="go"
        onClick={() =>
          commit((r) => {
            const el = document.querySelector('[data-testid="result"]');
            if (el) el.textContent = r.ok ? "ok" : `err:${r.error}`;
          })
        }
      >
        commit
      </button>
      <span data-testid="result" />
    </div>
  );
}

async function renderAndCommit(opts: { edit?: boolean; mirrorFails?: boolean } = {}) {
  stubUpdater({ mirrorFails: opts.mirrorFails });
  useDesignMock.mockReturnValue({
    data: makeDesign(),
    isLoading: false,
    error: null,
  });
  useCurationsMock.mockReturnValue({ data: [], isLoading: false, error: null });
  resolveCurationMock.mockReturnValue(null);

  render(
    <DesignDraftProvider experimentId={EID} reviewer="paul">
      <Probe />
    </DesignDraftProvider>,
  );
  await waitFor(() => {
    expect(screen.getByTestId("ready").textContent).toBe("y");
  });
  if (opts.edit ?? true) {
    fireEvent.click(screen.getByTestId("edit"));
    await waitFor(() => {
      expect(screen.getByTestId("label").textContent).toBe("vehicle");
    });
  }
  fireEvent.click(screen.getByTestId("go"));
  await waitFor(() => {
    expect(sendLogMock).toHaveBeenCalled();
  });
  return sendLogMock.mock.calls[0][1] as CurationEditLog;
}

beforeEach(() => {
  vi.clearAllMocks();
  sendLogMock.mockResolvedValue(undefined);
  try {
    window.localStorage?.clear();
  } catch {
    /* no localStorage in this env — fine */
  }
});

describe("commit() sends the edit, not the design", () => {
  it("logs the one field the curator changed", async () => {
    const log = await renderAndCommit();
    expect(log.edits).toHaveLength(1);
    expect(log.edits[0]).toMatchObject({
      op: "modify",
      field: "label",
      before: "control",
      after: "vehicle",
    });
    // Named by the reading that locates it in the base, with the
    // parent factor's identity carried alongside.
    expect(log.edits[0].target.label).toBe("control");
    expect(log.edits[0].target.gemma_factor_id).toBe(23079);
  });

  it("stamps the curator and the document the edit was made against", async () => {
    const log = await renderAndCommit();
    expect(log.actor).toEqual({ kind: "curator", name: "paul" });
    expect(log.base.source_kind).toBe("design");
    // The field that retires the reconcile's base-guessing chain.
    expect(log.base.content_hash).toBeTruthy();
  });

  it("logs an EMPTY edit list when the curator changed nothing", async () => {
    // The seeded-row class. A snapshot cannot say "I changed nothing";
    // this can, and that is the whole point of step 1.
    const log = await renderAndCommit({ edit: false });
    expect(log.edits).toEqual([]);
  });

  it("sends the log on the design PUT even when the polished mirror fails", async () => {
    // The edits landed in /design at that point whatever the mirror did.
    const log = await renderAndCommit({ mirrorFails: true });
    expect(log.edits).toHaveLength(1);
    await waitFor(() => {
      expect(screen.getByTestId("result").textContent).toBe("err:mirror down");
    });
  });

  it("does not cost the curator their commit when the log cannot be written", async () => {
    sendLogMock.mockRejectedValue(new Error("sink exploded"));
    await renderAndCommit();
    await waitFor(() => {
      expect(screen.getByTestId("result").textContent).toBe("ok");
    });
  });
});
