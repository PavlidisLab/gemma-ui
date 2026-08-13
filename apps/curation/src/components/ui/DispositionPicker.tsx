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
import { useEffect, useRef, useState } from "react";

import type { TicketTargetTriageDisposition } from "@/api/tickets";

/**
 * Default reasons offered when a curator marks a candidate `unsure`.
 *
 * Presets rather than free text alone because the point of the reason
 * is CLASS-level: when twelve of fifteen leftovers say the same thing,
 * that is one policy decision rather than twelve escalations — and
 * free text alone clusters badly. Free text stays available for the
 * case no preset fits.
 *
 * Overridable per ticket (`unsureReasons`): screens ask different
 * questions, and the reasons a curator can't answer them differ with
 * the question. Paul 2026-08-13: tickets should be customisable
 * per-case, with clear templates and standard slots — this is the
 * slot, and the wire field is deliberately free text so extending
 * this list never needs a schema change.
 */
export const DEFAULT_UNSURE_REASONS = [
  "Can't tell from the abstract",
  "Needs domain expertise",
  "Scope rule unclear",
  "Sample set ambiguous",
];

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
  showUnsure = false,
  unsureReasons = DEFAULT_UNSURE_REASONS,
  reason,
}: {
  value: TicketTargetTriageDisposition;
  /** ``reason`` is passed only for ``unsure``; the store clears it on
   *  any other decision, so callers never have to send a clear. */
  onChange: (
    next: TicketTargetTriageDisposition,
    reason?: string,
  ) => void;
  disabled?: boolean;
  confirmLabel?: string;
  rejectLabel?: string;
  /** ``md`` is for the detail page's title bar, where the control is
   *  the page's primary action rather than one cell in a dense table. */
  size?: "sm" | "md";
  /** Opt-in: surfaces the third state. Off by default so surfaces that
   *  genuinely have a binary question don't grow an option that makes
   *  no sense for them. */
  showUnsure?: boolean;
  unsureReasons?: string[];
  /** The stored reason, shown on the lit Unsure button's tooltip so a
   *  curator can see why past-them stalled without opening anything. */
  reason?: string | null;
}) {
  const [prompting, setPrompting] = useState(false);
  const [draft, setDraft] = useState("");
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!prompting) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPrompting(false);
    }
    function onDown(e: MouseEvent) {
      if (!popRef.current?.contains(e.target as Node)) setPrompting(false);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [prompting]);

  const commitUnsure = (r: string) => {
    const trimmed = r.trim();
    // A reasonless `unsure` is the one shape that helps nobody — it is
    // indistinguishable from "not looked at" to whoever picks the pile
    // up, which is exactly the distinction this state exists to make.
    // Cheap to satisfy: every preset is one click.
    if (!trimmed) return;
    onChange("unsure", trimmed);
    setPrompting(false);
    setDraft("");
  };
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
      {showUnsure ? (
        <span className="relative inline-flex">
          <button
            type="button"
            disabled={disabled}
            aria-pressed={value === "unsure"}
            title={
              value === "unsure"
                ? `Unsure${reason ? ` — ${reason}` : ""} — click again to clear this decision`
                : "Reviewed but can't resolve — asks for a short reason"
            }
            onClick={() => {
              if (value === "unsure") {
                onChange(null);
                return;
              }
              setPrompting((p) => !p);
            }}
            className={
              value === "unsure"
                ? `${baseBtn} border-amber-500 bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100 dark:border-amber-400`
                : `${baseBtn} border-slate-300 bg-slate-50 text-slate-700 hover:bg-amber-50 hover:border-amber-400 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600`
            }
          >
            Unsure
            {value === "unsure" ? <ClearGlyph /> : null}
          </button>
          {prompting ? (
            <div
              ref={popRef}
              className="absolute z-40 top-full right-0 mt-1 w-56 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded shadow-lg p-1.5 text-[11px]"
            >
              <div className="text-slate-500 dark:text-slate-400 mb-1">
                Why can&apos;t you resolve it?
              </div>
              <div className="flex flex-col gap-0.5 mb-1">
                {unsureReasons.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => commitUnsure(r)}
                    className="text-left px-1.5 py-1 rounded border border-slate-300 bg-white text-slate-700 hover:bg-amber-50 hover:border-amber-400 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600"
                  >
                    {r}
                  </button>
                ))}
              </div>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitUnsure(draft);
                }}
                placeholder="or type a reason…"
                className="w-full border border-slate-300 rounded px-1.5 py-1 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 dark:placeholder-slate-500"
              />
            </div>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
