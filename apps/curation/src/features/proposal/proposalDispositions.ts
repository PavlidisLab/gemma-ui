/**
 * Per-element disposition state for the new proposal-review surface.
 *
 * Vision (design review 2026-05-21): the proposal seeds the design draft on
 * arrival. Curators review per-element rather than as a single big
 * card — for each proposed factor / tag they pick one of:
 *
 *   - ``retained``  — agent's proposal is correct, keep as-is
 *   - ``edited``    — kept the element but tweaked it (URI swap,
 *                     FV relabel, etc.). Detected by diffing the
 *                     draft element vs. the original proposal at
 *                     proposal-arrival time. NOT user-pickable;
 *                     derived from the draft state.
 *   - ``rejected``  — element removed from the design
 *   - ``parked``    — defer the decision; commit gate still active
 *
 * The four-way state gets sent back to the agent for learning
 * (rejection-rate, edit signal, hold-time), so distinguishing
 * "retained" from "edited" matters.
 *
 * For Phase 1 we persist pending/retained/rejected/parked in
 * localStorage scoped by (experiment_id, proposal_id). "Edited" is
 * derived at render-time once we plumb the draft diff in. Storage
 * mirrors ``paperDismissal.ts`` — scope-by-experiment, clear on
 * Reset (handled by callers).
 */

export type ProposalDisposition =
  | "pending"
  | "retained"
  | "edited"
  | "rejected"
  | "parked";

/** Stable identity of a single proposed element. Same idea as the
 *  audit's ``target_id`` slug but scoped to one proposal. */
export type ProposalElementKey = string;

/** Build a stable key from a proposed factor. Keys on category URI
 *  when present (most stable across runs); falls back to a
 *  normalised category label so a free-text-only factor still gets
 *  a deterministic identity. NOT keyed on list index — the agent
 *  can re-emit a proposal with re-ordered factors, and the prior
 *  ``factor:<id>:0`` LS entry would silently target a different
 *  factor (continuity sweep 2026-06-13). */
export function factorElementKey(
  proposalId: string,
  factor: { category?: { uri?: string | null; label?: string | null } | null },
): ProposalElementKey {
  const uri = (factor.category?.uri ?? "").trim();
  if (uri) return `factor:${proposalId}:uri:${uri.toLowerCase()}`;
  const label = (factor.category?.label ?? "").trim().toLowerCase();
  return `factor:${proposalId}:lbl:${label || "?"}`;
}

/** Build a stable key from a proposed tag. Keys on the (category,
 *  value) URI pair when present; falls back to lowercased label
 *  composite. Same rationale as ``factorElementKey``. */
export function tagElementKey(
  proposalId: string,
  tag: {
    category?: { uri?: string | null; label?: string | null } | null;
    value?: { uri?: string | null; label?: string | null } | null;
  },
): ProposalElementKey {
  const cUri = (tag.category?.uri ?? "").trim();
  const vUri = (tag.value?.uri ?? "").trim();
  if (cUri && vUri) {
    return `tag:${proposalId}:uri:${cUri.toLowerCase()}|${vUri.toLowerCase()}`;
  }
  const cLbl = (tag.category?.label ?? "").trim().toLowerCase();
  const vLbl = (tag.value?.label ?? "").trim().toLowerCase();
  return `tag:${proposalId}:lbl:${cLbl}|${vLbl}`;
}

// Bumped 2026-06-13 from the index-keyed encoding to the URI-keyed
// one above. Old LS entries silently roll off the next time the
// curator dispositions; the index-based prefix wouldn't deserialize
// into the new key shape anyway.
const LS_PREFIX = "gemma-proposal-dispositions.v2";
const LS_NOTES_PREFIX = "gemma-proposal-disposition-notes.v2";
const LS_FEEDBACK_PREFIX = "gemma-proposal-feedback";

function storageKey(experimentId: number | string, proposalId: string): string {
  return `${LS_PREFIX}:${experimentId}:${proposalId}`;
}

function notesStorageKey(experimentId: number | string, proposalId: string): string {
  return `${LS_NOTES_PREFIX}:${experimentId}:${proposalId}`;
}

function feedbackStorageKey(experimentId: number | string, proposalId: string): string {
  return `${LS_FEEDBACK_PREFIX}:${experimentId}:${proposalId}`;
}

export type DispositionMap = Map<ProposalElementKey, ProposalDisposition>;
export type NoteMap = Map<ProposalElementKey, string>;

export function loadDispositions(
  experimentId: number | string,
  proposalId: string,
): DispositionMap {
  try {
    const raw = window.localStorage.getItem(storageKey(experimentId, proposalId));
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, ProposalDisposition>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

export function saveDispositions(
  experimentId: number | string,
  proposalId: string,
  map: DispositionMap,
): void {
  try {
    const obj: Record<string, ProposalDisposition> = {};
    for (const [k, v] of map.entries()) obj[k] = v;
    window.localStorage.setItem(
      storageKey(experimentId, proposalId),
      JSON.stringify(obj),
    );
  } catch {
    // localStorage unavailable / quota — silently no-op. Worst case
    // the curator re-picks dispositions on next load.
  }
}

export function loadNotes(
  experimentId: number | string,
  proposalId: string,
): NoteMap {
  try {
    const raw = window.localStorage.getItem(
      notesStorageKey(experimentId, proposalId),
    );
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, string>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

export function saveNotes(
  experimentId: number | string,
  proposalId: string,
  map: NoteMap,
): void {
  try {
    const obj: Record<string, string> = {};
    for (const [k, v] of map.entries()) {
      if (v && v.trim().length > 0) obj[k] = v;
    }
    window.localStorage.setItem(
      notesStorageKey(experimentId, proposalId),
      JSON.stringify(obj),
    );
  } catch {
    // ignore
  }
}

/**
 * Proposal-wide free-text feedback the curator captures while
 * reviewing — mirrors the textarea v2's ProposalCardV2 used to expose.
 * Persisted per (experiment, proposal) in localStorage; submit-wire
 * (redo with notes / accept / reject) lives one layer up.
 */
export function loadFeedback(
  experimentId: number | string,
  proposalId: string,
): string {
  try {
    return (
      window.localStorage.getItem(
        feedbackStorageKey(experimentId, proposalId),
      ) ?? ""
    );
  } catch {
    return "";
  }
}

export function saveFeedback(
  experimentId: number | string,
  proposalId: string,
  value: string,
): void {
  try {
    const key = feedbackStorageKey(experimentId, proposalId);
    if (value && value.trim().length > 0) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

/** Drop the entire proposal-review localStorage footprint (dispositions
 *  + notes + feedback) for one experiment. Used by the commit-undo and
 *  per-finding-undo paths so curator state across surfaces stays
 *  coherent: rolling back the design draft / a disposition while
 *  leaving the proposal cards stuck on "retained" / "rejected" was
 *  the bug the reviewer flagged 2026-06-10. */
export function clearAllProposalStateForExperiment(
  experimentId: number | string,
): void {
  const prefixes = [
    `${LS_PREFIX}:${experimentId}:`,
    `${LS_NOTES_PREFIX}:${experimentId}:`,
    `${LS_FEEDBACK_PREFIX}:${experimentId}:`,
  ];
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && prefixes.some((p) => k.startsWith(p))) toRemove.push(k);
    }
    for (const k of toRemove) window.localStorage.removeItem(k);
  } catch {
    // ignore
  }
}

/** Window-level event bus the in-memory React state in
 *  ``ProposalSidebarPanel`` subscribes to. Undo paths in the design
 *  editor + audit sidebar dispatch this so the panel can flush its
 *  in-memory dispositions/notes/feedback without each undo site
 *  having to know which proposal id is currently mounted. */
const PROPOSAL_STATE_RESET_EVENT = "gemma:proposal-state-reset";

interface ProposalStateResetDetail {
  experimentId: string;
}

export function notifyProposalStateReset(
  experimentId: number | string,
): void {
  try {
    const detail: ProposalStateResetDetail = {
      experimentId: String(experimentId),
    };
    window.dispatchEvent(
      new CustomEvent(PROPOSAL_STATE_RESET_EVENT, { detail }),
    );
  } catch {
    // SSR / no-window — listeners are React effects, so a missing
    // dispatch just means no in-memory reset; LS was already wiped
    // by the caller.
  }
}

/** Subscribe to proposal-state-reset broadcasts. ``handler`` fires
 *  with the experimentId the reset targets; the listener decides
 *  whether the event matches its own scope. Returns an unsubscribe
 *  function suitable for a ``useEffect`` cleanup. */
export function onProposalStateReset(
  handler: (experimentId: string) => void,
): () => void {
  const fn = (e: Event) => {
    const detail = (e as CustomEvent<ProposalStateResetDetail>).detail;
    if (detail?.experimentId) handler(detail.experimentId);
  };
  try {
    window.addEventListener(PROPOSAL_STATE_RESET_EVENT, fn);
  } catch {
    return () => {};
  }
  return () => {
    try {
      window.removeEventListener(PROPOSAL_STATE_RESET_EVENT, fn);
    } catch {
      // ignore
    }
  };
}
