/**
 * @vitest-environment jsdom
 *
 * BatchRunnerPanel: a finished preview has to SHOW what it found.
 *
 *  Amanda, 2026-10-29: "Nothing happens when I click preview" — the request, the run
 *  and the reply all worked (ticket #49, events 1385/1386), but the only change on the
 *  page was a timestamp. */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastContext } from "@/components/ui/Toast";
import type { BatchState } from "@/api/batchRunner";

const state: { current: BatchState } = { current: { latest: null, pending: [], auto: { on: false, interval_hours: 6, agent_runs: 0 } } };
const mutate = vi.fn();

const runner: { current: unknown } = { current: null };

vi.mock("@/api/batchRunner", async (orig) => ({
  nextRunBreakdown: (await orig<typeof import("@/api/batchRunner")>()).nextRunBreakdown,
  STEP_LABELS: (await orig<typeof import("@/api/batchRunner")>()).STEP_LABELS,
  useRunnerStatus: () => ({ data: runner.current }),
  batchControlsAvailable: () => true,
  useBatchState: () => ({ data: state.current, isLoading: false }),
  usePostBatchRequest: () => ({ mutate, isPending: false, isError: false, data: { kicked: true } }),
}));

import { BatchRunnerPanel } from "./BatchRunnerPanel";

const reply = (eventId: number): BatchState => ({
  pending: [], auto: { on: false, interval_hours: 6, agent_runs: 0 },
  latest: {
    kind: "preview", request_event_id: eventId - 1, at: "2026-10-29T22:08:23Z", who: "amaximo",
    next_label: "Land in Gemma", counts: { "next: add_geo_data": 1, "needs a person: curator_review": 1 },
    auto: { on: false }, error: "", event_id: eventId,
    experiments: [
      { accession: "GSE345470", eid: "", stage: "landed", action: "add_geo_data", decision: "run", outcome: "dry_run", detail: "" },
      { accession: "GSE344711", eid: "93639", stage: "design_curated", action: "curator_review", decision: "human", outcome: "", detail: "curator reviews the proposal" },
    ],
  },
});

function renderPanel(show = vi.fn()) {
  return render(
    <ToastContext.Provider value={{ show }}>
      <BatchRunnerPanel ticketId={49} who="amaximo" included={16} />
    </ToastContext.Provider>,
  );
}

describe("BatchRunnerPanel", () => {
  beforeEach(() => {
    mutate.mockReset();
    runner.current = null;
    state.current = reply(1384);
  });

  it("opens the report and toasts when the reply to a click arrives", async () => {
    const show = vi.fn();
    const { rerender } = renderPanel(show);
    expect(screen.queryByText("GSE345470")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Preview next steps" }));
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ action: "preview" }));
    state.current = reply(1386);
    await act(async () => {
      rerender(
        <ToastContext.Provider value={{ show }}>
          <BatchRunnerPanel ticketId={49} who="amaximo" included={16} />
        </ToastContext.Provider>,
      );
    });
    expect(screen.getByText("GSE345470")).toBeTruthy();
    expect(screen.getByText(/curator reviews the proposal/)).toBeTruthy();
    expect(show).toHaveBeenCalledWith(expect.stringContaining('Preview ready: next step "Land in Gemma"'), "success");
  });

  it("names the next step on the run button and says what it advances", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: "Land in Gemma" })).toBeTruthy();
    expect(screen.getByText(/advance the 16 experiments marked Include/)).toBeTruthy();
    expect(screen.getByText(/1 land in Gemma/)).toBeTruthy();
  });

  it("locks every button while a run is going, and says which step it is on", () => {
    state.current = { ...reply(1384), pending: [{ id: 1390, action: "run", who: "amaximo" }] };
    runner.current = { running: true, mode: "apply", finished: false,
                       step: { i: 3, n: 25, accession: "GSE335985", decision: "run", action: "add_geo_data" } };
    renderPanel();
    for (const name of ["Preview next steps", "Run requested…", "Auto-continue"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByText(/step 3 of 25 — GSE335985, land in gemma/)).toBeTruthy();
  });
});
