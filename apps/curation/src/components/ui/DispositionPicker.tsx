/**
 * The two-way decision control for a ticket target.
 *
 * The stored data is always ``include`` / ``exclude`` / null — only the
 * VERBS change per ticket, from the payload's ``decision`` block, because
 * what a screen is asking varies ("Include / Exclude" on a corpus screen,
 * "Confirm / Reject" on "is this the right paper?"). Callers pass the
 * labels; nobody re-derives the colour or the toggle semantics.
 *
 * Clicking the active side clears the decision — a misclick is one click
 * to undo, matching the endorse/flag control's behaviour.
 *
 * Lives in ``components/ui`` because two surfaces render it: the triage
 * table (a row at a time) and the preboarding detail page (the one
 * candidate the curator drilled into). Forking it would let the two
 * drift on colour or on what a second click does.
 */
import type { TicketTargetTriageDisposition } from "@/api/tickets";

/** The "and you can take it back" mark on the chosen side. A tooltip
 *  alone didn't carry it: a lit button with no visible way out reads as
 *  a committed decision, so curators didn't know a second click undoes
 *  it. Decorative — the whole button is the target, as it already was. */
function ClearGlyph() {
  return (
    <span aria-hidden="true" className="ml-1 opacity-50 font-normal">
      ✕
    </span>
  );
}

export function DispositionPicker({
  value,
  onChange,
  disabled,
  confirmLabel = "Include",
  rejectLabel = "Exclude",
  size = "sm",
}: {
  value: TicketTargetTriageDisposition;
  onChange: (next: TicketTargetTriageDisposition) => void;
  disabled?: boolean;
  confirmLabel?: string;
  rejectLabel?: string;
  /** ``md`` is for the detail page's title bar, where the control is
   *  the page's primary action rather than one cell in a dense table. */
  size?: "sm" | "md";
}) {
  const baseBtn =
    size === "md"
      ? "px-2.5 py-1 rounded border text-xs font-medium transition-colors"
      : "px-2 py-0.5 rounded border text-[11px] font-medium transition-colors";
  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        disabled={disabled}
        aria-pressed={value === "include"}
        // The undo is a second click on the lit side. That was true
        // before and invisible — nothing said so, so a curator who
        // mis-clicked had no way to know the decision was reversible.
        title={
          value === "include"
            ? `${confirmLabel} — click again to clear this decision`
            : confirmLabel
        }
        onClick={() => onChange(value === "include" ? null : "include")}
        className={
          value === "include"
            ? `${baseBtn} border-emerald-500 bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100 dark:border-emerald-400`
            : `${baseBtn} border-slate-300 bg-slate-50 text-slate-700 hover:bg-emerald-50 hover:border-emerald-400 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600`
        }
      >
        {confirmLabel}
        {value === "include" ? <ClearGlyph /> : null}
      </button>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={value === "exclude"}
        title={
          value === "exclude"
            ? `${rejectLabel} — click again to clear this decision`
            : rejectLabel
        }
        onClick={() => onChange(value === "exclude" ? null : "exclude")}
        className={
          value === "exclude"
            ? `${baseBtn} border-rose-500 bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100 dark:border-rose-400`
            : `${baseBtn} border-slate-300 bg-slate-50 text-slate-700 hover:bg-rose-50 hover:border-rose-400 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600`
        }
      >
        {rejectLabel}
        {value === "exclude" ? <ClearGlyph /> : null}
      </button>
    </div>
  );
}
