/**
 * Full-page (or full-region) loading mask.
 *
 * Two render modes, picked by the ``mode`` prop:
 *
 *   - ``"page"`` (default) — pins to the full viewport with
 *     ``min-h-screen``. Use this as a top-level ``return`` while the
 *     page can't yet render anything meaningful (session probe in
 *     flight, route data not yet resolved).
 *   - ``"region"`` — fills the parent flex slot with ``flex-1``.
 *     Use this when the page chrome (top bar, sidebar) is already
 *     mounted and we're only masking the body. Curator-side
 *     ``ExperimentShellLoading`` is the canonical example: keep the
 *     AppHeader + experiment TopBar visible while the design draft
 *     fetches.
 *
 * Centred spinner (border-trick — same ring style as the inline
 * ``Spinner``, sized up to 32px so it reads as a page-level wait),
 * an optional muted ``label`` line beneath it, and optional
 * ``detail`` for a second line that can carry a monospace identifier
 * ("experiment GSE…", "session…"). All slots are optional so the
 * minimal call (``<PageMask />``) renders just the spinner.
 */
import type { ReactNode } from "react";

export function PageMask({
  label,
  detail,
  mode = "page",
}: {
  /** Short status line — e.g. "loading session…",
   *  "loading experiment…". Renders as ``text-sm`` muted under the
   *  spinner. Optional. */
  label?: ReactNode;
  /** Secondary identifier — typically a monospace token like an
   *  accession ("GSE12345") or a session id fragment. Renders inline
   *  inside ``label`` formatting; pass it as a separate prop so
   *  callers don't have to thread their own ``<span>``. */
  detail?: ReactNode;
  /** ``"page"`` pins to the viewport; ``"region"`` fills the parent
   *  flex slot. Defaults to ``"page"`` because the most common use
   *  is a top-level pre-render mask. */
  mode?: "page" | "region";
}) {
  const outer =
    mode === "page"
      ? "min-h-screen flex flex-col items-center justify-center gap-3 bg-white dark:bg-slate-950"
      : "flex-1 flex flex-col items-center justify-center gap-3 px-4";
  return (
    <div className={outer + " text-sm text-slate-500 dark:text-slate-400"}>
      <div
        aria-label="loading"
        className="w-8 h-8 rounded-full border-2 border-slate-200 border-t-blue-600 dark:border-slate-700 dark:border-t-blue-400 animate-spin"
      />
      {label || detail ? (
        <div className="text-sm text-center">
          {label}
          {detail ? (
            <>
              {label ? " " : ""}
              <span className="font-mono text-slate-700 dark:text-slate-300">
                {detail}
              </span>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
