/**
 * @vitest-environment jsdom
 *
 * The commit gate: what blocks, what a tick unblocks, and what a tick
 * must NOT unblock.
 *
 * Reported 2026-08-09: "collection of material doesn't need a baseline,
 * and even when I say that, I can't commit". The category half is fixed
 * in `NO_BASELINE_CATEGORIES` (that factor no longer reaches the gate).
 * These tests pin the second half — the override path itself — because
 * it had no coverage and a curator who ticks a box and sees nothing
 * happen has no way to tell which of the two gates is holding them.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommitBar } from "./CommitBar";
import type { DesignDiff } from "./diff";
import type {
  Design,
  DesignValidationState,
  FactorValidationState,
} from "@/features/experiment/types";

afterEach(cleanup);

const DIFF = {
  isDirty: true,
  factorsAdded: [],
  factorsRemoved: [],
  factorsChanged: [],
  tags: { added: [], removed: [], modified: [] },
  metadata: {
    biomaterialsModified: 0,
    publicationsAdded: 0,
    publicationsRemoved: 0,
    shortNameChanged: false,
  },
  totals: { addedFvs: 0, modifiedFvs: 0, removedFvs: 0 },
} as unknown as DesignDiff;

const factorState = (
  patch: Partial<FactorValidationState>,
): FactorValidationState =>
  ({
    factor_id: 7,
    baseline_count: 0,
    baseline_required: true,
    baseline_blocks_commit: true,
    baseline_uncertain: false,
    baseline_uncertain_reason: "",
    unassigned_biomaterials: [],
    duplicate_assignments: [],
    ungrounded_categories: [],
    unknown_predicates: 0,
    ...patch,
  }) as unknown as FactorValidationState;

const validation = (
  factors: FactorValidationState[],
): DesignValidationState => ({ factors, ok: false });

const DRAFT = {
  experiment_id: 1,
  experiment_short_name: "GSE1",
  factors: [
    {
      id: 7,
      name: "collection of material",
      category: { label: "collection of material", uri: null },
      description: "",
      type: "categorical",
      factor_values: [],
    },
  ],
  biomaterials: [],
  tags: [],
} as unknown as Design;

function renderBar(v: DesignValidationState) {
  const onCommit = vi.fn();
  render(
    <CommitBar
      diff={DIFF}
      saving={false}
      saveError={null}
      validation={v}
      draft={DRAFT}
      onCommit={onCommit}
      onDiscard={() => {}}
    />,
  );
  const commit = screen.getByRole("button", { name: /^commit$/i });
  return { commit, onCommit };
}

describe("commit gate — baseline override", () => {
  it("blocks while a baseline gate is unticked", () => {
    const { commit } = renderBar(validation([factorState({})]));
    expect((commit as HTMLButtonElement).disabled).toBe(true);
  });

  it("a tick unblocks commit, and passes the override through", () => {
    const { commit, onCommit } = renderBar(validation([factorState({})]));
    fireEvent.click(screen.getByRole("checkbox"));
    expect((commit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(commit);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0]).toEqual([
      { factorId: 7, factorLabel: "collection of material", reason: "" },
    ]);
  });

  it("needs EVERY blocked factor ticked, not just one", () => {
    const { commit } = renderBar(
      validation([factorState({}), factorState({ factor_id: 9 })]),
    );
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect((commit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    expect((commit as HTMLButtonElement).disabled).toBe(false);
  });

  it("a tick does NOT unblock a hard problem — and the reason is on screen", () => {
    // The curator's confusion in the report: ticking the override and
    // nothing happens. If a hard problem is what's holding the commit,
    // the bar has to say so rather than leave the tick looking broken.
    const { commit } = renderBar(
      validation([
        factorState({
          ungrounded_categories: [{ label: "collection of material" }],
        } as Partial<FactorValidationState>),
      ]),
    );
    fireEvent.click(screen.getByRole("checkbox"));
    expect((commit as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Fix to commit:/i)).toBeTruthy();
    expect(screen.getByText(/category is free text/i)).toBeTruthy();
  });

  it("no gate at all → commit is live", () => {
    const { commit } = renderBar(
      validation([factorState({ baseline_count: 1 })]),
    );
    expect((commit as HTMLButtonElement).disabled).toBe(false);
  });
});
