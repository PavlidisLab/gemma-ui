/**
 * Common chrome for one diagnostics panel. Title + body + optional
 * footer slot for download / caption / outlier-control links.
 *
 * Both the curator app (apps/curation) and the public browse app
 * (apps/browser) wrap each chart body in this card so the four-up
 * Diagnostics row has visually-uniform tiles regardless of which
 * app it's rendering in. Tailwind's `dark:` variants keep the dark
 * theme alive for curation; apps without a dark mode toggle (today:
 * browser) get the light treatment.
 */

import type { ReactNode } from "react";

/** Fixed inner-body height (CSS px) shared by every diagnostics tile,
 *  so the four cards stay uniform and compact. Bumped 280 → 308
 *  (+10%) on 2026-07-11. */
export const DIAGNOSTICS_PANEL_BODY_PX = 308;

/** Vertical space (CSS px) consumed above a heatmap's matrix inside the
 *  panel body — the sequential legend strip + its labels + the body's
 *  top padding. Measured empirically. The sample-correlation card
 *  subtracts this from the body height to size its square cells so the
 *  matrix fills the remaining box regardless of sample count.
 *
 *  🛑 Now only the body's own padding: the sample-correlation card
 *  moved its legend to a SIDE rail (`legendPlacement="side"`), so the
 *  bar and its labels no longer sit above the matrix and no longer eat
 *  height. It was 83 while the legend was on top. Under-counting here
 *  does not clip anything; it oversizes the cells and runs the matrix
 *  past the bottom of the box, so re-measure if the legend moves back. */
export const HEATMAP_LEGEND_ZONE_PX = 16;

export function PanelCard({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  /** Bottom-of-card slot — caption, "download matrix ↓" links,
   *  outlier-control affordances. Keep it short; this strip stays
   *  one line tall by design. */
  footer?: ReactNode;
}) {
  return (
    <div className="flex flex-col rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {title}
        </span>
      </div>
      {/* Fixed body height keeps all four diagnostics tiles uniform and
          compact. The chart bodies (w-full h-full SVGs) fill it exactly;
          the correlation heatmap sizes itself by its cell cap and sits
          within it. Was `flex-1 min-h-[300px]`, which let the SVG charts
          balloon to ~450-650px via an aspect-ratio feedback with their
          resize hook. Height is an inline style, not `h-[280px]`: the
          apps' Tailwind `content` globs only scan `./src`, so arbitrary
          utilities used solely in this package never get generated. */}
      <div
        // 🛑 An explicit text colour, because the heatmap package draws its
        // legend with `currentColor` — it ships no Tailwind and cannot
        // write a `dark:` rule of its own. Without this the body
        // inherited a near-black from the app root and the legend's
        // caption and tick labels were invisible on the dark panel.
        className="p-2 flex items-stretch justify-stretch overflow-hidden bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
        style={{ height: DIAGNOSTICS_PANEL_BODY_PX }}
      >
        {children}
      </div>
      {footer ? (
        <div className="px-3 py-1.5 border-t border-slate-100 dark:border-slate-700 text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-3">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

export function PanelEmpty({ reason }: { reason: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400 italic text-center px-4">
      {reason}
    </div>
  );
}

export function PanelLoading() {
  return (
    <div className="flex-1 flex items-center justify-center text-xs text-slate-500 italic">
      loading…
    </div>
  );
}

export function PanelError({ message }: { message: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-xs text-rose-700 dark:text-rose-300 text-center px-4">
      {message}
    </div>
  );
}
