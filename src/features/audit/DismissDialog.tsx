import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

/**
 * Reason-picker dialog used by the three audit-disposition actions
 * that require curator explanation:
 *
 *   - **dismiss** (curator disagrees with the finding)
 *   - **accept** (curator agrees with an agent-extra suggestion;
 *     adding new curation deserves a "why")
 *   - **not_sure** (curator can't decide right now and wants to
 *     park the finding with a documented reason; counts as decided)
 *
 * Required by `AUDIT_DISPOSITIONS.md` Ask #2 (and the 2026-05-10
 * unification of accept + not-sure flows). Server gets a structured
 * reason key so my brother can cluster dispositions for prompt-
 * quality analysis without parsing curator prose.
 *
 * Default: no chip selected. The curator MUST pick one before the
 * Confirm button enables. Selecting "other" makes the notes field
 * mandatory (free text only — every other reason has a fixed
 * meaning curated into the enum).
 *
 * Click-outside / Esc cancels (no PATCH fires). Confirm calls
 * onConfirm with the chosen reason key + notes; the caller threads
 * those into the disposition patch.
 *
 * Wire: typed `dismiss_reason` / `accept_reason` / `not_sure_reason`
 * fields land on `AuditFindingDispositionPatch` per
 * `AUDIT_DISPOSITION_REASONS_HANDOFF.md` (shipped 2026-05-10). The
 * dialog hands the chosen key to the caller; the caller routes it
 * onto the right typed field via `setDisposition`'s extras.
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
// Generous estimate of dialog height. Real height varies with the
// notes textarea row count + chip wrap. Used only to decide
// drop-below vs flip-above; the real layout is always honoured. If
// neither side fits (tiny viewport), pin to the top with
// scrolling (max-h:90vh keeps the dialog reachable).
const DIALOG_H_ESTIMATE = 320;
// Vertical gap between trigger and dialog. Same number as the old
// `mt-1` spacing.
const ANCHOR_OFFSET = 4;
// Same on the horizontal axis — minimum gap between the dialog's
// edge and the viewport edge.
const VIEWPORT_GUTTER = 8;

export type DispositionMode = "dismiss" | "accept" | "not_sure";

interface ReasonOption {
  /** Stable key sent to the server. Lower-snake-case. */
  key: string;
  /** Curator-facing chip label. */
  label: string;
  /** Hover help — shown in chip's title attribute. */
  help: string;
}

const MODE_CONFIG: Record<
  DispositionMode,
  {
    title: string;
    confirmLabel: string;
    confirmingLabel: string;
    reasons: ReasonOption[];
  }
> = {
  dismiss: {
    title: "Why?",
    confirmLabel: "Close",
    confirmingLabel: "closing…",
    reasons: [
      {
        key: "redundant",
        label: "redundant",
        help: "already covered by inheritance or another existing element",
      },
      {
        key: "out_of_scope",
        label: "out of scope",
        help: "not what this experiment is about",
      },
      {
        key: "weak_evidence",
        label: "weak evidence",
        help: "could be true but the support isn't strong enough",
      },
      {
        key: "accepted_elsewhere",
        label: "accepted elsewhere",
        help: "curator addressed it via a different action",
      },
      {
        key: "wont_fix",
        label: "won't fix",
        help: "real but not worth the effort",
      },
      {
        key: "other",
        label: "other…",
        help: "free-text fallback (notes mandatory)",
      },
    ],
  },
  accept: {
    title: "Why accept?",
    confirmLabel: "Accept",
    confirmingLabel: "accepting…",
    reasons: [
      {
        key: "well_evidenced",
        label: "well-evidenced",
        help: "paper / methods / sample data clearly support adding it",
      },
      {
        key: "fills_gap",
        label: "fills gap",
        help: "Gemma had nothing for this slot; agent caught a coverage gap",
      },
      {
        key: "more_specific",
        label: "more specific",
        help: "agent's pick refines an existing entry to the precise term",
      },
      {
        key: "other",
        label: "other…",
        help: "free-text fallback (notes mandatory)",
      },
    ],
  },
  not_sure: {
    title: "Why unsure?",
    confirmLabel: "Park",
    confirmingLabel: "parking…",
    reasons: [
      {
        key: "need_more_data",
        label: "need more data",
        help: "paper unclear / contradictory / sparse on this point",
      },
      {
        key: "need_expert",
        label: "need expert",
        help: "domain question beyond the curator's scope",
      },
      {
        key: "pending_update",
        label: "pending update",
        help: "Gemma data is out of date; re-import expected",
      },
      {
        key: "other",
        label: "other…",
        help: "free-text fallback (notes mandatory)",
      },
    ],
  },
};

export function DismissDialog({
  mode = "dismiss",
  finding,
  anchor,
  onCancel,
  onConfirm,
}: {
  /** Which disposition path the curator is on. Drives the dialog
   *  header, reason chip set, and confirm-button label. Defaults to
   *  "dismiss" for back-compat with callers that haven't been
   *  updated. */
  mode?: DispositionMode;
  /** The finding being dispositioned — surfaced in the dialog header
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
  /** Reason key (one of ``MODE_CONFIG[mode].reasons[*].key``) plus
   *  optional free-text notes. Caller encodes both into the
   *  disposition patch. */
  onConfirm: (
    reasonKey: string,
    notes: string,
  ) => Promise<void> | void;
}) {
  const config = MODE_CONFIG[mode];
  const [reason, setReason] = useState<string | null>(null);
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
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Default: drop straight down from the anchor's left edge.
    let top = rect.bottom + ANCHOR_OFFSET;
    let left = rect.left;
    // Right edge would overflow the viewport — slide left so it fits.
    if (left + DIALOG_W + VIEWPORT_GUTTER > vw) {
      left = Math.max(VIEWPORT_GUTTER, vw - DIALOG_W - VIEWPORT_GUTTER);
    }
    // Bottom edge would overflow — flip above the anchor when there's
    // room, otherwise pin to the top of the viewport with the dialog
    // letting its own max-height handle the rest. Mirrors the same
    // logic in ``BiomaterialMetaPopover``. Without this, the dialog
    // (~320px tall with chips + textarea + footer) clips below the
    // visible area when the trigger sits near the bottom of a
    // long sidebar — the calibration audit's review-queue case.
    if (top + DIALOG_H_ESTIMATE + VIEWPORT_GUTTER > vh) {
      const above = rect.top - ANCHOR_OFFSET - DIALOG_H_ESTIMATE;
      top =
        above >= VIEWPORT_GUTTER
          ? above
          : Math.max(VIEWPORT_GUTTER, vh - DIALOG_H_ESTIMATE - VIEWPORT_GUTTER);
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
      className="fixed z-50 bg-white border border-slate-300 rounded shadow-xl p-2.5 text-xs overflow-y-auto dark:bg-slate-900 dark:border-slate-700"
      style={{
        top: pos.top,
        left: pos.left,
        width: DIALOG_W,
        // Cap at viewport height so the dialog stays reachable even
        // when neither drop-below nor flip-above fits cleanly. Real
        // layout uses the dialog's natural size up to this ceiling.
        maxHeight: "90vh",
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="font-semibold text-slate-800 dark:text-slate-100 mb-1.5">
        {config.title}
      </div>
      <div className="text-[10px] text-slate-500 dark:text-slate-400 mb-2 line-clamp-2">
        <span className="font-mono mr-1">{finding.issue_code}</span>
        {finding.rationale}
      </div>
      <div className="grid grid-cols-2 gap-1 mb-2">
        {config.reasons.map((r) => (
          <ReasonChip
            key={r.key}
            label={r.label}
            help={r.help}
            active={reason === r.key}
            onClick={() => setReason(r.key)}
          />
        ))}
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
        className="w-full text-[11px] border border-slate-300 rounded px-1.5 py-1 mb-2 resize-y dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 dark:placeholder-slate-500"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="text-[11px] px-2 py-0.5 rounded text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:text-slate-100 dark:hover:bg-slate-800"
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
              ? "bg-slate-700 text-white hover:bg-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-100"
              : "bg-slate-200 text-slate-400 cursor-not-allowed dark:bg-slate-800 dark:text-slate-600",
          )}
        >
          {submitting ? config.confirmingLabel : config.confirmLabel}
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
          ? "bg-slate-700 text-white border-slate-700 dark:bg-slate-200 dark:text-slate-900 dark:border-slate-200"
          : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600 dark:hover:bg-slate-700",
      )}
    >
      {label}
    </button>
  );
}
