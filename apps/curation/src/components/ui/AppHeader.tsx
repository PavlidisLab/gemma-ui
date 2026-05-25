/**
 * Top app chrome — appears on every full-page surface so the
 * curator never lands on a screen with no way home.
 *
 * Per Paul 2026-05-25: "keep the header consistent" — the
 * dashboard's header drift across pages (present on landing,
 * absent on workflow page) was leaving curators stranded on
 * deeper routes.
 *
 * Shows the breadcrumb (Gemma / Curation, click → home), the
 * current curator, mode chip, health chip, sign-out. Sub-routes
 * can pass children to slot additional context (e.g. a set name
 * crumb) without rebuilding the whole bar.
 */
import type { ReactNode } from "react";
import { ModeChip } from "@/components/ui/ModeChip";
import { HealthChip } from "@/components/ui/HealthChip";
import { useLogout } from "@/api/session";
import { navigate } from "@/routes";

export function AppHeader({
  reviewer,
  children,
}: {
  reviewer: string;
  /** Optional slot for sub-route breadcrumb crumbs / context
   *  chips. Rendered after the "Gemma / Curation" stem. */
  children?: ReactNode;
}) {
  const logout = useLogout();
  return (
    <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 shrink-0">
      <div className="mx-auto w-full max-w-[1800px] px-4 py-2 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => navigate("#/")}
            className="font-semibold text-slate-800 dark:text-slate-100 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
            title="Go to the curator dashboard"
          >
            Gemma
          </button>
          <span className="text-xs text-slate-400" aria-hidden>
            /
          </span>
          <button
            type="button"
            onClick={() => navigate("#/")}
            className="text-sm text-slate-600 dark:text-slate-300 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
            title="Go to the curator dashboard"
          >
            Curation
          </button>
          {children}
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-300 shrink-0">
          <span>
            signed in as <span className="font-medium">{reviewer}</span>
          </span>
          <ModeChip />
          <HealthChip />
          <button
            type="button"
            className="text-slate-500 hover:text-slate-900 underline dark:text-slate-400 dark:hover:text-slate-100"
            onClick={() => logout.mutate()}
          >
            sign out
          </button>
        </div>
      </div>
    </header>
  );
}
