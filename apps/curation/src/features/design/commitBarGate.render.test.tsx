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

/** 🛑 ``baseline_satisfied`` DERIVES from ``baseline_count`` unless a
 *  test states otherwise, because the real producer computes it as
 *  ``count >= 1 || gemmaDetects``. A fixture free to set a count of 1
 *  alongside ``satisfied: false`` describes a state nothing can produce,
 *  and a gate tested against an impossible state proves nothing. Pass
 *  ``baseline_satisfied`` explicitly for the case that matters: count 0,
 *  satisfied anyway, because Gemma resolved it. */
const factorState = (
  patch: Partial<FactorValidationState>,
): FactorValidationState => {
  const base = {
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
  };
  return {
    baseline_satisfied: (base.baseline_count ?? 0) >= 1,
    ...base,
  } as unknown as FactorValidationState;
};

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

  /**
   * 🛑 Marking a baseline is a nice-to-have, not a requirement.
   *
   * Gemma does not need an FV flagged to run a DEA against it: its own
   * detector falls back to a level whose statements read as a control.
   * A factor Gemma already resolves has a reference, so asking the
   * curator to mark one is asking for work that changes nothing.
   *
   * Measured on 100 gemma2 datasets: of 136 factors this gate applies
   * to, Gemma resolves 103 (76%). Gating on the raw MARKED count asked
   * for all 136 in remote mode, where nothing is ever marked — Gemma
   * has never set `isBaseline` for anyone. An override on everything
   * trains people to tick without reading, which is worse than no gate.
   */
  it("Gemma resolved it → nothing marked, and no gate", () => {
    const { commit } = renderBar(
      validation([
        factorState({ baseline_count: 0, baseline_satisfied: true }),
      ]),
    );
    expect((commit as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("neither marked nor resolvable → still asks, with the sign-off", () => {
    // The genuinely ambiguous case, which is where defining a baseline
    // earns its keep. 16 of the 33 that reach here are `timepoint` —
    // bare durations, "2 h" beside "6 h", where no control term applies.
    const { commit } = renderBar(
      validation([
        factorState({ baseline_count: 0, baseline_satisfied: false }),
      ]),
    );
    expect((commit as HTMLButtonElement).disabled).toBe(true);
    // Tickable, not a hard block — Paul: "we have a sign off, you check
    // a box, I think that's okay".
    fireEvent.click(screen.getByRole("checkbox"));
    expect((commit as HTMLButtonElement).disabled).toBe(false);
  });
});
