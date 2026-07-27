/**
 * Roll up per-member status into the three counts the
 * ``SetProgressBar`` consumes (per design review 2026-05-25: green /
 * yellow / light-blue, collapsing draft + uncommitted into one
 * "in progress" bucket).
 *
 * Two input paths:
 *
 * 1. **Server aggregate** (preferred — `member_status_counts`):
 *    the agents side pre-aggregates on the wire as of 2026-05-25. One field
 *    on the group payload, no per-member iteration on the
 *    client. Use this when present.
 *
 * 2. **Per-member fallback** (`member_summaries`): when the
 *    server doesn't carry the aggregate (older backends), iterate
 *    summaries client-side. Same semantics, just slower at scale.
 *
 * Both paths fold in the local-draft signal so a curator with
 * unsaved edits in localStorage shows up as in_progress even if
 * the server says "none". Counts the curator's *own* drafts only —
 * a teammate's edits aren't visible cross-machine.
 */
import type { Group, ExperimentSummary } from "@/api/workflowTypes";
import type { SetProgressCounts } from "@/components/ui/SetProgressBar";

/** Compute progress from a fully-formed Group payload.
 *
 *  Bucket semantics (per design review 2026-05-25 — refined from the
 *  initial "trust the server's in_progress" pass):
 *
 *    DONE        review is finalized AND the curator has no
 *                uncommitted local draft for the experiment
 *    IN PROGRESS curator has actively touched this experiment —
 *                either uncommitted local draft, or (when the agents side
 *                lands has_curator_activity) the server says
 *                so. For now the local-draft cache is the only
 *                signal we trust for "curator started."
 *    UNTOUCHED   everything else, including the server's
 *                "in_progress" rows that were created by the
 *                calibration import but have seen no curator
 *                activity. From the curator's perspective these
 *                are "not yet touched."
 *
 *  Two input paths:
 *
 *  1. Per-member ``member_summaries`` — exact: we know each
 *     row's audit_status and can layer the local-draft signal
 *     per-id. The workflow page fetches with
 *     ``includeSummaries=true`` so this path runs there.
 *
 *  2. ``member_status_counts`` aggregate — approximate: we know
 *     the totals but not WHICH rows have drafts. We assume
 *     drafts don't overlap with already-done rows (rare —
 *     closed-with-draft would be a reopened review the curator
 *     is editing again) and slot all local drafts in the
 *     in_progress bucket, with the rest of the non-done rows
 *     landing in untouched.
 */
export function progressFromGroup(
  group: Group | null | undefined,
  dirtyDraftIds: Set<string>,
): SetProgressCounts {
  if (!group) return { done: 0, in_progress: 0, untouched: 0 };

  // Per-member path — exact.
  if (group.member_summaries && group.member_summaries.length > 0) {
    return computeSetProgress(group.member_summaries, dirtyDraftIds);
  }

  // Aggregate path — approximate when summaries aren't carried.
  if (group.member_status_counts) {
    const c = group.member_status_counts;
    const total = c.done + c.in_progress + c.untouched;
    const memberDrafts = group.member_ids.reduce((n, mid) => {
      const tail = mid.includes(":") ? mid.split(":")[1] : mid;
      return dirtyDraftIds.has(tail) ? n + 1 : n;
    }, 0);
    // ``in_progress`` is curator-activity-driven now. Without
    // ``has_curator_activity`` from the server, drafts are our
    // only proxy. Cap at non-done to keep the math sane.
    const inProgress = Math.min(memberDrafts, Math.max(0, total - c.done));
    return {
      done: c.done,
      in_progress: inProgress,
      untouched: Math.max(0, total - c.done - inProgress),
    };
  }

  return { done: 0, in_progress: 0, untouched: 0 };
}

/** Per-member iteration of progress counts.
 *
 *  Rules per design review 2026-05-25:
 *  - Closed review + uncommitted local draft → in_progress
 *    (the curator finalized the proposal but has leftover
 *    draft work to commit).
 *  - Closed review + no draft → done.
 *  - Local draft (any audit_status) → in_progress.
 *  - audit_status="in_progress" without a draft → untouched.
 *    The server fires "in_progress" the moment a
 *    curation_review row exists, including agent-only / pre-
 *    curator-action rows. Without ``has_curator_activity`` from
 *    the server, the local-draft cache is our only signal that
 *    the curator has done anything. */
export function computeSetProgress(
  summaries: ExperimentSummary[] | null | undefined,
  dirtyDraftIds: Set<string>,
): SetProgressCounts {
  const counts: SetProgressCounts = {
    done: 0,
    in_progress: 0,
    untouched: 0,
  };
  if (!summaries) return counts;
  for (const s of summaries) {
    if (s.experiment_id <= 0) {
      counts.untouched++;
      continue;
    }
    const hasDraft = dirtyDraftIds.has(String(s.experiment_id));
    if (s.audit_status === "closed") {
      // Finalized review + uncommitted local edits = yellow
      // (work waiting to commit); finalized + clean = green.
      if (hasDraft) counts.in_progress++;
      else counts.done++;
      continue;
    }
    if (hasDraft) {
      counts.in_progress++;
      continue;
    }
    // audit_status === "in_progress" without a draft → untouched
    // (server-only signal, no curator activity yet); none / undef →
    // untouched.
    counts.untouched++;
  }
  return counts;
}

/** True iff at least one member is not done. The set-delete
 *  safety gate calls this to decide whether the confirm flow
 *  needs an explicit "yes I know there are open tasks" override. */
export function hasOpenTasks(counts: SetProgressCounts): boolean {
  return counts.in_progress > 0 || counts.untouched > 0;
}
