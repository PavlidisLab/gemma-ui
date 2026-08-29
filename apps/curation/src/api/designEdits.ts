/**
 * Sending the curator's edit to the store.
 *
 * 🛑 Served by the CURATION STORE, not the agent service —
 * `/rest/v2/datasets/{id}/…`, which the `/rest` proxy already points
 * at (`:8095` in local mode). Same home as the design it describes.
 *
 * ## This is step 1 of three, and it is deliberately not wired to
 * ## anything the curator can feel
 *
 * The log is written ALONGSIDE the snapshot, not instead of it. Until
 * the store has read enough logs to confirm they reproduce the diff
 * the reconcile computes today, nothing may depend on one — so a
 * failure here must never cost a curator their commit. `commit()`
 * checkpoints on the design PUT and the polished mirror; the log rides
 * after and cannot block either.
 *
 * That is the opposite of the polished mirror's rule, and the
 * difference is what reads it, not laxity: the mirror is READ BACK by
 * the ticket exporter, so a silently-failed mirror shadows fresh work
 * with a stale snapshot (2026-07-18). Nothing reads the edit log yet.
 * When step 2 lands and the reconcile does read it, this send has to
 * be promoted to part of commit success — and this comment is the note
 * saying so.
 *
 * ## Not-deployed is not a failure
 *
 * The endpoint does not exist on the store today; it was asked for in
 * `UI_WRITE_THE_EDIT_NOT_THE_DESIGN_2026_08_17`. A 404 / 405 / 501
 * therefore means "the sink isn't built yet", which is the expected
 * state, not an error worth a curator's attention. Same distinction
 * `ProvenanceUnavailable` draws for the trace route: "not deployed"
 * and "nothing recorded" must never render as the same sentence.
 */

import { api, ApiError } from "./client";
import type { CurationEditLog } from "@/features/design/editLog";

/** Thrown when the route itself is missing — the store predates the
 *  edit log. Distinct from a real write failure. */
export class EditLogSinkUnavailable extends Error {
  constructor() {
    super("curation edit log sink not available");
    this.name = "EditLogSinkUnavailable";
  }
}

export function curationEditLogPath(experimentId: number | string): string {
  return `/curation/v1/datasets/${experimentId}/design/edits`;
}

/**
 * POST one commit's worth of edits.
 *
 * Append-only by construction: one call per commit, never an update
 * of a previous one. An empty `edits` array is a meaningful post — it
 * is a curator saying "I opened this and changed nothing", which is
 * the claim a bare snapshot could never make about itself.
 */
export async function postCurationEditLog(
  experimentId: number | string,
  log: CurationEditLog,
): Promise<void> {
  try {
    await api.post<unknown>(curationEditLogPath(experimentId), log);
  } catch (e) {
    if (
      e instanceof ApiError &&
      (e.status === 404 || e.status === 405 || e.status === 501)
    ) {
      throw new EditLogSinkUnavailable();
    }
    throw e;
  }
}

/** Reported once per page, not once per commit — a store without the
 *  sink is a standing fact, and a line per commit would train curators
 *  to ignore the console. */
let sinkUnavailableReported = false;

/**
 * Send the log without ever rejecting.
 *
 * See the header: until the reconcile reads these, a failed log must
 * cost the curator nothing. The two outcomes are reported differently
 * because they mean different things — a missing route is the store
 * not having been built yet, a 500 is a write that should have worked.
 */
export async function sendCurationEditLog(
  experimentId: number | string,
  log: CurationEditLog,
): Promise<void> {
  try {
    await postCurationEditLog(experimentId, log);
  } catch (e) {
    if (e instanceof EditLogSinkUnavailable) {
      if (!sinkUnavailableReported) {
        sinkUnavailableReported = true;
        console.info(
          "[editLog] the store has no POST …/design/edits sink yet, so curator " +
            "edits are not being logged. Asked for in " +
            "UI_WRITE_THE_EDIT_NOT_THE_DESIGN_2026_08_17. The commit itself is " +
            "unaffected.",
        );
      }
      return;
    }
    console.warn("[editLog] the curator edit log failed to write", e);
  }
}
