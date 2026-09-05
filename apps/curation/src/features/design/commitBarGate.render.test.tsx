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

describe("commit gate — a missing baseline is a NOTE, not a gate", () => {
  /**
   * 🛑 **This file used to assert the opposite, and the reversal is
   * Paul's.**
   *
   * 2026-08-19 he said of the tick: *"we have a sign off, you check a
   * box, I think that's okay"*, and these tests pinned that — blocked
   * while unticked, every blocked factor needing its own tick, the
   * override passed through to `onCommit`.
   *
   * 2026-09-04 he reversed it: *"most of the time the UI shouldn't be
   * demanding a baseline, as you say individual … not defining a
   * baseline is only a soft warning, not a blocker, because Gemma tries
   * to figure it out anyway."*
   *
   * Both quotes are kept because the second only makes sense against
   * the first, and because a later reader finding the old behaviour in
   * git should see it was removed on purpose rather than lost.
   *
   * The reversal also killed a real bug: the tick sent
   * `baselineRelevance` on `FactorCommit`, a field Gemma has no slot
   * for, so the whole commit 400ed — including edits with nothing to do
   * with baselines. Paul hit that deleting a factor value on GSE32473.
   */
  it("does NOT block when no baseline is marked", () => {
    const { commit } = renderBar(validation([factorState({})]));
    expect((commit as HTMLButtonElement).disabled).toBe(false);
  });

  it("offers no tick to override, because there is nothing to override", () => {
    renderBar(validation([factorState({})]));
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("commits with no overrides, whatever the baseline state", () => {
    // 🛑 The empty array is the point: sending `baselineRelevance` is
    // what 400ed the commit.
    const { commit, onCommit } = renderBar(validation([factorState({})]));
    fireEvent.click(commit);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0]).toEqual([]);
  });

  it("several factors with no baseline still do not block", () => {
    const { commit } = renderBar(
      validation([factorState({}), factorState({ factor_id: 9 })]),
    );
    expect((commit as HTMLButtonElement).disabled).toBe(false);
  });

  it("🛑 a HARD problem still blocks — this did not soften everything", () => {
    const { commit } = renderBar(
      validation([
        factorState({
          ungrounded_categories: [
            { scope: "factor", label: "collection of material" },
          ],
        }),
      ]),
    );
    expect((commit as HTMLButtonElement).disabled).toBe(true);
  });

  it("neither marked nor resolvable → still commits", () => {
    // The genuinely ambiguous case — 16 of the 33 that reach here are
    // `timepoint`, bare durations where no control term applies. Gemma
    // infers, and `isBaseline: null` is what asks it to.
    const { commit } = renderBar(
      validation([
        factorState({ baseline_count: 0, baseline_satisfied: false }),
      ]),
    );
    expect((commit as HTMLButtonElement).disabled).toBe(false);
  });
});
