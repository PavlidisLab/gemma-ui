/**
 * The curation lock, through the agent.
 *
 * 🛑 **The lock GATES committing now.** `CommitBar` blocks it
 * client-side (`0df972b`) and Gemma refuses the write server-side with
 * a 409 `LOCK_REQUIRED` naming the holder (`2acff27319`). This header
 * used to read *"Advisory, and it must stay that way … no caller may
 * read a held lock as authority to proceed or refuse"* — that described
 * the era before the reversal and is now false. Do not restore it.
 *
 * 🛑 What SURVIVED the reversal: `baseline.lastModified` is still the
 * correctness guarantee and its 409 still has to be handled. The lock
 * decides whether a write is PERMITTED, the token whether it is SAFE;
 * the gate answers only the first, and cannot answer the second — it is
 * per-dataset and coarse where `lastModified` is per-content and exact.
 * Removing the baseline check because "the lock handles it" is the bug.
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
  /** What the holder IS, when the holder is not a person.
   *
   *  🛑 **Null for a person, and that absence is the signal** — a curator
   *  taking a lock from the UI supplies neither, so "no `run_id`" means a
   *  human. That is the whole wait-or-steal distinction: `alice` tells a
   *  blocked curator nothing, `proposer` running
   *  `category-policy-rebuild-2026-08-09` tells them to wait rather than
   *  steal. Stored ON the lock rather than joined from the holder's
   *  draft, because a batch takes its locks BEFORE doing the work — a
   *  join would answer exactly when the answer stopped being needed. */
  run_id?: string | null;
  agent_name?: string | null;
}

/** One dataset currently under curation, for the cross-experiment views
 *  (the curator dashboard, the admin summary). The lock itself plus
 *  enough identity to render a row without a second fetch. */
export interface ActiveCurationLock extends CurationLock {
  experiment_id: number;
  experiment_short_name?: string | null;
}

/** The listing is not built yet on either side — see
 *  `UIB_TO_ALL_2026_08_27_WHATS_UNDER_CURATION_NEEDS_THE_INVERSE_QUERY`.
 *
 *  🛑 A 404 here means "the route does not exist", which is NOT the same
 *  as "nothing is under curation" — those render as different states and
 *  must never collapse into one. An empty list is a real answer about a
 *  quiet corpus; this sentinel is the absence of an answer. */
export const LOCKS_ROUTE_ABSENT = Symbol("curation-locks-route-absent");
export type ActiveLocksResult =
  | ActiveCurationLock[]
  | typeof LOCKS_ROUTE_ABSENT;

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


/**
 * Everything currently held — the INVERSE of `getCurationLock`, which
 * answers about one dataset you already named.
 *
 * 🛑 The built Gemma routes cannot answer this. They take ids and report
 * which of THOSE are held (`POST .../locks/query` refuses an empty list:
 * *"A request body with non-empty 'datasetIds' is required"*), so asking
 * "what is under curation" through them would mean passing every dataset
 * id — ~23,500, past both the 1000-id cap and the 8 KB header limit.
 * This needs its own listing, asked for 2026-08-27 and not yet built on
 * either side.
 *
 * Read-only, like everything else here: take / steal / release stay with
 * the agent relay and are deliberately not offered across a list.
 */
export async function getActiveCurationLocks(): Promise<ActiveLocksResult> {
  try {
    const rows = await api.get<ActiveCurationLock[]>("/curation-lock/active");
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    // 404 = not built. 501 if it lands behind a not-implemented stub.
    // 🛑 422 too, and that one is not obvious: the relay exposes
    // `/curation-lock/{experimentId}`, so until an `active` route exists
    // FastAPI matches THIS path and fails to parse "active" as an id —
    // a validation error, not a missing route. Treating it as a real
    // failure put an error banner on the dashboard where "not built
    // yet" is the honest answer. Observed against the running relay,
    // 2026-08-28.
    if (
      e instanceof ApiError &&
      (e.status === 404 || e.status === 501 || e.status === 422)
    ) {
      return LOCKS_ROUTE_ABSENT;
    }
    throw e;
  }
}

/**
 * Which of THESE datasets are held — the by-ids read, for a list that
 * already has a page of rows on screen.
 *
 * 🛑 **Only held datasets come back. An absent id is NOT locked**, and an
 * empty map is the healthy answer against a quiet page rather than a
 * broken route. A list painting 1000 rows is not sent 1000 entries to
 * say nothing is happening, so key off presence.
 *
 * Complements `getActiveCurationLocks`: that one answers "what is under
 * curation" with no ids to give, this one answers "of the rows I am
 * showing, which are busy".
 */
export async function getCurationLocksFor(
  experimentIds: readonly (number | string)[],
): Promise<Record<string, CurationLock> | typeof LOCKS_ROUTE_ABSENT> {
  if (experimentIds.length === 0) return {};
  try {
    const map = await api.post<Record<string, CurationLock>>(
      "/curation-lock/query",
      { datasetIds: experimentIds.map((id) => Number(id)).filter(Number.isFinite) },
    );
    return map ?? {};
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 501)) {
      return LOCKS_ROUTE_ABSENT;
    }
    throw e;
  }
}

/**
 * How every surface names a lock holder. ONE phrase source, because the
 * chip, the dashboard panel and the experiment list all answer the same
 * question and drifting wordings would read as different states.
 *
 * 🛑 The person/batch split is `run_id` / `agent_name` being ABSENT, not
 * a flag: a curator taking a lock from the UI supplies neither, so "no
 * run id" means a human. That distinction is the point of the whole
 * field — `alice` tells a blocked curator nothing useful, while
 * `proposer` running `category-policy-rebuild-2026-08-09` tells them to
 * wait rather than steal.
 */
export function lockHolderPhrase(lock: CurationLock): {
  who: string;
  kind: "person" | "batch";
  detail: string | null;
} {
  const agent = (lock.agent_name ?? "").trim();
  const run = (lock.run_id ?? "").trim();
  if (agent || run) {
    return {
      who: agent || "A batch job",
      kind: "batch",
      detail: run || null,
    };
  }
  return {
    who: lock.locked_by || "Someone else",
    kind: "person",
    detail: null,
  };
}
