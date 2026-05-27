/**
 * Common chrome for one of the eight monitoring sections. Title +
 * optional right-edge accessory + content body.
 */

import type { ReactNode } from "react";

export interface SectionCardProps {
  title: string;
  /** Right-edge slot for actions (reset / clear all / refresh
   *  shortcut) or status indicators. */
  accessory?: ReactNode;
  /** Subtitle line below the title — usually a single-line summary
   *  ("47 caches", "6 users · 8 sessions"). */
  summary?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function SectionCard({
  title,
  accessory,
  summary,
  children,
  className,
}: SectionCardProps) {
  return (
    <div
      className={
        "rounded-lg border border-slate-200 bg-white dark:bg-slate-800 dark:border-slate-700 flex flex-col " +
        (className ?? "")
      }
    >
      <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-700 flex items-baseline justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {title}
          </span>
          {summary ? (
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {summary}
            </span>
          ) : null}
        </div>
        {accessory ? <div className="flex-none">{accessory}</div> : null}
      </div>
      <div className="p-3 flex-1 min-h-0 flex flex-col">{children}</div>
    </div>
  );
}
