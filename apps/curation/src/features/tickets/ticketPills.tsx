import type { TicketPriority, TicketState } from "@/api/tickets";
import { cn } from "@/lib/cn";

/**
 * The two ticket pills, lifted out of ``CuratorDashboard`` 2026-08-20
 * so ``TicketPickerModal`` could move to its own file without a
 * circular import back through the dashboard.
 *
 * 🛑 These are the canonical pair. This repo already carries near-
 * duplicates of the idea (TicketBadge, TicketContextChip) and the harm
 * is drift — the same visual concept in two palettes, and curators stop
 * trusting the chrome. Extend these; don't fork them.
 */
export function PriorityPill({ priority }: { priority: TicketPriority }) {
  const palette: Record<TicketPriority, string> = {
    URGENT:
      "bg-rose-200 text-rose-900 border-rose-500 dark:bg-rose-900/60 dark:text-rose-100 dark:border-rose-500",
    HIGH:
      "bg-amber-100 text-amber-900 border-amber-400 dark:bg-amber-900/50 dark:text-amber-100 dark:border-amber-600",
    NORMAL:
      "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600",
    LOW: "bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-900 dark:text-slate-500 dark:border-slate-700",
  };
  return (
    <span
      className={cn(
        "inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border",
        palette[priority],
      )}
    >
      {priority.toLowerCase()}
    </span>
  );
}

export function StatePill({ state }: { state: TicketState }) {
  // Resolved + cancelled tickets get a muted pill so the curator can
  // see at a glance which cards are closed when browsing the
  // Completed / All filters. Open + in-progress lean into emerald
  // / blue so the active work stands out.
  const palette: Record<TicketState, string> = {
    OPEN: "bg-emerald-100 text-emerald-900 border-emerald-400 dark:bg-emerald-900/40 dark:text-emerald-100 dark:border-emerald-600",
    IN_PROGRESS:
      "bg-blue-100 text-blue-900 border-blue-400 dark:bg-blue-900/40 dark:text-blue-100 dark:border-blue-600",
    RESOLVED:
      "bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-600",
    CANCELLED:
      "bg-slate-100 text-slate-500 border-slate-300 dark:bg-slate-800 dark:text-slate-500 dark:border-slate-600",
  };
  return (
    <span
      className={cn(
        "inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border",
        palette[state],
      )}
    >
      {state.toLowerCase().replace("_", " ")}
    </span>
  );
}



/** Ticket dates as a curator reads them. Lives beside the pills for the
 *  same reason they do: the picker modal needs it and must not import
 *  back through the dashboard that imports the modal. */
export function formatFiledDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
