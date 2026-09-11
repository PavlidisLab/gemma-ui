/**
 * @vitest-environment jsdom
 *
 * After a remote commit, the draft has to become what GEMMA holds.
 *
 * The local path checkpoints on `server` — the design its own PUT
 * answered with. The remote commit answers with a report instead, so
 * the equivalent arrives one `/design` refetch later, and two things
 * move in between: `canonicaliseClauses` rewrites clause labels in the
 * DOCUMENT and not in the draft, and a row sent as a create comes back
 * under the id Gemma minted.
 *
 * Left uncollected, the draft differs from `/design` by exactly those.
 * The ordinary background sync will not collect them: it asks whether
 * the draft was clean against the PRE-commit design, and it never was —
 * that is what the curator just committed. So the bar reports pending
 * changes forever, and the next Commit sends Gemma's id under
 * `deletedIds` (`removalsFromDiff`) and recreates the row.
 *
 * The second test is the other half: a refetch that follows no commit
 * must still leave a dirty draft alone.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { Design } from "@/features/experiment/types";

vi.mock("@/api/design", () => ({
  useInvalidateAfterDesignCommit: () => () => {},
  useDesign: vi.fn(),
  useUpdateDesign: vi.fn(),
  useUpdatePolished: vi.fn(),
}));
vi.mock("@/api/designEdits", () => ({
  sendCurationEditLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/api/curationCommit", async () => {
  const actual =
    await vi.importActual<typeof import("@/api/curationCommit")>(
      "@/api/curationCommit",
    );
  return {
    ...actual,
    preflightCuration: vi.fn(),
    commitCuration: vi.fn(),
  };
});
// Identity: the rewrite itself has its own tests, and what matters here
// is that Gemma's copy differs from the draft afterwards.
vi.mock("@/api/canonicaliseClauses", () => ({
  canonicaliseClauses: vi.fn(async (doc: unknown) => doc),
}));
vi.mock("@/lib/gemmaMode", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/gemmaMode")>("@/lib/gemmaMode");
  return { ...actual, useGemmaMode: vi.fn() };
});
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
import { commitCuration, preflightCuration } from "@/api/curationCommit";
import { resolveGemmaMode, useGemmaMode } from "@/lib/gemmaMode";
import { useCurations } from "@/features/comparison/useSourceAvailability";
import { resolveCuration } from "@/features/comparison/resolveCuration";
import { DesignDraftProvider, useDesignDraft } from "./DesignDraftContext";

const useDesignMock = useDesign as ReturnType<typeof vi.fn>;
const useUpdateDesignMock = useUpdateDesign as ReturnType<typeof vi.fn>;
const useUpdatePolishedMock = useUpdatePolished as ReturnType<typeof vi.fn>;
const preflightMock = preflightCuration as ReturnType<typeof vi.fn>;
const commitMock = commitCuration as ReturnType<typeof vi.fn>;

const EID = "1658";

/** Gemma's own ids, and a clause carrying the stored label. */
function makeDesign(over: { label?: string; predicate?: string } = {}): Design {
  return {
    experiment_id: 1658,
    experiment_short_name: "GSE11630",
    factors: [
      {
        id: 23079,
        name: "treatment",
        category: { label: "treatment", uri: "obo:EFO_0000727" },
        description: "acid vs vehicle",
        type: "categorical",
        gemma_factor_id: 23079,
        factor_values: [
          {
            id: 64275,
            free_text_label: over.label ?? "control",
            is_baseline: true,
            biomaterial_short_names: ["GSM1"],
            statements: [
              {
                gemma_id: 30165836,
                category: { label: "treatment", uri: "obo:EFO_0000727" },
                subject: { label: "R1 cell", uri: "obo:CLO_0008379" },
                predicate: {
                  label: over.predicate ?? "derived from cell",
                  uri: "obo:CLO_0037209",
                },
                object: { label: "cell", uri: "obo:CL_0000000" },
              },
            ],
          },
        ],
      },
    ],
    biomaterials: [],
    tags: [],
    title: "a title",
  } as unknown as Design;
}

function Probe() {
  const { draft, diff, apply, commit } = useDesignDraft();
  const fv = draft?.factors?.[0]?.factor_values?.[0];
  return (
    <div>
      <span data-testid="ready">{draft ? "y" : "n"}</span>
      <span data-testid="label">{fv?.free_text_label ?? ""}</span>
      <span data-testid="predicate">
        {fv?.statements?.[0]?.predicate?.label ?? ""}
      </span>
      <span data-testid="dirty">{diff.isDirty ? "dirty" : "clean"}</span>
      <button
        data-testid="edit"
        onClick={() =>
          apply((d) => ({
            ...d,
            factors: d.factors.map((f) => ({
              ...f,
              factor_values: f.factor_values.map((v) => ({
                ...v,
                free_text_label: "vehicle",
              })),
            })),
          }))
        }
      >
        relabel
      </button>
      <button data-testid="go" onClick={() => commit()}>
        commit
      </button>
    </div>
  );
}

function setup(design: Design) {
  vi.mocked(useGemmaMode).mockReturnValue(
    resolveGemmaMode({
      mode: "remote",
      gemmaBaseUrl: "https://gemma2.msl.ubc.ca",
    }),
  );
  useUpdateDesignMock.mockReturnValue({
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  });
  useUpdatePolishedMock.mockReturnValue({
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  });
  useDesignMock.mockReturnValue({ data: design, isLoading: false, error: null });
  vi.mocked(useCurations).mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
  } as never);
  vi.mocked(resolveCuration).mockReturnValue(null as never);
  return render(
    <DesignDraftProvider experimentId={EID} reviewer="paul">
      <Probe />
    </DesignDraftProvider>,
  );
}

/** What the next `/design` hands back. The provider re-reads it on the
 *  next render, which is what an invalidation produces. */
function serveInstead(design: Design, rerender: (ui: React.ReactElement) => void) {
  useDesignMock.mockReturnValue({ data: design, isLoading: false, error: null });
  rerender(
    <DesignDraftProvider experimentId={EID} reviewer="paul">
      <Probe />
    </DesignDraftProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  preflightMock.mockResolvedValue({ new_baseline: "2026-09-10T21:00:00Z" });
  commitMock.mockResolvedValue({ applied: true });
  try {
    window.localStorage?.clear();
  } catch {
    /* no localStorage here — fine */
  }
});

describe("the draft becomes what Gemma holds", () => {
  it("🛑 adopts the design the post-commit refetch serves", async () => {
    const { rerender } = setup(makeDesign());
    await waitFor(() =>
      expect(screen.getByTestId("ready").textContent).toBe("y"),
    );
    fireEvent.click(screen.getByTestId("edit"));
    await waitFor(() =>
      expect(screen.getByTestId("label").textContent).toBe("vehicle"),
    );
    fireEvent.click(screen.getByTestId("go"));
    await waitFor(() => expect(commitMock).toHaveBeenCalled());

    // Gemma took the edit and canonicalised the clause on the way in.
    serveInstead(
      makeDesign({ label: "vehicle", predicate: "derives from cell" }),
      rerender,
    );

    await waitFor(() =>
      expect(screen.getByTestId("predicate").textContent).toBe(
        "derives from cell",
      ),
    );
    // And the bar clears: left on the pre-commit draft it reads dirty
    // forever, and the next Commit deletes and recreates the row.
    expect(screen.getByTestId("dirty").textContent).toBe("clean");
  });

  it("🛑 leaves a dirty draft alone when no commit preceded the refetch", async () => {
    // The adopt is armed by this session's own commit and by nothing
    // else. A background refetch must never discard pending work.
    const { rerender } = setup(makeDesign());
    await waitFor(() =>
      expect(screen.getByTestId("ready").textContent).toBe("y"),
    );
    fireEvent.click(screen.getByTestId("edit"));
    await waitFor(() =>
      expect(screen.getByTestId("label").textContent).toBe("vehicle"),
    );

    serveInstead(makeDesign({ predicate: "derives from cell" }), rerender);

    // Still the curator's edit, not the server's copy.
    await waitFor(() =>
      expect(screen.getByTestId("label").textContent).toBe("vehicle"),
    );
    expect(screen.getByTestId("dirty").textContent).toBe("dirty");
  });

  it("🛑 an edit made while the refetch is in flight survives it", async () => {
    // The arm is spent on the next design to land, and a fresh edit
    // outranks it — otherwise a keystroke between the commit and the
    // refetch would be discarded without a word.
    const { rerender } = setup(makeDesign());
    await waitFor(() =>
      expect(screen.getByTestId("ready").textContent).toBe("y"),
    );
    fireEvent.click(screen.getByTestId("edit"));
    fireEvent.click(screen.getByTestId("go"));
    await waitFor(() => expect(commitMock).toHaveBeenCalled());

    // A second edit lands before the refetch does.
    fireEvent.click(screen.getByTestId("edit"));
    serveInstead(makeDesign({ label: "control" }), rerender);

    await waitFor(() =>
      expect(screen.getByTestId("label").textContent).toBe("vehicle"),
    );
  });
});
