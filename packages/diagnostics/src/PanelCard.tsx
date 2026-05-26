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
      <div className="flex-1 min-h-[300px] p-2 flex items-stretch justify-stretch bg-white dark:bg-slate-900">
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
