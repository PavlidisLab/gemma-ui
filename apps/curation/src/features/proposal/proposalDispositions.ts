/**
 * Per-element disposition state for the new proposal-review surface.
 *
 * Vision (Paul 2026-05-21): the proposal seeds the design draft on
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

export function factorElementKey(proposalId: string, idx: number): ProposalElementKey {
  return `factor:${proposalId}:${idx}`;
}

export function tagElementKey(proposalId: string, idx: number): ProposalElementKey {
  return `tag:${proposalId}:${idx}`;
}

const LS_PREFIX = "gemma-proposal-dispositions";
const LS_NOTES_PREFIX = "gemma-proposal-disposition-notes";
const LS_FEEDBACK_PREFIX = "gemma-proposal-feedback";

function storageKey(experimentId: number, proposalId: string): string {
  return `${LS_PREFIX}:${experimentId}:${proposalId}`;
}

function notesStorageKey(experimentId: number, proposalId: string): string {
  return `${LS_NOTES_PREFIX}:${experimentId}:${proposalId}`;
}

function feedbackStorageKey(experimentId: number, proposalId: string): string {
  return `${LS_FEEDBACK_PREFIX}:${experimentId}:${proposalId}`;
}

export type DispositionMap = Map<ProposalElementKey, ProposalDisposition>;
export type NoteMap = Map<ProposalElementKey, string>;

export function loadDispositions(
  experimentId: number,
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
  experimentId: number,
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
  experimentId: number,
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
  experimentId: number,
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
  experimentId: number,
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
  experimentId: number,
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

export function clearDispositionsForExperiment(experimentId: number): void {
  try {
    const prefix = `${LS_PREFIX}:${experimentId}:`;
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(prefix)) toRemove.push(k);
    }
    for (const k of toRemove) window.localStorage.removeItem(k);
  } catch {
    // ignore
  }
}
