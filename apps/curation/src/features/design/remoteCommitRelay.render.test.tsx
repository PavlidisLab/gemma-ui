/**
 * @vitest-environment jsdom
 *
 * In remote mode, commit goes through the AGENT — and nowhere else.
 *
 * `commitBarRemoteGate.render.test.tsx` pins that the button is live.
 * This pins where the click actually lands, which is the half that can
 * be wrong silently: a commit that returns 200 against the STORE looks
 * identical to one that reached Gemma, and the curator would have no
 * way to tell their work never left the building.
 *
 * Three things have to hold together, and each is a separate `it`
 * because each fails on its own:
 *
 *  1. the whole-design `/design` PUT must not run — it sends the
 *     store's design shape, which Gemma's design route does not read;
 *  2. preflight must run BEFORE commit — it is where the baseline
 *     token comes from, not decoration;
 *  3. the store-side follow-ups (`/polished` mirror, edit log) must not
 *     run, because this commit did not land in the store.
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
import { sendCurationEditLog } from "@/api/designEdits";
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
const sendLogMock = sendCurationEditLog as ReturnType<typeof vi.fn>;

const EID = "1658";

/** Remote-shaped: Gemma's own POSITIVE ids on the factor and value.
 *  That is what makes the sign test name them as updates rather than
 *  creates, and why this path is remote-only. */
function makeDesign(): Design {
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
            free_text_label: "control",
            is_baseline: true,
            statements: [],
            biomaterial_short_names: ["GSM1"],
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

const putMutate = vi.fn();

async function renderAndCommit(mode: "local" | "remote") {
  vi.mocked(useGemmaMode).mockReturnValue(
    resolveGemmaMode(
      mode === "remote"
        ? { mode: "remote", gemmaBaseUrl: "https://gemma2.msl.ubc.ca" }
        : { mode: "local" },
    ),
  );
  useUpdateDesignMock.mockReturnValue({
    mutate: putMutate.mockImplementation(
      (body: Design, opts?: { onSuccess?: (d: Design) => void }) =>
        opts?.onSuccess?.(body),
    ),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  });
  useUpdatePolishedMock.mockReturnValue({
    mutate: vi.fn((body: Design, opts?: { onSuccess?: (d: Design) => void }) =>
      opts?.onSuccess?.(body),
    ),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  });
  useDesignMock.mockReturnValue({
    data: makeDesign(),
    isLoading: false,
    error: null,
  });
  vi.mocked(useCurations).mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
  } as never);
  vi.mocked(resolveCuration).mockReturnValue(null as never);

  render(
    <DesignDraftProvider experimentId={EID} reviewer="paul">
      <Probe />
    </DesignDraftProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("y"));
  fireEvent.click(screen.getByTestId("edit"));
  await waitFor(() =>
    expect(screen.getByTestId("label").textContent).toBe("vehicle"),
  );
  fireEvent.click(screen.getByTestId("go"));
}

beforeEach(() => {
  vi.clearAllMocks();
  preflightMock.mockResolvedValue({ newBaseline: "2026-09-01T21:00:00Z" });
  commitMock.mockResolvedValue({ applied: true });
  sendLogMock.mockResolvedValue(undefined);
  try {
    window.localStorage?.clear();
  } catch {
    /* no localStorage here — fine */
  }
});

describe("remote commit goes through the agent relay", () => {
  it("🛑 does NOT send the whole-design PUT", async () => {
    await renderAndCommit("remote");
    await waitFor(() => expect(commitMock).toHaveBeenCalled());
    expect(putMutate).not.toHaveBeenCalled();
  });

  it("🛑 preflights BEFORE committing — that is where the baseline comes from", async () => {
    await renderAndCommit("remote");
    await waitFor(() => expect(commitMock).toHaveBeenCalled());
    expect(preflightMock).toHaveBeenCalled();
    expect(preflightMock.mock.invocationCallOrder[0]).toBeLessThan(
      commitMock.mock.invocationCallOrder[0],
    );
  });

  it("threads the preflight's baseline token into the commit", async () => {
    await renderAndCommit("remote");
    await waitFor(() => expect(commitMock).toHaveBeenCalled());
    expect(commitMock.mock.calls[0][2]).toMatchObject({
      baselineLastModified: "2026-09-01T21:00:00Z",
      onBehalfOf: "paul",
    });
  });

  it("sends the curator's edit in Gemma's document shape", async () => {
    await renderAndCommit("remote");
    await waitFor(() => expect(commitMock).toHaveBeenCalled());
    const doc = commitMock.mock.calls[0][1];
    const factor = doc.design?.factors?.items?.[0];
    // gemmaId, not clientRef — a create here would duplicate the design.
    expect(factor?.gemmaId).toBe(23079);
    expect(factor?.factorValues?.items?.[0]).toMatchObject({
      gemmaId: 64275,
      freeTextLabel: "vehicle",
    });
  });

  it("🛑 does not write the store's follow-ups", async () => {
    // The `/polished` mirror and the edit log both target the curation
    // store. This commit did not land there, so mirroring would leave a
    // snapshot of a design the store does not own.
    await renderAndCommit("remote");
    await waitFor(() => expect(commitMock).toHaveBeenCalled());
    expect(sendLogMock).not.toHaveBeenCalled();
  });

  it("surfaces a relay failure instead of reporting success", async () => {
    commitMock.mockRejectedValueOnce(new Error("502 write target refused"));
    await renderAndCommit("remote");
    await waitFor(() =>
      expect(screen.getByTestId("result").textContent).toMatch(/^err:/),
    );
    expect(screen.getByTestId("result").textContent).toContain("502");
  });
});

describe("local mode is untouched", () => {
  it("🛑 still uses the whole-design PUT and never the relay", async () => {
    await renderAndCommit("local");
    await waitFor(() => expect(putMutate).toHaveBeenCalled());
    expect(preflightMock).not.toHaveBeenCalled();
    expect(commitMock).not.toHaveBeenCalled();
  });
});
