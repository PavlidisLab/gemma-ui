/**
 * @vitest-environment jsdom
 *
 * Regression tests for the cross-experiment buffer leak ("curation UI
 * commits a design for the wrong experiment").
 *
 * The organic trigger depended on the curator's chip-selection /
 * navigation sequence and was never pinned exactly. Rather than chase
 * it, these tests INJECT the exact failure condition — a baseline /
 * server payload carrying a *foreign* ``experiment_id`` while the route
 * points at a different experiment — and assert that the
 * ``DesignDraftProvider`` guards catch it:
 *
 *   1. Route id wins. A baseline payload whose ``experiment_id``
 *      differs from the route is stamped back to the routed id in
 *      ``savedFromBaseline`` — the foreign id never reaches the buffer.
 *   2. Seed assertion. When the *server-saved* design resolves to a
 *      different experiment than the route (the non-baseline path),
 *      the provider refuses to seed the editing buffer and surfaces a
 *      ``loadError`` instead of silently letting the curator edit the
 *      wrong dataset.
 *
 * The third guard — commit body re-stamping in ``useUpdateDesign`` —
 * lives in ``design.commitStamp.render.test.tsx`` (it needs the real
 * hook + a mocked api client, which conflicts with mocking
 * ``@/api/design`` here).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { useState } from "react";
import type { Design } from "@/features/experiment/types";

// ---------------------------------------------------------------------------
// Module mocks — hoisted above the provider import below.
// ---------------------------------------------------------------------------
vi.mock("@/api/design", () => ({
  useDesign: vi.fn(),
  useUpdateDesign: vi.fn(),
  useUpdatePolished: vi.fn(),
}));
vi.mock("@/features/comparison/useSourceAvailability", () => ({
  useCurations: vi.fn(),
}));
vi.mock("@/features/comparison/resolveCuration", () => ({
  resolveCuration: vi.fn(),
}));
// Only touched in discard() — stub so the module imports cleanly.
vi.mock("@/features/proposal/proposalDispositions", () => ({
  clearAllProposalStateForExperiment: vi.fn(),
  notifyProposalStateReset: vi.fn(),
}));
// Apply-All undo registry — spied on to assert the draft lifecycle
// invalidates its pre-commit snapshots (see the third describe below).
vi.mock("@/features/audit/appliedBatches", () => ({
  clearAppliedBatches: vi.fn(),
}));
vi.mock("@/features/proposal/paperDismissal", () => ({
  clearPaperDismissals: vi.fn(),
}));

import { clearAppliedBatches } from "@/features/audit/appliedBatches";
import { clearPaperDismissals } from "@/features/proposal/paperDismissal";
import { useDesign, useUpdateDesign, useUpdatePolished } from "@/api/design";
import { useCurations } from "@/features/comparison/useSourceAvailability";
import { resolveCuration } from "@/features/comparison/resolveCuration";
import {
  DesignDraftProvider,
  useDesignDraft,
} from "./DesignDraftContext";

const useDesignMock = useDesign as ReturnType<typeof vi.fn>;
const useUpdateDesignMock = useUpdateDesign as ReturnType<typeof vi.fn>;
const useUpdatePolishedMock = useUpdatePolished as ReturnType<typeof vi.fn>;
const useCurationsMock = useCurations as ReturnType<typeof vi.fn>;
const resolveCurationMock = resolveCuration as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ROUTE_ID = "91654"; // route.id is a STRING (routes.ts:87)
const ROUTE_EID = 91654;
const FOREIGN_EID = 38401; // the leaked GSE248901 id

function makeDesign(experimentId: number, shortName: string): Design {
  return {
    experiment_id: experimentId,
    experiment_short_name: shortName,
    factors: [],
    biomaterials: [],
    tags: [],
  };
}

/** Default the update-design hook to an inert stub. */
function stubUpdater() {
  useUpdateDesignMock.mockReturnValue({
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  });
  // The durable polished mirror is fire-and-forget; an inert stub keeps
  // the commit path exercisable without a real network write.
  useUpdatePolishedMock.mockReturnValue({
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  });
}

/** Consumer that surfaces the draft-context fields under test. */
function Probe() {
  const { saved, draft, loadError } = useDesignDraft();
  return (
    <div>
      <span data-testid="saved-eid">{saved?.experiment_id ?? "null"}</span>
      <span data-testid="draft-eid">{draft?.experiment_id ?? "null"}</span>
      <span data-testid="load-error">{loadError ?? ""}</span>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // localStorage isn't provided in this jsdom/node env; the provider
  // tolerates that (try/catch), so just clear it when present.
  try {
    window.localStorage?.clear();
  } catch {
    /* no localStorage in this env — fine */
  }
  stubUpdater();
});

// ---------------------------------------------------------------------------
// Guard 1 — route id wins over a foreign baseline payload
// ---------------------------------------------------------------------------
describe("DesignDraftProvider — route id is authoritative for experiment_id", () => {
  it("stamps the routed id onto a baseline payload that carries a foreign experiment_id", async () => {
    // useDesign is irrelevant on the non-editable baseline path, but
    // must still return a well-formed query result.
    useDesignMock.mockReturnValue({
      data: makeDesign(ROUTE_EID, "GSE253365"),
      isLoading: false,
      error: null,
    });
    // The chip baseline resolves to a "live" (non-editable) curation
    // row whose design payload is for the WRONG experiment (38401).
    const foreignBaseline = makeDesign(FOREIGN_EID, "GSE248901");
    useCurationsMock.mockReturnValue({
      data: [{ curation_id: "live", source_kind: "live", label: "Live Gemma", design: foreignBaseline }],
      isLoading: false,
      error: null,
    });
    resolveCurationMock.mockReturnValue({
      curation_id: "live",
      source_kind: "live",
      label: "Live Gemma",
      design: foreignBaseline,
    });

    render(
      <DesignDraftProvider experimentId={ROUTE_ID} baselineSource="live">
        <Probe />
      </DesignDraftProvider>,
    );

    // saved + draft must carry the ROUTE id, not the leaked 38401.
    await waitFor(() => {
      expect(screen.getByTestId("draft-eid").textContent).toBe(String(ROUTE_EID));
    });
    expect(screen.getByTestId("saved-eid").textContent).toBe(String(ROUTE_EID));
    // …and the buffer is editable (no error), because once the route
    // id is stamped the seed assertion sees a match.
    expect(screen.getByTestId("load-error").textContent).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Guard 2 — seed assertion refuses a foreign server design
// ---------------------------------------------------------------------------
describe("DesignDraftProvider — seed assertion refuses a cross-experiment design", () => {
  it("does not seed the buffer and surfaces a loadError when saved.experiment_id != route", async () => {
    // No chip baseline — the (non-stamped) server design itself is for
    // the wrong experiment. This is the independent safety net: even if
    // guard 1 were bypassed, the buffer must not seed.
    useDesignMock.mockReturnValue({
      data: makeDesign(FOREIGN_EID, "GSE248901"),
      isLoading: false,
      error: null,
    });
    useCurationsMock.mockReturnValue({ data: [], isLoading: false, error: null });
    resolveCurationMock.mockReturnValue(null);

    render(
      <DesignDraftProvider experimentId={ROUTE_ID}>
        <Probe />
      </DesignDraftProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("load-error").textContent).toContain(
        String(FOREIGN_EID),
      );
    });
    // The buffer stays unseeded — the curator never gets to edit the
    // wrong dataset.
    expect(screen.getByTestId("draft-eid").textContent).toBe("null");
    // The error names both ids so the curator knows what happened.
    expect(screen.getByTestId("load-error").textContent).toContain(
      String(ROUTE_EID),
    );
  });

  it("seeds normally when the server design matches the route", async () => {
    useDesignMock.mockReturnValue({
      data: makeDesign(ROUTE_EID, "GSE253365"),
      isLoading: false,
      error: null,
    });
    useCurationsMock.mockReturnValue({ data: [], isLoading: false, error: null });
    resolveCurationMock.mockReturnValue(null);

    render(
      <DesignDraftProvider experimentId={ROUTE_ID}>
        <Probe />
      </DesignDraftProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("draft-eid").textContent).toBe(String(ROUTE_EID));
    });
    expect(screen.getByTestId("load-error").textContent).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Guard 4 — commit is not "done" until the durable /polished mirror lands
// ---------------------------------------------------------------------------
//
// The ticket exporter reads /polished and prefers it over /design, so a
// silently-failed mirror leaves a stale polished snapshot shadowing the
// fresh design and the curator's accepted tag vanishes from the export.
// commit() therefore treats the mirror as part of success: the clean
// checkpoint (which clears the undo stack) runs ONLY after the mirror
// lands; on mirror failure the draft stays dirty and ``saveError``
// surfaces so the curator retries. ``canUndo`` is the checkpoint witness
// — apply() pushes the undo stack, a completed checkpoint clears it.
describe("DesignDraftProvider — commit gates the checkpoint on the polished mirror", () => {
  /** A consumer that drives apply → commit and surfaces the witnesses. */
  function CommitProbe() {
    const { apply, commit, canUndo, saveError } = useDesignDraft();
    const [settled, setSettled] = useState<string>("");
    return (
      <div>
        <span data-testid="can-undo">{canUndo ? "yes" : "no"}</span>
        <span data-testid="commit-error">{saveError ?? ""}</span>
        <span data-testid="settled-result">{settled}</span>
        <button
          data-testid="apply-btn"
          onClick={() =>
            apply((d) => ({
              ...d,
              tags: [
                ...d.tags,
                {
                  id: 1,
                  category: { label: "treatment", uri: null },
                  value: {
                    label: "neoplastic cell",
                    uri: "http://purl.obolibrary.org/obo/CL_0001063",
                  },
                  inferred: false,
                  evidence_code: "IC",
                },
              ],
            }))
          }
        />
        <button data-testid="commit-btn" onClick={() => commit()} />
        <button
          data-testid="commit-with-callback-btn"
          onClick={() =>
            commit((result) =>
              setSettled(result.ok ? "ok" : `error:${result.error}`),
            )
          }
        />
      </div>
    );
  }

  beforeEach(() => {
    useDesignMock.mockReturnValue({
      data: makeDesign(ROUTE_EID, "GSE253365"),
      isLoading: false,
      error: null,
    });
    useCurationsMock.mockReturnValue({ data: [], isLoading: false, error: null });
    resolveCurationMock.mockReturnValue(null);
    // The /design PUT always succeeds here — invoke its onSuccess with
    // the committed payload so the mirror step is reached.
    useUpdateDesignMock.mockReturnValue({
      mutate: vi.fn((payload, opts) => opts?.onSuccess?.(payload)),
      reset: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    });
  });

  it("does NOT clear the undo stack when the polished mirror fails (draft stays dirty)", async () => {
    // Mirror write fails → commit() must not checkpoint.
    useUpdatePolishedMock.mockReturnValue({
      mutate: vi.fn((_server, opts) => opts?.onError?.(new Error("500 store down"))),
      reset: vi.fn(),
      isPending: false,
      // Static isError drives the ``saveError`` derivation the curator sees.
      isError: true,
      error: new Error("500 store down"),
    });

    render(
      <DesignDraftProvider experimentId={ROUTE_ID} reviewer="cy">
        <CommitProbe />
      </DesignDraftProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("can-undo").textContent).toBe("no"),
    );

    fireEvent.click(screen.getByTestId("apply-btn"));
    expect(screen.getByTestId("can-undo").textContent).toBe("yes");

    fireEvent.click(screen.getByTestId("commit-btn"));
    // Checkpoint gated: the applied edit is still undoable, i.e. NOT
    // flushed to a clean checkpoint — the curator's work isn't silently
    // declared saved when the export store never got it.
    expect(screen.getByTestId("can-undo").textContent).toBe("yes");
    // …and the failure is surfaced, not swallowed to console.
    expect(screen.getByTestId("commit-error").textContent).toContain(
      "export store",
    );
  });

  it("clears the undo stack (clean checkpoint) once the polished mirror succeeds", async () => {
    useUpdatePolishedMock.mockReturnValue({
      mutate: vi.fn((_server, opts) => opts?.onSuccess?.()),
      reset: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    });

    render(
      <DesignDraftProvider experimentId={ROUTE_ID} reviewer="cy">
        <CommitProbe />
      </DesignDraftProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("can-undo").textContent).toBe("no"),
    );

    fireEvent.click(screen.getByTestId("apply-btn"));
    expect(screen.getByTestId("can-undo").textContent).toBe("yes");

    fireEvent.click(screen.getByTestId("commit-btn"));
    // Both writes landed → checkpoint runs → undo stack cleared.
    expect(screen.getByTestId("can-undo").textContent).toBe("no");
    expect(screen.getByTestId("commit-error").textContent).toBe("");
  });

  // ``onSettled`` (2026-07-27) — callers like the audit sidebar's
  // "commit & close" offer need to know when a commit finishes so
  // they can chain a follow-up action only on success.
  it("invokes onSettled with ok:true once the polished mirror succeeds", async () => {
    useUpdatePolishedMock.mockReturnValue({
      mutate: vi.fn((_server, opts) => opts?.onSuccess?.()),
      reset: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    });

    render(
      <DesignDraftProvider experimentId={ROUTE_ID} reviewer="cy">
        <CommitProbe />
      </DesignDraftProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("can-undo").textContent).toBe("no"),
    );

    fireEvent.click(screen.getByTestId("apply-btn"));
    fireEvent.click(screen.getByTestId("commit-with-callback-btn"));

    expect(screen.getByTestId("settled-result").textContent).toBe("ok");
  });

  it("invokes onSettled with the error when the polished mirror fails", async () => {
    useUpdatePolishedMock.mockReturnValue({
      mutate: vi.fn((_server, opts) => opts?.onError?.(new Error("500 store down"))),
      reset: vi.fn(),
      isPending: false,
      isError: true,
      error: new Error("500 store down"),
    });

    render(
      <DesignDraftProvider experimentId={ROUTE_ID} reviewer="cy">
        <CommitProbe />
      </DesignDraftProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("can-undo").textContent).toBe("no"),
    );

    fireEvent.click(screen.getByTestId("apply-btn"));
    fireEvent.click(screen.getByTestId("commit-with-callback-btn"));

    expect(screen.getByTestId("settled-result").textContent).toBe(
      "error:500 store down",
    );
  });

  it("invokes onSettled with an error when the /design PUT itself fails", async () => {
    useUpdateDesignMock.mockReturnValue({
      mutate: vi.fn((_payload, opts) =>
        opts?.onError?.(new Error("network down")),
      ),
      reset: vi.fn(),
      isPending: false,
      isError: true,
      error: new Error("network down"),
    });

    render(
      <DesignDraftProvider experimentId={ROUTE_ID} reviewer="cy">
        <CommitProbe />
      </DesignDraftProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("can-undo").textContent).toBe("no"),
    );

    fireEvent.click(screen.getByTestId("apply-btn"));
    fireEvent.click(screen.getByTestId("commit-with-callback-btn"));

    expect(screen.getByTestId("settled-result").textContent).toBe(
      "error:network down",
    );
  });
});

// ---------------------------------------------------------------------------
// Guard 4 — the Apply-All undo registry is invalidated by the draft
// lifecycle.
//
// ``appliedBatches`` snapshots the draft as it was BEFORE an "Apply
// All" so a single finding can be surgically undone. Those snapshots
// describe a pre-commit design, and the undo handler consults the
// registry BEFORE the per-finding snapshot — so a snapshot that
// outlives its draft silently wins and rewinds the design past work
// that already landed. Commit / discard / reload must drop them, for
// the same reason each already drops the undo+redo stacks.
// ---------------------------------------------------------------------------
describe("DesignDraftProvider — invalidates Apply-All undo snapshots", () => {
  const clearAppliedBatchesMock = clearAppliedBatches as ReturnType<
    typeof vi.fn
  >;

  function LifecycleProbe() {
    const { commit, discard, reload, draft } = useDesignDraft();
    return (
      <div>
        <span data-testid="draft-eid">{draft?.experiment_id ?? "null"}</span>
        <button data-testid="commit-btn" onClick={() => commit()} />
        <button data-testid="discard-btn" onClick={() => discard()} />
        <button data-testid="reload-btn" onClick={() => reload()} />
      </div>
    );
  }

  beforeEach(() => {
    useDesignMock.mockReturnValue({
      data: makeDesign(ROUTE_EID, "GSE253365"),
      isLoading: false,
      error: null,
    });
    useCurationsMock.mockReturnValue({ data: [], isLoading: false, error: null });
    resolveCurationMock.mockReturnValue(null);
  });

  async function renderSeeded() {
    render(
      // No ``reviewer`` — commit's polished mirror is skipped, so
      // ``finalizeCheckpoint`` runs straight off the /design success.
      <DesignDraftProvider experimentId={ROUTE_ID}>
        <LifecycleProbe />
      </DesignDraftProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("draft-eid").textContent).toBe(
        String(ROUTE_EID),
      ),
    );
  }

  it("clears the registry for this experiment on a successful commit", async () => {
    useUpdateDesignMock.mockReturnValue({
      mutate: vi.fn((design, opts) => opts?.onSuccess?.(design)),
      reset: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    });
    await renderSeeded();

    expect(clearAppliedBatchesMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("commit-btn"));
    expect(clearAppliedBatchesMock).toHaveBeenCalledWith(ROUTE_ID);
  });

  it("does NOT clear the registry when the commit fails", async () => {
    // The draft stays dirty and the curator retries — the Apply-All
    // mutations are still in the draft, so their undo must still work.
    useUpdateDesignMock.mockReturnValue({
      mutate: vi.fn((_design, opts) => opts?.onError?.(new Error("network down"))),
      reset: vi.fn(),
      isPending: false,
      isError: true,
      error: new Error("network down"),
    });
    await renderSeeded();

    fireEvent.click(screen.getByTestId("commit-btn"));
    expect(clearAppliedBatchesMock).not.toHaveBeenCalled();
  });

  it("clears the registry on discard", async () => {
    await renderSeeded();

    fireEvent.click(screen.getByTestId("discard-btn"));
    expect(clearAppliedBatchesMock).toHaveBeenCalledWith(ROUTE_ID);
  });

  it("clears the registry on reload (re-import)", async () => {
    await renderSeeded();

    fireEvent.click(screen.getByTestId("reload-btn"));
    expect(clearAppliedBatchesMock).toHaveBeenCalledWith(ROUTE_ID);
  });

  it("clears the paper-dismissal flags on reload (re-import)", async () => {
    // A re-import drops the auto-applied Publication row but keeps the
    // proposal; a surviving flag would suppress auto-apply forever.
    await renderSeeded();

    fireEvent.click(screen.getByTestId("reload-btn"));
    expect(clearPaperDismissals as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      ROUTE_ID,
    );
  });

  it("does NOT clear the paper-dismissal flags on a plain discard", async () => {
    // Discard undoes design edits; it does not re-import, so the
    // curator's "I already dealt with this paper" decision stands.
    await renderSeeded();

    fireEvent.click(screen.getByTestId("discard-btn"));
    expect(
      clearPaperDismissals as ReturnType<typeof vi.fn>,
    ).not.toHaveBeenCalled();
  });
});
