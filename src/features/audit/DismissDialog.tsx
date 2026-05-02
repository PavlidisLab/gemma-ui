import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
 *
 * Renders via `createPortal` into `document.body` with
 * `position: fixed` anchored to the trigger button. The audit
 * sidebar's `<aside>` carries `overflow-y-auto` (so proposals
 * stay pinned while the page scrolls), and an absolute-positioned
 * popover inside that ancestor gets clipped. Portal escapes the
 * overflow boundary; fixed coordinates from the anchor's bounding
 * rect keep the dialog visually attached even though the DOM
 * relationship is severed. On scroll / resize the dialog closes —
 * curator's intent is broken anyway when the underlying card
 * scrolls out of view.
 */
const DIALOG_W = 280;
// Vertical gap between trigger and dialog. Same number as the old
// `mt-1` spacing.
const ANCHOR_OFFSET = 4;

export function DismissDialog({
  finding,
  anchor,
  onCancel,
  onConfirm,
}: {
  /** The finding being dismissed — surfaced in the dialog header
   *  so the curator confirms they're acting on the right item.
   *  Free-text label only; the structural fields stay on the
   *  parent card. */
  finding: { issue_code: string; rationale: string };
  /** The button (or any element) the dialog visually drops from.
   *  Used to compute fixed coordinates so the dialog "sticks" to
   *  the trigger across re-renders. May be null on the first
   *  render of the parent — dialog renders nothing in that case. */
  anchor: HTMLElement | null;
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
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Compute / recompute the dialog's fixed-position coords from the
  // anchor's bounding rect. Runs synchronously after layout so the
  // dialog never paints at (0,0) before snapping into place. Also
  // reruns whenever `anchor` flips identity (e.g. caller swaps
  // refs).
  useLayoutEffect(() => {
    if (!anchor) {
      setPos(null);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    // Default: drop straight down from the anchor's left edge.
    let top = rect.bottom + ANCHOR_OFFSET;
    let left = rect.left;
    const vw = window.innerWidth;
    // Right edge would overflow the viewport — slide left so it fits.
    if (left + DIALOG_W + 8 > vw) {
      left = Math.max(8, vw - DIALOG_W - 8);
    }
    setPos({ top, left });
  }, [anchor]);

  // Click-outside / Esc to cancel. Click-outside checks both the
  // dialog and the anchor — the anchor click is what opened the
  // dialog, so we don't want the same click to also close it.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (submitting) return;
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (anchor?.contains(target)) return;
      onCancel();
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
  }, [onCancel, submitting, anchor]);

  // Close on resize — easy enough to recompute coords against
  // shifted layout, but the dialog isn't useful at the wrong
  // anchor. Scroll listeners were tried and pulled (2026-05-02):
  // a chip click moves keyboard focus, the browser auto-scrolls
  // the focused element into view, the capture-phase scroll
  // listener fired and closed the dialog before setReason could
  // re-render. Curators saw "clicking a chip does nothing." For
  // anchor-out-of-viewport detection we'd want
  // IntersectionObserver here, not a blanket scroll close;
  // until then the dialog tolerates a stale anchor and curators
  // dismiss with Esc / click-outside.
  useEffect(() => {
    if (submitting) return;
    function close() {
      onCancel();
    }
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("resize", close);
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

  if (!pos) return null;

  return createPortal(
    <div
      ref={ref}
      // position: fixed lifts the dialog out of the audit sidebar's
      // overflow context entirely; coords come from the anchor rect
      // and reset on scroll/resize via the close-on-change effect.
      className="fixed z-50 bg-white border border-slate-300 rounded shadow-xl p-2.5 text-xs"
      style={{ top: pos.top, left: pos.left, width: DIALOG_W }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
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
    </div>,
    document.body,
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
