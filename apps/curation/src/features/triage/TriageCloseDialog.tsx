/**
 * Close-a-screening-ticket confirm, when candidates are still
 * undecided.
 *
 * **What it replaces and why.** The previous affordance was a
 * `window.confirm` reading *"N row(s) still undecided — finalize
 * anyway? Undecided rows are excluded from the follow-up curation
 * ticket."* So closing already made a decision — exclude — and the
 * only thing the curator could do about it was cancel. A default that
 * consequential should be a choice, and the rows it applies to should
 * be visible before it is taken.
 *
 * **Why a new component.** `ConfirmModal` is a two-button yes/no over
 * a string body — it cannot offer a third option or enumerate rows.
 * `CloseAuditConfirm` has the right SHAPE (a pending-resolution choice
 * with the affected items previewed) but is welded to the audit
 * sidebar: `CurationReviewKind`, sticky close-notes, audit lifecycle.
 * This borrows its shape rather than forking it.
 *
 * **Grouping by reason** — Paul asked for undecided rows grouped by
 * reason, which is the right shape once `unsure` and its reason field
 * land agents-side (asked for in
 * UIB_TO_CAB_2026_08_13_TRIAGE_NULL_IS_A_400_AND_ASK_FOR_AN_UNSURE_DISPOSITION.md).
 * Today `triage_disposition` is `include | exclude | null` and a null
 * carries no reason, so there is nothing to group ON. The row list is
 * grouped through {@link groupUndecided} so that when reasons arrive
 * this becomes a data change rather than a re-layout — but it does not
 * pretend to group what is currently one undifferentiated pile.
 */

import { useEffect, useRef } from "react";

/** How undecided rows should be resolved when the ticket closes. */
export type PendingResolution = "include" | "exclude";

export interface UndecidedRow {
  targetId: number;
  /** Accession or other human handle — what the curator recognises. */
  label: string;
  /** Why it was left undecided, when that is knowable. Null today;
   *  populated once `unsure` carries a reason. */
  reason?: string | null;
}

/** Bucket undecided rows by reason, worst-case one "no reason given"
 *  bucket. Exported for the test and for the day reasons exist: a
 *  leftover pile is a CLASS-level signal — twelve rows saying the same
 *  thing is one policy decision, not twelve escalations — so the
 *  grouping is the thing that makes the pile actionable. */
export function groupUndecided(
  rows: UndecidedRow[],
): Array<{ reason: string | null; rows: UndecidedRow[] }> {
  const byReason = new Map<string, UndecidedRow[]>();
  const noReason: UndecidedRow[] = [];
  for (const r of rows) {
    const key = (r.reason ?? "").trim();
    if (!key) {
      noReason.push(r);
      continue;
    }
    const bucket = byReason.get(key) ?? [];
    bucket.push(r);
    byReason.set(key, bucket);
  }
  // Largest class first — the biggest pile is the one most likely to
  // be resolvable by a single decision.
  const out: Array<{ reason: string | null; rows: UndecidedRow[] }> = [
    ...byReason.entries(),
  ]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([reason, rs]) => ({ reason, rows: rs }));
  if (noReason.length) out.push({ reason: null, rows: noReason });
  return out;
}

/** How many accessions to name before collapsing to a count. Enough to
 *  recognise the pile, not so many that the dialog becomes the list. */
const PREVIEW_LIMIT = 12;

export function TriageCloseDialog({
  open,
  undecided,
  includedCount,
  excludedCount,
  busy = false,
  onResolve,
  onCancel,
}: {
  open: boolean;
  undecided: UndecidedRow[];
  includedCount: number;
  excludedCount: number;
  busy?: boolean;
  /** Apply `resolution` to every undecided row, then close the ticket. */
  onResolve: (resolution: PendingResolution) => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // Focus lands on "go back", not on either destructive-ish default —
    // the whole point is that neither include nor exclude should be
    // reachable by reflex.
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const groups = groupUndecided(undecided);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
      onClick={onCancel}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Close screening ticket"
        className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded shadow-xl p-4 w-[30rem] max-h-[80vh] overflow-y-auto text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-semibold text-sm text-slate-900 dark:text-slate-100 mb-2">
          Close this screening ticket?
        </h2>

        <p className="text-slate-600 dark:text-slate-300 mb-2">
          {includedCount} included · {excludedCount} excluded ·{" "}
          <span className="font-semibold text-amber-700 dark:text-amber-300">
            {undecided.length} still undecided
          </span>
        </p>

        <p className="text-slate-700 dark:text-slate-200 mb-2">
          Undecided candidates need a decision before the ticket closes.
          Choose one for all {undecided.length}, or go back and work
          through them.
        </p>

        {/* Name the rows. The old confirm swept them up sight-unseen,
            and "exclude" means these candidates never get curated. */}
        <div className="border border-slate-200 dark:border-slate-700 rounded p-2 mb-3 max-h-48 overflow-y-auto">
          {groups.map((g) => (
            <div key={g.reason ?? "__none"} className="mb-1.5 last:mb-0">
              {g.reason ? (
                <div className="font-medium text-slate-700 dark:text-slate-200">
                  {g.reason}{" "}
                  <span className="text-slate-500 dark:text-slate-400">
                    ({g.rows.length})
                  </span>
                </div>
              ) : null}
              <div className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                {g.rows
                  .slice(0, PREVIEW_LIMIT)
                  .map((r) => r.label)
                  .join(", ")}
                {g.rows.length > PREVIEW_LIMIT
                  ? ` … +${g.rows.length - PREVIEW_LIMIT} more`
                  : ""}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="px-2 py-1 rounded text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:text-slate-100 dark:hover:bg-slate-800"
          >
            Go back and decide
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onResolve("exclude")}
            className="px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            title={`Mark all ${undecided.length} as excluded, then close. They will not carry into the follow-up curation ticket.`}
          >
            Exclude the rest
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onResolve("include")}
            className="px-2 py-1 rounded font-medium bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-100"
            title={`Mark all ${undecided.length} as included, then close.`}
          >
            Include the rest
          </button>
        </div>
      </div>
    </div>
  );
}
