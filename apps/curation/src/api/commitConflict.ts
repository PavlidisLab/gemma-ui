/**
 * A commit 409, read as a REASON rather than as one undifferentiated
 * conflict.
 *
 * Gemma's curation commit answers 409 with `{reason,
 * retryableAfterReread, upstream}`. There are five reasons and five
 * different next moves, and **only `STALE_BASELINE` is a re-read** —
 * so a UI that retries on any 409 gets four of them wrong, and one of
 * those four (`LOCK_REQUIRED`) would retry forever.
 *
 * 🛑 Read from `ApiError.body`, never from `.detail`. `detail` is a
 * flattened sentence for display; `reason` is its SIBLING. Scanning the
 * sentence for a field that never appears in it is how the draft
 * 409's `draftRetained` was "handled" by a regex that could not match —
 * it answered from a default instead, and was right by luck.
 *
 * Tolerates null: a server that sends no structured reason yields
 * `null` here and the caller falls back to the plain message. Nothing
 * renders differently until the commit relay is wired.
 */
import { ApiError } from "./client";

export type CommitConflictReason =
  | "STALE_BASELINE"
  | "REQUIRES_FORCE"
  | "LOCK_REQUIRED"
  | "PUBLICATION_REJECTED"
  | "UNSPECIFIED";

export interface CommitConflict {
  reason: CommitConflictReason;
  /** The server's own message, verbatim — never reworded. */
  message: string;
  /** True only when re-reading and rebuilding the diff can help. */
  retryableAfterReread: boolean;
  /** What the curator is being asked to do, in one line. */
  nextMove: string;
}

const REASONS: Record<CommitConflictReason, { nextMove: string; reread: boolean }> = {
  // Gemma deliberately does NOT hand back a fresher token, so there is
  // nothing to retry with until the design is re-read.
  STALE_BASELINE: {
    nextMove: "Someone else committed first. Reload to pick up their changes, then commit again.",
    reread: true,
  },
  // 🛑 Not a "force" button. Sign is the route for a change with
  // consequences, and Gemma gates sign on holding the lock rather than
  // on being an admin — so the curator confirms, then signs.
  REQUIRES_FORCE: {
    nextMove: "This commit invalidates existing analyses. Review what is affected, then sign off to proceed.",
    reread: false,
  },
  LOCK_REQUIRED: {
    nextMove: "Take the curation lock first.",
    reread: false,
  },
  // A person ruled this paper out for this dataset. Not a retry.
  PUBLICATION_REJECTED: {
    nextMove: "This publication was ruled out for this dataset. Remove it from the commit.",
    reread: false,
  },
  UNSPECIFIED: { nextMove: "", reread: false },
};

function isReason(v: unknown): v is CommitConflictReason {
  return typeof v === "string" && v in REASONS;
}

/**
 * Find the conflict fields in a body, across the shapes this one
 * client sees.
 *
 * 🛑 TWO backends answer here and they shape a 409 differently:
 *
 *   Gemma REST   `{apiVersion, buildInfo, error: {code, message,
 *                  errors: [{reason, message, location, ...}]}}`
 *                — the reason is inside an ARRAY, two levels down.
 *   Agent relay  `{reason, retryableAfterReread, upstream}`, and it
 *                nests its upstream errors under `detail`.
 *
 * Verified against gemma2's own OpenAPI (`WellComposedError`), not
 * assumed — the flat shape alone would have missed every Gemma-direct
 * 409 and returned null, which reads exactly like "no reason given".
 */
function findConflictFields(
  body: unknown,
): { reason?: unknown; retryableAfterReread?: unknown; message?: unknown } | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;

  // Relay shape, flat or one level down under `detail`.
  if ("reason" in o) return o;
  const detail = o.detail;
  if (detail && typeof detail === "object" && "reason" in (detail as object)) {
    return detail as Record<string, unknown>;
  }

  // Gemma shape: error.errors[0].reason. The array can hold more than
  // one; the first drives the next move and `error.message` is the
  // summary that names them all, so nothing is silently dropped.
  const err = o.error;
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    const list = e.errors;
    if (Array.isArray(list) && list.length > 0) {
      const first = list[0];
      if (first && typeof first === "object") {
        const f = first as Record<string, unknown>;
        return {
          reason: f.reason,
          message:
            typeof e.message === "string" && e.message.trim()
              ? e.message
              : f.message,
        };
      }
    }
  }
  return null;
}

/**
 * The structured conflict behind a failed commit, or `null` when this
 * is not a 409 or carries no reason.
 */
export function commitConflictOf(err: unknown): CommitConflict | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const fields = findConflictFields(err.body);
  if (!fields) return null;

  const reason: CommitConflictReason = isReason(fields.reason)
    ? fields.reason
    : "UNSPECIFIED";
  const spec = REASONS[reason];
  const message =
    typeof fields.message === "string" && fields.message.trim()
      ? fields.message.trim()
      : err.detail;
  return {
    reason,
    message,
    // The server's own answer wins; the per-reason default only fills
    // in when it did not say. Deriving it from the reason alone would
    // overrule a server that knows better.
    retryableAfterReread:
      typeof fields.retryableAfterReread === "boolean"
        ? fields.retryableAfterReread
        : spec.reread,
    nextMove: spec.nextMove,
  };
}
