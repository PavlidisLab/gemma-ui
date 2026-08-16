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

/** May an accepted save run a structural adopt mutator on the draft?
 *
 *  The wire deliberately records keep-on-match as ``accepted`` with the
 *  same structure_ok/details_ok as an adopt (regression #2 in the module
 *  docstring — the curator is confirming gold, not dismissing), so
 *  ``status`` alone CANNOT answer this question; only the curator's raw
 *  verdict can. ``"currently"`` = keep: never mutate — before this gate
 *  a keep click on a drifted near-match ran the adopt mutator and the
 *  draft adopted the agent's version against the curator's stated
 *  intent. An absent verdict (legacy / per-row callers) is not a keep,
 *  so it does not block. */
export function structuralApplyMutationAllowed(
  verdict: Verdict | undefined,
): boolean {
  return verdict !== "currently";
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

/** Translate a server / network error from the disposition PATCH path
 *  into a curator-readable toast string. Strips URL paths, JSON
 *  payloads, FastAPI validation noise, and behind-the-scenes
 *  issue-code identifiers — leaves a one-sentence "what went wrong +
 *  what to do" message. Keeps the raw text in the toast `title`
 *  attribute (via the toast hook) so support / debug paths can still
 *  recover the detail.
 *
 *  Shared by every call site that awaits `setDisposition` directly —
 *  originally lived only in `findingCard.tsx`, but `ComparisonFactorCard`'s
 *  merge/accept dispatchers awaited the same call with NO catch at all,
 *  so a server-side drop was a fully silent unhandled rejection (2026-07-30:
 *  "it didn't fully record some of my dispositions again"). Extracted here
 *  so every caller gets the same friendly message instead of re-deriving it. */
export function friendlyDispositionError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  // FastAPI 422 with structured body — extract the `msg` field and
  // route on intent rather than echoing the raw JSON.
  if (/accept_reason is required/i.test(raw)) {
    return "Couldn't save Agree — this finding needs a reason. Try Park to record one.";
  }
  if (/dismiss_reason is required/i.test(raw)) {
    return "Couldn't save Reject — pick a reason and try again.";
  }
  if (/not_sure_reason is required/i.test(raw)) {
    return "Couldn't save Park — pick a reason and try again.";
  }
  if (/notes is required/i.test(raw)) {
    return "Couldn't save — add a short note explaining why and try again.";
  }
  if (/^.*\b500\b/i.test(raw)) {
    return "Server error while saving — try again in a moment.";
  }
  if (/^.*\b401|forbidden|unauthor/i.test(raw)) {
    return "Couldn't save — your session may have expired. Sign in again.";
  }
  // Generic fallback — keep the human-readable bit (the first sentence
  // after any URL / status header) without leaking behind-the-scenes
  // strings.
  const tail = raw
    .replace(/^.*?(\d{3}\s+[A-Za-z ]+\s*[—-]\s*)/u, "")
    .replace(/\bissue_code='[^']*'/gu, "")
    .replace(/\[\{.*?\}\]/gus, "")
    .trim();
  return tail
    ? `Disposition save failed — ${tail.slice(0, 160)}`
    : "Disposition save failed.";
}
