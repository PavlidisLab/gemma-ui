/**
 * Cross-component tracker for "Apply All" batches.
 *
 * The per-finding undo button lives inside ``FindingActionRow`` and
 * historically reverted the draft via a per-card ``useState`` snapshot
 * captured in ``handleApply``. That works fine when the curator
 * applied that one finding from the row — its own state has the
 * pre-apply snapshot.
 *
 * It doesn't work when the apply ran from the panel-level "Apply All"
 * button: the row's local state is empty, so undo only PATCHed the
 * disposition back to ``pending`` without reverting the draft slice.
 * Visible result for the curator: "I clicked undo and the design
 * didn't revert" — bug.
 *
 * This module is the shared lookup. Apply All registers one batch
 * keyed by each finding's ``target_id`` (all entries point to the
 * same batch object). Per-finding undo asks here first; if a batch
 * is found, it reconstructs the draft from the batch's pre-mutation
 * snapshot plus every OTHER finding's mutator, leaving the undone
 * finding's contribution out.
 *
 * The replay-others semantic is the "surgical" undo: undoing one
 * finding from a batch reverts only that one's mutation, with the
 * rest of the batch's mutations re-applied so siblings' "accepted"
 * dispositions still match the draft.
 */
import type { Design } from "@/features/experiment/types";

interface BatchEntry {
  /** Snapshot of the draft as it was just before the batch ran.
   *  Replayed as the base when reconstructing the draft on undo. */
  snapshot: Design;
  /** Mutations that make up the batch, in apply order. Mutated in
   *  place when a finding is undone — that finding's mutator is
   *  removed so siblings still pointing at this same batch see the
   *  shortened list. */
  mutations: Array<{ targetId: string; mutate: (d: Design) => Design }>;
}

const batches: Map<string, BatchEntry> = new Map();

/** Register a multi-finding apply batch. All findings in
 *  ``mutations`` share the same ``snapshot`` reference. */
export function registerAppliedBatch(
  snapshot: Design,
  mutations: Array<{ targetId: string; mutate: (d: Design) => Design }>,
): void {
  if (mutations.length === 0) return;
  const batch: BatchEntry = {
    snapshot,
    mutations: mutations.slice(),
  };
  for (const m of mutations) {
    batches.set(m.targetId, batch);
  }
}

/** Return an ``applyDraft`` mutator that reconstructs the draft
 *  with the given finding's contribution removed (snapshot + every
 *  other batch member's mutator re-applied in order). Returns null
 *  when ``targetId`` isn't part of any tracked batch.
 *
 *  Side effect: drops the target from the shared batch so siblings'
 *  undo replays don't re-include it. */
export function undoBatched(
  targetId: string,
): ((d: Design) => Design) | null {
  const batch = batches.get(targetId);
  if (!batch) return null;
  batch.mutations = batch.mutations.filter((m) => m.targetId !== targetId);
  batches.delete(targetId);
  const remaining = batch.mutations;
  const snapshot = batch.snapshot;
  return () => {
    let d = snapshot;
    for (const m of remaining) d = m.mutate(d);
    return d;
  };
}

/** Drop every tracked batch. Snapshots reference pre-commit drafts
 *  and become stale once the curator commits — call this from the
 *  commit success path or on unmount. */
export function clearAppliedBatches(): void {
  batches.clear();
}
