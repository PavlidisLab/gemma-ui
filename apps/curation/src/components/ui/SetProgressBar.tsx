/**
 * Stacked horizontal progress bar for set-level status rollup.
 *
 * Three segments (per design review 2026-05-25 — "green = done, yellow =
 * in progress, rest is light blue"):
 *
 *   green   ``done``          curator finished + closed the review
 *   amber   ``in_progress``   any non-finished state with curator
 *                             activity — covers both draft (review
 *                             open) and uncommitted (local edits)
 *   sky-200 ``untouched``     curator hasn't touched it yet
 *
 * The per-row ``StatusDisc`` stays at 4 tones because the finer
 * distinction (draft vs uncommitted) is actionable at the row
 * level — the bar collapses them since a roll-up is about
 * direction-of-travel, not nuance.
 *
 * Empty bar (zero total) renders an outlined skeleton so the
 * layout doesn't collapse when member_summaries hasn't loaded.
 */
import { cn } from "@/lib/cn";

export interface SetProgressCounts {
  done: number;
  /** Anything between untouched and done — covers draft (open
   *  review, no local edits) and uncommitted (local edits in
   *  flight). One yellow bucket per design review 2026-05-25. */
  in_progress: number;
  untouched: number;
}

export function SetProgressBar({
  counts,
  size = "regular",
  showCaption = false,
  className,
}: {
  counts: SetProgressCounts;
  /** ``compact`` is the dashboard SetCard size (4px tall, no gap).
   *  ``regular`` is the workflow-page header (8px, with a small
   *  caption when requested). */
  size?: "compact" | "regular";
  /** Render "N done / M" to the right of the bar. ``regular`` size
   *  only. */
  showCaption?: boolean;
  className?: string;
}) {
  const total = counts.done + counts.in_progress + counts.untouched;
  const heightCls = size === "compact" ? "h-1" : "h-1.5";
  const rounded = size === "compact" ? "rounded-sm" : "rounded";

  if (total === 0) {
    return (
      <div
        className={cn(
          "flex w-full",
          heightCls,
          rounded,
          "bg-slate-100 dark:bg-slate-800",
          className,
        )}
        aria-label="no members"
      />
    );
  }

  const pct = (n: number): string => `${(n / total) * 100}%`;

  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <div
        className={cn(
          "flex w-full overflow-hidden ring-1 ring-slate-200 dark:ring-slate-700",
          heightCls,
          rounded,
        )}
        aria-label={`${counts.done} done, ${counts.in_progress} in progress, ${counts.untouched} untouched`}
        title={
          // Bucket semantics per design review 2026-05-25 refinement:
          //   done       = review finalized + no uncommitted local edits
          //   in_progress = curator has touched it but it's not done
          //                 (uncommitted local draft, or closed review
          //                  with leftover draft work)
          //   untouched   = curator hasn't touched it (incl. the
          //                 server's "in_progress" rows that exist
          //                 from calibration import but have seen
          //                 no curator activity)
          `${counts.done} done (closed, no uncommitted draft) · ` +
          `${counts.in_progress} in progress (curator touched, draft uncommitted) · ` +
          `${counts.untouched} not yet touched`
        }
      >
        {counts.done > 0 ? (
          <div
            className="bg-emerald-500 dark:bg-emerald-500"
            style={{ width: pct(counts.done) }}
          />
        ) : null}
        {counts.in_progress > 0 ? (
          <div
            className="bg-amber-500 dark:bg-amber-500"
            style={{ width: pct(counts.in_progress) }}
          />
        ) : null}
        {counts.untouched > 0 ? (
          // Light blue "rest" per design review — sky-200/300 reads as
          // "yet to do" without competing with the amber-in-
          // progress slice for attention.
          <div
            className="bg-sky-200 dark:bg-sky-900/50"
            style={{ width: pct(counts.untouched) }}
          />
        ) : null}
      </div>
      {showCaption && size === "regular" ? (
        <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap">
          <span>
            <span className="font-semibold text-emerald-700 dark:text-emerald-400">
              {counts.done}
            </span>{" "}
            / {total} done
          </span>
          {counts.in_progress > 0 ? (
            <span className="text-amber-700 dark:text-amber-400">
              · {counts.in_progress} in progress
            </span>
          ) : null}
          {counts.untouched > 0 ? (
            <span>· {counts.untouched} untouched</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
