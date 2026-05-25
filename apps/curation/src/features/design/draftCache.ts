/**
 * Read-only helpers for the design-draft localStorage cache.
 *
 * The full write path lives in ``DesignDraftContext.tsx``. This
 * file is the slim read-side — used by list views (set navigator,
 * sets sidebar, workflow page) that need to know which experiments
 * have uncommitted draft edits *without* mounting the full provider
 * for every row.
 *
 * Contract that makes the disc reliable: the provider only writes
 * a localStorage entry when ``diffDesign(saved, draft).isDirty`` —
 * clean drafts clear the entry. So presence of a key under
 * ``DRAFT_KEY_PREFIX`` means the curator has uncommitted edits for
 * that experiment, no comparison required.
 */

/** Shared with ``DesignDraftContext.tsx``. Keep in sync — both
 *  files reference this string literal. */
export const DRAFT_KEY_PREFIX = "gca:draft:";

/** Return the set of ``experiment_id`` strings that currently have
 *  an uncommitted draft cached in localStorage. Cheap (one
 *  localStorage scan, no JSON parse) — safe to call from list-view
 *  render paths.
 *
 *  Returns string ids — workflow rows surface numeric ids, but the
 *  cache keys preserve whatever the caller passed in (numeric or
 *  string). Callers should stringify their lookup key. */
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
    // localStorage unavailable (privacy mode, SSR). Treat as "no
    // dirty drafts known" — the disc just falls back to the
    // server-side audit_status signal.
  }
  return dirty;
}
