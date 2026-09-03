import { useEffect, useRef } from "react";

import type { Ticket } from "@/api/tickets";
import { ticketTypeLabel, useScratchpadOwnerResolver } from "@/api/tickets";
import {
  PriorityPill,
  ScratchpadOwnerPill,
  StatePill,
  formatFiledDate,
} from "@/features/tickets/ticketPills";

/**
 * Gateway shown when a quick-search single-hit experiment is on more
 * than one open ticket — we can't pick one for the curator, so they
 * choose which ticket to open live. Reuses the ConfirmModal shell
 * pattern (backdrop / dialog / Escape / click-outside) and the
 * dashboard's own PriorityPill / StatePill so a ticket row here reads
 * the same as its card. Never a dead-end: "Open without a ticket" is
 * always available.
 */
export function TicketPickerModal({
  experimentName,
  tickets,
  onPick,
  onOpenPlain,
  onCancel,
}: {
  experimentName: string;
  tickets: Ticket[];
  onPick: (ticketId: number) => void;
  onOpenPlain: () => void;
  onCancel: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // Most recent first, full stop (Paul, 2026-08-16). This used to rank
  // by priority and only break ties by date, which put a stale HIGH
  // ticket above the one the curator filed this morning — and since the
  // rows carried no date, the order looked arbitrary rather than
  // deliberate. When the same experiment sits on several tickets, the
  // question being asked is "which of these am I working on now", and
  // recency answers it; priority is still on every row as a pill.
  //
  // `updated_at` over `created_at`: a ticket someone just added targets
  // to is live work, whatever day it was opened. Falls back to
  // `created_at`, then to id, so rows with a missing stamp still order
  // stably instead of shuffling.
  // Taken once: a scratchpad in this list can be another curator's,
  // and a row here must read the same as its dashboard card.
  const ownerOf = useScratchpadOwnerResolver();
  const sorted = tickets.slice().sort((a, b) => {
    const at = a.updated_at || a.created_at || "";
    const bt = b.updated_at || b.created_at || "";
    if (at !== bt) return bt.localeCompare(at);
    return b.id - a.id;
  });

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
      onClick={onCancel}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ticket-picker-title"
        className="bg-white dark:bg-slate-800 dark:text-slate-100 border border-slate-300 dark:border-slate-600 rounded-lg shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <h2
            id="ticket-picker-title"
            className="text-sm font-semibold text-slate-900 dark:text-slate-100"
          >
            {experimentName} is on {tickets.length} tickets
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Pick which ticket to open it with — the experiment opens with
            that ticket's context live.
          </p>
        </div>
        <ul className="overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700">
          {sorted.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onPick(t.id)}
                className="w-full text-left px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex flex-col gap-1"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-semibold text-slate-800 dark:text-slate-100">
                    #{t.id}
                  </span>
                  <PriorityPill priority={t.priority} />
                  <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {ticketTypeLabel(t.type)}
                  </span>
                  <ScratchpadOwnerPill owner={ownerOf(t)} />
                  <StatePill state={t.state} />
                  {/* The list is ordered by this, so show it. Sorting
                      by a field the rows don't carry reads as no order
                      at all. */}
                  {t.updated_at || t.created_at ? (
                    <span
                      className="ml-auto text-[11px] text-slate-400 dark:text-slate-500 tabular-nums"
                      title={
                        t.updated_at
                          ? `last updated ${t.updated_at}`
                          : `opened ${t.created_at}`
                      }
                    >
                      {formatFiledDate(t.updated_at || t.created_at)}
                    </span>
                  ) : null}
                </div>
                {t.title ? (
                  <span className="text-sm text-slate-700 dark:text-slate-200 line-clamp-1">
                    {t.title}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-between gap-2">
          <button
            type="button"
            className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 underline-offset-2 hover:underline"
            onClick={onOpenPlain}
          >
            Open without a ticket
          </button>
          <button
            ref={closeRef}
            type="button"
            className="btn ghost text-xs"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
