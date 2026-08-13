/**
 * Close-a-screening-ticket confirm, when candidates are still open.
 *
 * **What it replaces.** A `window.confirm` reading *"N row(s) still
 * undecided — finalize anyway? Undecided rows are excluded from the
 * follow-up curation ticket."* Closing already decided something, and
 * the only response available was cancel.
 *
 * **Two open states, two different destinations.** This is the part
 * worth getting right:
 *
 * - **Never reviewed** (`triage_disposition === null`) — nobody
 *   looked. A blanket include/exclude is a reasonable answer, because
 *   there is no judgement to preserve.
 * - **Unsure** — the curator looked and could not resolve it. Forcing
 *   include/exclude here would DEFEAT the state: `unsure` exists
 *   precisely to record "I can't answer this", and a close flow that
 *   demands an answer anyway just launders a guess into the record.
 *   Its destination is a follow-up ticket carrying those rows, with an
 *   optional assignee — which is what escalation is. Per Paul
 *   2026-08-13: "escalation with a followup ticket both make sense",
 *   and one mechanism serves both.
 *
 * The destination is deliberately a UI decision, not a stored policy —
 * Paul said in advance we may change our mind about it, so it lives
 * here where changing it is one branch rather than a migration.
 *
 * **Why a new component.** `ConfirmModal` is a two-button yes/no over
 * a string body — no third option, no row list. `CloseAuditConfirm`
 * has the right shape but is welded to the audit sidebar
 * (`CurationReviewKind`, sticky close-notes, audit lifecycle). This
 * borrows its shape rather than forking it.
 */

import { useEffect, useRef, useState } from "react";

/** How never-reviewed rows should be resolved when the ticket closes. */
export type PendingResolution = "include" | "exclude";

export interface OpenRow {
  targetId: number;
  /** Accession or other human handle — what the curator recognises. */
  label: string;
  /** Why it couldn't be resolved. Populated for `unsure`; null for
   *  never-reviewed rows. */
  reason?: string | null;
}

/**
 * Bucket rows by reason, largest class first.
 *
 * A leftover pile is a CLASS-level signal: when twelve of fifteen say
 * the same thing, that is one policy decision rather than twelve
 * escalations, so the biggest class has to be the first thing visible.
 * Rows with no reason collapse into one unlabelled bucket at the end.
 */
export function groupByReason(
  rows: OpenRow[],
): Array<{ reason: string | null; rows: OpenRow[] }> {
  const byReason = new Map<string, OpenRow[]>();
  const noReason: OpenRow[] = [];
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
  const out: Array<{ reason: string | null; rows: OpenRow[] }> = [
    ...byReason.entries(),
  ]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([reason, rs]) => ({ reason, rows: rs }));
  if (noReason.length) out.push({ reason: null, rows: noReason });
  return out;
}

/** Enough accessions to recognise the pile, not so many that the
 *  dialog becomes the list. */
const PREVIEW_LIMIT = 12;

function RowPreview({ rows }: { rows: OpenRow[] }) {
  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded p-2 mb-2 max-h-40 overflow-y-auto">
      {groupByReason(rows).map((g) => (
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
  );
}

export function TriageCloseDialog({
  open,
  neverReviewed,
  unsure,
  includedCount,
  excludedCount,
  busy = false,
  onResolveNeverReviewed,
  onCarryForward,
  onCancel,
}: {
  open: boolean;
  neverReviewed: OpenRow[];
  unsure: OpenRow[];
  includedCount: number;
  excludedCount: number;
  busy?: boolean;
  /** Apply one decision to every never-reviewed row. */
  onResolveNeverReviewed: (resolution: PendingResolution) => void;
  /** Spawn a follow-up screening ticket carrying the unsure rows.
   *  `assignee` empty = same owner; naming someone else is the
   *  escalation. */
  onCarryForward: (assignee: string) => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [assignee, setAssignee] = useState("");

  useEffect(() => {
    if (!open) return;
    // Focus lands on "go back" — neither blanket action should be
    // reachable by reflex.
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

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
        className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded shadow-xl p-4 w-[32rem] max-h-[80vh] overflow-y-auto text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-semibold text-sm text-slate-900 dark:text-slate-100 mb-2">
          Close this screening ticket?
        </h2>

        <p className="text-slate-600 dark:text-slate-300 mb-3">
          {includedCount} included · {excludedCount} excluded
          {unsure.length > 0 ? (
            <>
              {" "}·{" "}
              <span className="font-semibold text-amber-700 dark:text-amber-300">
                {unsure.length} unsure
              </span>
            </>
          ) : null}
          {neverReviewed.length > 0 ? (
            <>
              {" "}·{" "}
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                {neverReviewed.length} never reviewed
              </span>
            </>
          ) : null}
        </p>

        {neverReviewed.length > 0 ? (
          <section className="mb-3">
            <h3 className="font-medium text-slate-800 dark:text-slate-100 mb-1">
              {neverReviewed.length} never reviewed
            </h3>
            <p className="text-slate-600 dark:text-slate-300 mb-1">
              Nobody has looked at these. Decide for all of them, or go
              back and work through them.
            </p>
            <RowPreview rows={neverReviewed} />
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => onResolveNeverReviewed("exclude")}
                className="px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                title="Mark all as excluded. They will not carry into the follow-up curation ticket."
              >
                Exclude the rest
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onResolveNeverReviewed("include")}
                className="px-2 py-1 rounded border border-emerald-400 text-emerald-800 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-500 dark:text-emerald-200 dark:hover:bg-emerald-900/30"
                title="Mark all as included, sending them to the follow-up curation ticket."
              >
                Include the rest
              </button>
            </div>
          </section>
        ) : null}

        {unsure.length > 0 ? (
          <section className="mb-3">
            <h3 className="font-medium text-slate-800 dark:text-slate-100 mb-1">
              {unsure.length} unsure
            </h3>
            {/* No include/exclude here on purpose: these were reviewed
                and could not be resolved, so demanding a verdict at
                close would just record a guess. */}
            <p className="text-slate-600 dark:text-slate-300 mb-1">
              These were reviewed and couldn&apos;t be resolved. They
              carry into a new screening ticket rather than being
              guessed at — assign someone else to escalate.
            </p>
            <RowPreview rows={unsure} />
            <div className="flex items-center gap-2">
              <input
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                placeholder="assign to (optional)"
                className="grow border border-slate-300 rounded px-1.5 py-1 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 dark:placeholder-slate-500"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => onCarryForward(assignee.trim())}
                className="px-2 py-1 rounded border border-amber-400 text-amber-800 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-500 dark:text-amber-200 dark:hover:bg-amber-900/30 whitespace-nowrap"
                title="Create a new screening ticket carrying just these candidates, then close this one."
              >
                Carry {unsure.length} forward
              </button>
            </div>
          </section>
        ) : null}

        <div className="flex items-center justify-end pt-1 border-t border-slate-200 dark:border-slate-700">
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="px-2 py-1 rounded text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:text-slate-100 dark:hover:bg-slate-800"
          >
            Go back and decide
          </button>
        </div>
      </div>
    </div>
  );
}
