/**
 * Pure derivation helpers for the disposition-save wire shape.
 *
 * Extracted from the editor + sidebar's inline closures so the
 * `(verdict, issue_code) → (structure_ok, details_ok, status,
 * dismiss_reason)` mapping is unit-testable. Three regressions in
 * the last two sessions came from getting this mapping wrong:
 *
 *   1. The structured ``AppliedFix`` object was posted directly
 *      while the running server still expected ``str`` (422).
 *   2. ``keep Curator A's`` on a ``_match_near`` finding sent
 *      ``status=dismissed`` when it should have been ``accepted``
 *      (the curator is confirming gold is right, not dismissing
 *      the finding).
 *   3. ``status=dismissed`` PATCHes without ``dismiss_reason`` 422'd
 *      — the chip-dialog bypass forgot to backfill a default
 *      reason.
 *
 * Tests live in ``dispositionSave.test.ts``. Any new issue_code
 * the agent ships should grow a test row here before the UI
 * branch lands.
 */

import type {
  AcceptReason,
  DismissReason,
  DispositionStatus,
} from "@/api/auditTypes";

/** Editor verdict — what button the curator pressed. */
export type Verdict = "proposal" | "currently" | "reference";

/** Map (verdict, issue_code) → ``(structure_ok, details_ok)``.
 *
 *   - ``proposal`` / ``reference``: structure_ok=true, details_ok=true.
 *     Curator's saying "yes that's the right answer" regardless of
 *     issue_code.
 *   - ``currently`` on match / rename: structure_ok=true,
 *     details_ok=true. Curator's saying "gold's labels are
 *     correct, no change needed" — that's an accept, not a
 *     dismiss.
 *   - ``currently`` on extras / gold_only_miss: structure_ok=false,
 *     details_ok=null. Curator's saying "agent's structural call
 *     is wrong" — that's a dismiss.
 */
export function verdictToStructureDetails(
  verdict: Verdict,
  issueCode: string,
): { structureOk: boolean | null; detailsOk: boolean | null } {
  if (verdict === "proposal" || verdict === "reference") {
    return { structureOk: true, detailsOk: true };
  }
  // verdict === "currently"
  const isStructuralAccept =
    issueCode === "calibration_factor_match_exact" ||
    issueCode === "calibration_factor_match_near" ||
    issueCode === "calibration_factor_rename" ||
    issueCode === "calibration_match";
  if (isStructuralAccept) {
    return { structureOk: true, detailsOk: true };
  }
  return { structureOk: false, detailsOk: null };
}

/** Conventional status derivation from the two axes.
 *
 *   - structure_ok=false                → ``dismissed``
 *   - structure_ok=null && details_ok=null → ``needs_more_info``
 *   - else                              → ``accepted``
 */
export function deriveStatus(
  structureOk: boolean | null,
  detailsOk: boolean | null,
): DispositionStatus {
  if (structureOk === false) return "dismissed";
  if (structureOk === null && detailsOk === null) return "needs_more_info";
  return "accepted";
}

/** Server requires a structured ``dismiss_reason`` whenever
 *  ``status === "dismissed"`` (model-validator on
 *  ``AuditFindingDispositionPatch``). The chip-dialog flow fills
 *  this from a curator pick; the editor's one-click "keep gold"
 *  bypass needs a sensible default. Derives from issue_code:
 *
 *    * gold_only_miss codes → ``agent_real_miss`` (the curator is
 *      saying the agent missed gold's existing curation).
 *    * extras / anything else → ``wont_fix`` (catch-all;
 *      semantically "structural call is wrong, no further action").
 *
 *  Returns ``undefined`` when status isn't dismissed — the wire
 *  shape only carries dismiss_reason on dismiss PATCHes.
 */
export function deriveDismissReason(
  status: DispositionStatus,
  issueCode: string,
): DismissReason | undefined {
  if (status !== "dismissed") return undefined;
  if (
    issueCode === "calibration_gold_only_miss" ||
    issueCode === "calibration_factor_gold_only_miss"
  ) {
    return "agent_real_miss";
  }
  return "wont_fix";
}

/** Server requires a structured ``accept_reason`` for calibration
 *  agent-extra and gold-only-miss accepts when the structured editor
 *  bypasses the chip dialog (e.g. the "adopt Auditor's" one-click
 *  path). Derive a sensible default from issue_code:
 *
 *    * agent_extra codes → ``well_evidenced`` (curator is saying
 *      the agent's new tag is supported by the data).
 *    * gold_only_miss codes → ``gold_was_wrong`` (curator is
 *      agreeing the gold incorrectly excluded this tag).
 *    * everything else / non-accepted → ``undefined`` (not required).
 */
export function deriveAcceptReason(
  status: DispositionStatus,
  issueCode: string,
): AcceptReason | undefined {
  if (status !== "accepted") return undefined;
  if (
    issueCode === "calibration_agent_extra" ||
    issueCode === "calibration_factor_extra"
  ) {
    return "well_evidenced";
  }
  if (
    issueCode === "calibration_gold_only_miss" ||
    issueCode === "calibration_factor_gold_only_miss"
  ) {
    return "gold_was_wrong";
  }
  return undefined;
}
