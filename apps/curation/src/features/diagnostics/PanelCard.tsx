/**
 * Common chrome for a Diagnostics-tab panel. Title + body + optional
 * footer slot for download / caption links. Mirrors the four-up
 * layout from the legacy Gemma ExtJS Diagnostics tab — same panel
 * granularity (Sample Corr / Scree / PC+Factors / M-V) but with the
 * Pavlab-flat palette and our own widget set inside.
 */

import type { ReactNode } from "react";

export function PanelCard({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  /** Bottom-of-card slot for the caption / download links the
   *  legacy Diagnostics tab had under each panel ("No outliers
   *  removed nor detected.", "Download correlation matrix",
   *  "Download eigengenes"). */
  footer?: ReactNode;
}) {
  return (
    <div className="card flex flex-col">
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">
        <span className="section-h text-sm font-semibold text-slate-700 dark:text-slate-200">
          {title}
        </span>
      </div>
      <div className="flex-1 min-h-[260px] p-2 flex items-stretch justify-stretch">
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

/** Empty-state for the four diagnostic panels — same copy as the
 *  legacy Diagnostics tab's "Preprocessing metadata: Not available
 *  for this experiment" footer, but per-panel so the curator knows
 *  which one is missing. Bro: this branch fires when the matching
 *  endpoint 404s. */
export function PanelEmpty({
  reason,
}: {
  reason: string;
}) {
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
