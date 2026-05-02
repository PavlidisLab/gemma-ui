import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { DismissReason } from "@/api/auditTypes";

/**
 * Chip-picker dialog used by the "Dismiss" action on an audit
 * finding. Required by `AUDIT_DISPOSITIONS.md` Ask #2 — server
 * needs a structured `dismiss_reason` so my brother can cluster
 * dismissals for prompt-quality analysis without parsing curator
 * prose.
 *
 * Default: no chip selected. The curator MUST pick one before the
 * Confirm button enables. Selecting "other" makes the notes field
 * mandatory (free text only — every other reason has a fixed
 * meaning curated into the enum).
 *
 * Click-outside / Esc cancels (no PATCH fires). Confirm calls
 * onConfirm with the chosen reason + notes; the caller threads
 * those into setDisposition(... , { dismissReason, notes }).
 */
export function DismissDialog({
  finding,
  onCancel,
  onConfirm,
}: {
  /** The finding being dismissed — surfaced in the dialog header
   *  so the curator confirms they're acting on the right item.
   *  Free-text label only; the structural fields stay on the
   *  parent card. */
  finding: { issue_code: string; rationale: string };
  onCancel: () => void;
  onConfirm: (
    reason: DismissReason,
    notes: string,
  ) => Promise<void> | void;
}) {
  const [reason, setReason] = useState<DismissReason | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Click-outside / Esc to cancel. Skip while submitting so a
  // mid-PATCH stray click doesn't drop the in-flight request.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (submitting) return;
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onCancel();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onCancel();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onCancel, submitting]);

  const needsNotes = reason === "other";
  const canConfirm =
    !!reason && !submitting && (!needsNotes || notes.trim().length > 0);

  async function handleConfirm() {
    if (!reason) return;
    setSubmitting(true);
    try {
      await onConfirm(reason, notes.trim());
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      ref={ref}
      className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-300 rounded shadow-xl p-2.5 text-xs"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="font-semibold text-slate-800 mb-1.5">
        Why dismiss?
      </div>
      <div className="text-[10px] text-slate-500 mb-2 line-clamp-2">
        <span className="font-mono mr-1">{finding.issue_code}</span>
        {finding.rationale}
      </div>
      <div className="grid grid-cols-2 gap-1 mb-2">
        <ReasonChip
          label="auditor wrong"
          help="finding is incorrect / hallucinated"
          active={reason === "auditor_wrong"}
          onClick={() => setReason("auditor_wrong")}
        />
        <ReasonChip
          label="redundant"
          help="already covered by another existing element"
          active={reason === "redundant"}
          onClick={() => setReason("redundant")}
        />
        <ReasonChip
          label="out of scope"
          help="not what this experiment is about"
          active={reason === "out_of_scope"}
          onClick={() => setReason("out_of_scope")}
        />
        <ReasonChip
          label="accepted elsewhere"
          help="curator fixed it via a different action"
          active={reason === "accepted_elsewhere"}
          onClick={() => setReason("accepted_elsewhere")}
        />
        <ReasonChip
          label="won't fix"
          help="real but not worth the effort"
          active={reason === "wont_fix"}
          onClick={() => setReason("wont_fix")}
        />
        <ReasonChip
          label="other…"
          help="free-text fallback (notes mandatory)"
          active={reason === "other"}
          onClick={() => setReason("other")}
        />
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={needsNotes ? 3 : 2}
        placeholder={
          needsNotes
            ? "explain (required for 'other')"
            : "optional notes"
        }
        className="w-full text-[11px] border border-slate-300 rounded px-1.5 py-1 mb-2 resize-y"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="text-[11px] px-2 py-0.5 rounded text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-50"
        >
          cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!canConfirm}
          className={cn(
            "text-[11px] px-2 py-0.5 rounded font-medium",
            canConfirm
              ? "bg-slate-700 text-white hover:bg-slate-800"
              : "bg-slate-200 text-slate-400 cursor-not-allowed",
          )}
        >
          {submitting ? "dismissing…" : "Dismiss"}
        </button>
      </div>
    </div>
  );
}

function ReasonChip({
  label,
  help,
  active,
  onClick,
}: {
  label: string;
  help: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={help}
      className={cn(
        "text-[10px] px-1.5 py-0.5 rounded border text-left transition-colors",
        active
          ? "bg-slate-700 text-white border-slate-700"
          : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50",
      )}
    >
      {label}
    </button>
  );
}
