import type { ToastTone } from "@/components/ui/Toast";
import type { MaterializedAction } from "@/api/auditTypes";

export interface RecoveryToast {
  message: string;
  tone: ToastTone;
  durationMs: number;
}

/** Human summary of a set of materialized actions — details joined,
 *  falling back to the action kind when a detail is blank. */
function summarize(actions: readonly MaterializedAction[]): string {
  return actions.map((m) => m.detail?.trim() || m.kind).join(", ");
}

/** Build the curator-facing finalize toast(s) for the actions the
 *  backend safety net materialized (see ``AuditReport.materialized`` and
 *  the agent-side ``local_api.finalize_materialize``).
 *
 *  The response is a UNION of two folds that mean opposite things, so we
 *  split by ``source`` and emit a distinct toast per kind:
 *
 *  - ``"reviewer"`` (or UNtagged — the legacy reviewer-only shape) = a
 *    genuine UI persistence DROP the app failed to save and the store
 *    recovered. Rare canary → **warn**.
 *  - ``"gold"`` = routine accepted→gold propagation that fires on every
 *    reconcile finalize (the UI never writes ``/polished/gold``). Not a
 *    bug → quiet **info** confirmation.
 *
 *  Returns ``[]`` on the healthy path (nothing materialized). Pure over
 *  the recovered list so it's unit-testable without a render / the
 *  ToastProvider. See
 *  ``UIB_REPLY_2026_07_21_MATERIALIZE_TO_GOLD_TOAST_SOURCE.md``. */
export function materializedRecoveryToasts(
  recovered: readonly MaterializedAction[],
): RecoveryToast[] {
  // Untagged ⇒ legacy reviewer-only shape ⇒ a genuine drop.
  const drops = recovered.filter((m) => (m.source ?? "reviewer") === "reviewer");
  const goldWrites = recovered.filter((m) => m.source === "gold");

  const toasts: RecoveryToast[] = [];
  if (drops.length > 0) {
    const plural = drops.length === 1 ? "" : "s";
    toasts.push({
      message:
        `The store recovered ${drops.length} accepted change${plural} the ` +
        `app had dropped: ${summarize(drops)}. Your decisions are saved — ` +
        `no action needed.`,
      tone: "warn",
      durationMs: 9000,
    });
  }
  if (goldWrites.length > 0) {
    const plural = goldWrites.length === 1 ? "" : "s";
    toasts.push({
      message:
        `${goldWrites.length} accepted decision${plural} recorded to gold: ` +
        `${summarize(goldWrites)}.`,
      tone: "info",
      durationMs: 6000,
    });
  }
  return toasts;
}
