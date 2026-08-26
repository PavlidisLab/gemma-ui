/**
 * The curation lock, through the agent.
 *
 * 🛑 **Advisory, and it must stay that way.** The lock drives this
 * chip and warns; it does NOT gate committing. Gemma's
 * `baseline.lastModified` 409 is the correctness guarantee. gembro's
 * §4, verbatim: *"the lock is a courtesy; the token is the contract"* —
 * so nothing here may grow into a permission check, and no caller may
 * read a held lock as authority to proceed or refuse.
 *
 * Stealing is always allowed and destroys nothing: the other curator's
 * DRAFT is a separate row and survives. The cost of a steal is that the
 * loser's next commit 409s on a stale baseline and they re-sync, which
 * is the protection everyone already has.
 *
 * No refresh call here. Gemma refreshes `EXPIRES_AT` server-side on
 * every draft PUT (`eb83d06202`), so the autosave holds the lease and
 * inactivity releases it — one signal, not two.
 *
 * Own top-level prefix, not `/rest` — see `api/curationDraft.ts` for
 * why that matters.
 */

import { api, ApiError } from "./client";

/** What the agent relays back from Gemma. Field-for-field. */
export interface CurationLock {
  locked: boolean;
  locked_by: string | null;
  locked_at: string | null;
  expires_at: string | null;
  /** Set when this lock was taken from someone. Survives on the row —
   *  it is the record of the steal, since lock/steal/release emit no
   *  audit event (they must not touch `curationDetails.lastUpdated`,
   *  which is the commit's concurrency token). */
  stolen_from: string | null;
  stolen_at: string | null;
}

/** A conflict on acquire: someone else holds it. */
export interface LockHeldBySomeoneElse {
  locked_by: string | null;
  locked_at: string | null;
  expires_at: string | null;
}

function lockPath(experimentId: number | string, curator?: string): string {
  const q = curator ? `?onBehalfOf=${encodeURIComponent(curator)}` : "";
  return `/curation-lock/${experimentId}${q}`;
}

export async function getCurationLock(
  experimentId: number | string,
): Promise<CurationLock> {
  return await api.get<CurationLock>(lockPath(experimentId));
}

/**
 * Take the lock. Resolves with the lock when granted.
 *
 * On 409 — held by someone else and `steal` was not set — returns the
 * holder rather than throwing, because "Alice has this" is an ordinary
 * answer the chip renders, not a failure.
 *
 * 🛑 The holder is read from the 409's OWN fields. It used to be
 * reachable only inside an upstream envelope nested as a JSON string,
 * which meant digging through a body to find a name — the
 * sentence-matching this codebase has spent two days removing. If
 * `locked_by` is ever absent again, the chip degrades to "someone else
 * is editing" rather than guessing.
 */
export async function acquireCurationLock(
  experimentId: number | string,
  curator: string,
  opts: { steal?: boolean } = {},
): Promise<
  | { granted: true; lock: CurationLock }
  | { granted: false; heldBy: LockHeldBySomeoneElse }
> {
  const steal = opts.steal ? "&steal=true" : "";
  try {
    const lock = await api.post<CurationLock>(
      `${lockPath(experimentId, curator)}${steal}`,
      {},
    );
    return { granted: true, lock };
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      const body = (e.body ?? {}) as Record<string, unknown>;
      const inner = (body.detail ?? body) as Record<string, unknown>;
      return {
        granted: false,
        heldBy: {
          locked_by: typeof inner.lockedBy === "string" ? inner.lockedBy : null,
          locked_at: typeof inner.lockedAt === "string" ? inner.lockedAt : null,
          expires_at:
            typeof inner.expiresAt === "string" ? inner.expiresAt : null,
        },
      };
    }
    throw e;
  }
}

/** Give it up. Releasing a lock you do not hold is not an error worth
 *  surfacing — the outcome the caller wanted (not holding it) is true
 *  either way. */
export async function releaseCurationLock(
  experimentId: number | string,
  curator: string,
): Promise<void> {
  try {
    await api.delete<unknown>(lockPath(experimentId, curator));
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 409)) return;
    throw e;
  }
}
