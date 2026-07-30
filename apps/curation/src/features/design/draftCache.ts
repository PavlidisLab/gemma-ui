/**
 * The design-draft localStorage cache.
 *
 * Drafts survive a browser refresh. We key by experiment id and store
 * the draft alongside a hash of the saved baseline at cache time — on
 * restore, if the server's saved Design has moved on (someone else
 * committed, or the curator re-imported / a calibration batch reloaded),
 * we treat the cache as stale and ignore it rather than diff against a
 * baseline that no longer matches.
 *
 * This file owns the cache primitives (read / write / clear / hash) so
 * they live in ONE place. ``DesignDraftContext.tsx`` — the full write
 * path with undo/redo/commit — imports them here; list views (set
 * navigator, sets sidebar, workflow page) that only need "which
 * experiments have uncommitted edits" use ``readDirtyExperimentIds``
 * without mounting the provider.
 *
 * Contract that makes the disc reliable: the provider only writes a
 * localStorage entry when ``diffDesign(saved, draft).isDirty`` — clean
 * drafts clear the entry. So presence of a key under
 * ``DRAFT_KEY_PREFIX`` normally means uncommitted edits, no comparison
 * required. The one exception is a STALE key: the server was re-saved
 * since the draft was cached, so the entry no longer reflects a real
 * pending edit. Such a key only self-heals when the provider mounts for
 * that experiment (mount effect discards it) — until then it inflates
 * dirty counts and the ticket-export warning. ``reconcileDirtyExperiment``
 * is the eager version of that same check for surfaces (export, close)
 * that have the server design in hand.
 */

import { diffDesign } from "./diff";
import type { Design } from "@/features/experiment/types";

/** Shared prefix for every cached-draft localStorage key. */
export const DRAFT_KEY_PREFIX = "gca:draft:";

export interface CachedDraft {
  baselineHash: string;
  cachedAt: string;
  draft: Design;
}

/** FNV-1a, 32-bit. Cheap and dependency-free; collisions don't matter
 *  here — we only use this to detect baseline changes, not for security.
 *
 *  This MUST produce the same hash the provider wrote as
 *  ``baselineHash``, and it hashes the ``/design`` snapshot the
 *  editor seeds from (NOT the ``/polished`` mirror). Reconciliation
 *  callers must fetch the same ``/design`` endpoint or every key reads
 *  as stale. */
export function hashDesign(d: Design | null | undefined): string {
  if (!d) return "";
  const s = JSON.stringify(d);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16);
}

export function readCachedDraft(
  experimentId: number | string,
): CachedDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY_PREFIX + experimentId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedDraft;
    if (!parsed.draft || !parsed.baselineHash) return null;
    // Reject entries where the cached draft is for a different
    // experiment than the key. Pre-2c14caf, the provider could swap
    // experimentId without unmounting, and the persist effect would
    // write the previous experiment's draft under the new key. The
    // baselineHash check on rehydrate doesn't catch it (the hash is
    // of the *new* saved at write-time, not of the draft).
    //
    // Coerce both sides to String before comparing:
    // ``parsed.draft.experiment_id`` is a NUMBER, ``experimentId`` is
    // the route STRING (``route.id`` from ``routes.ts:87``), so a bare
    // ``!==`` was always true — it discarded *every* cached draft for
    // every experiment, silently killing resume-mid-edit AND never
    // actually running the cross-experiment guard the comment
    // describes. Mirrors the String() compare
    // the audit-focus handler already does at ``App.tsx:469``.
    if (
      parsed.draft.experiment_id != null &&
      String(parsed.draft.experiment_id) !== String(experimentId)
    ) {
      window.localStorage.removeItem(DRAFT_KEY_PREFIX + experimentId);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeCachedDraft(
  experimentId: number | string,
  baselineHash: string,
  draft: Design,
): void {
  try {
    const payload: CachedDraft = {
      baselineHash,
      cachedAt: new Date().toISOString(),
      draft,
    };
    window.localStorage.setItem(
      DRAFT_KEY_PREFIX + experimentId,
      JSON.stringify(payload),
    );
  } catch {
    // Quota / privacy mode / SSR — survivable, the in-memory draft
    // still works as before.
  }
}

export function clearCachedDraft(experimentId: number | string): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY_PREFIX + experimentId);
  } catch {
    // ignore
  }
}

/** Return the set of ``experiment_id`` strings that currently have a
 *  cached draft in localStorage. Cheap (one localStorage scan, no JSON
 *  parse) — safe to call from list-view render paths.
 *
 *  Returns string ids — workflow rows surface numeric ids, but the cache
 *  keys preserve whatever the caller passed in (numeric or string).
 *  Callers should stringify their lookup key.
 *
 *  Caveat: this trusts key PRESENCE. A stale key (server re-saved since
 *  the draft was cached) reports as dirty until the provider mounts for
 *  that experiment or ``reconcileDirtyExperiment`` runs. Surfaces that
 *  gate real work on the signal (ticket export / close) should reconcile
 *  against the live server design; a mere count chip can tolerate the
 *  transient over-count. */
export function readDirtyExperimentIds(): Set<string> {
  const dirty = new Set<string>();
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(DRAFT_KEY_PREFIX)) {
        dirty.add(k.slice(DRAFT_KEY_PREFIX.length));
      }
    }
  } catch {
    // localStorage unavailable (privacy mode, SSR). Treat as "no dirty
    // drafts known" — the disc just falls back to the server-side
    // audit_status signal.
  }
  return dirty;
}

/** Eager staleness check for one experiment's cached draft, mirroring
 *  ``DesignDraftContext``'s mount effect exactly:
 *
 *   - No cached draft            → not dirty.
 *   - Baseline drifted (the hash of the passed server ``/design`` no
 *     longer matches the cached ``baselineHash``) → the provider would
 *     DISCARD this cache as stale on open, NOT treat it as a pending
 *     edit. Clear the key and report not-dirty.
 *   - Baseline matches but the cached draft equals the saved design
 *     (a no-op key that never got cleared) → clear + not dirty.
 *   - Otherwise → a genuine uncommitted edit. Keep the key, report dirty.
 *
 *  ``serverDesign`` MUST be the ``/design`` snapshot the editor seeds
 *  from (see ``hashDesign``), not the ``/polished`` mirror. Clearing a
 *  stale/no-op key here is safe: the mount effect does the same, and a
 *  drifted draft is unrecoverable — the app throws it away regardless. */
export function reconcileDirtyExperiment(
  experimentId: number | string,
  serverDesign: Design,
): boolean {
  const cached = readCachedDraft(experimentId);
  if (!cached) return false;
  if (cached.baselineHash !== hashDesign(serverDesign)) {
    clearCachedDraft(experimentId);
    return false;
  }
  if (!diffDesign(serverDesign, cached.draft).isDirty) {
    clearCachedDraft(experimentId);
    return false;
  }
  return true;
}
