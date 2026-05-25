import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

/**
 * Lightweight note + optional signal-tag dialog for the three audit
 * disposition actions (dismiss / accept / park).
 *
 * No mandatory chip selection — just an optional note and four
 * quick-tag buttons (FP / FN / TP / TN) the curator can use to
 * label the agent's accuracy without being forced to pick one.
 *
 * Click-outside / Esc cancels. Confirm is always enabled while the
 * dialog is open (the tags and note are optional).
 *
 * Renders via createPortal to escape the sidebar's overflow context.
 * Positioning logic mirrors the previous version.
 */

const DIALOG_W = 260;
const DIALOG_H_ESTIMATE = 200;
const ANCHOR_OFFSET = 4;
const VIEWPORT_GUTTER = 8;

export type DispositionMode = "dismiss" | "accept" | "not_sure";

const MODE_CONFIG: Record<
  DispositionMode,
  { title: string; confirmLabel: string; confirmingLabel: string }
> = {
  dismiss: {
    title: "Disagree",
    confirmLabel: "Close",
    confirmingLabel: "closing…",
  },
  accept: {
    title: "Accept",
    confirmLabel: "Accept",
    confirmingLabel: "accepting…",
  },
  not_sure: {
    title: "Park",
    confirmLabel: "Park",
    confirmingLabel: "parking…",
  },
};

export type DialogChip = { key: string; label: string; help: string };

/** Draft store — survives DismissDialog mount/unmount cycles so the
 *  curator can press Escape (or anything that closes the dialog
 *  *without* explicit Cancel), navigate around the page, and reopen
 *  the same finding's dialog to find their chip + notes still there.
 *  Keyed by `<targetId>::<mode>` so per-mode drafts on the same
 *  finding don't trample each other (e.g. an in-progress Park note
 *  isn't lost when the curator briefly opens the Dismiss dialog).
 *
 *  Cleared on Cancel / × / Confirm. Escape just closes the UI. */
const draftStore = new Map<string, { tag: string | null; notes: string }>();
const draftKeyOf = (targetId: string, mode: DispositionMode) =>
  `${targetId}::${mode}`;

export function DismissDialog({
  mode = "dismiss",
  chips = [],
  finding,
  targetId,
  anchor,
  initialTag = null,
  initialNotes = "",
  isEdit = false,
  onCancel,
  onConfirm,
}: {
  mode?: DispositionMode;
  /** Chips shown as quick-select options. Caller supplies the right
   *  vocabulary for the disposition type (dismiss reasons, accept
   *  reasons, not-sure reasons). Empty = no chip row shown. */
  chips?: DialogChip[];
  finding: { issue_code: string; rationale: string };
  /** Stable id for the finding so draft state can be keyed per-finding
   *  across the dialog's mount/unmount cycle. */
  targetId: string;
  anchor: HTMLElement | null;
  /** Pre-select this chip on open. Used when re-opening the dialog
   *  to edit an existing disposition's notes / tag. */
  initialTag?: string | null;
  /** Pre-fill the notes textarea. */
  initialNotes?: string;
  /** Re-edit of an existing disposition — swaps the title and confirm
   *  copy to "Save". Server-side this is still the same PATCH (the
   *  log is append-only, latest-per-target_id wins), so no separate
   *  endpoint is needed. */
  isEdit?: boolean;
  onCancel: () => void;
  onConfirm: (tag: string | null, notes: string) => Promise<void> | void;
}) {
  const config = MODE_CONFIG[mode];
  const draftKey = draftKeyOf(targetId, mode);
  // Hydration order (highest precedence first):
  //   1. Persisted draft (curator pressed Escape mid-edit and is now
  //      reopening) — survives the dialog's unmount.
  //   2. Explicit initialTag/initialNotes from the parent (edit-mode
  //      reopens preload the existing disposition's chip + note).
  //   3. First chip as default so the common-case Confirm is one click.
  const draft = draftStore.get(draftKey);
  const [tag, setTag] = useState<string | null>(
    draft?.tag ?? initialTag ?? chips[0]?.key ?? null,
  );
  const [notes, setNotes] = useState(draft?.notes ?? initialNotes);
  const [submitting, setSubmitting] = useState(false);

  // Mirror every keystroke / chip click into the draft store so a
  // surprise unmount (Escape, ancestor re-render that flips
  // dismissOpen, etc.) doesn't lose curator work.
  useEffect(() => {
    draftStore.set(draftKey, { tag, notes });
  }, [draftKey, tag, notes]);

  const clearDraft = () => {
    draftStore.delete(draftKey);
  };
  const cancelWithClear = () => {
    clearDraft();
    onCancel();
  };
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!anchor) {
      // No anchor (e.g. the editor's Dismiss button doesn't
      // attach a ref) — fall back to centered-on-screen so the
      // dialog still renders. Previously this returned null and
      // the dialog silently failed to open. Per Paul 2026-05-21.
      setPos({
        top: Math.max(VIEWPORT_GUTTER, (vh - DIALOG_H_ESTIMATE) / 2),
        left: Math.max(VIEWPORT_GUTTER, (vw - DIALOG_W) / 2),
      });
      return;
    }
    const rect = anchor.getBoundingClientRect();
    let top = rect.bottom + ANCHOR_OFFSET;
    let left = rect.left;
    if (left + DIALOG_W + VIEWPORT_GUTTER > vw) {
      left = Math.max(VIEWPORT_GUTTER, vw - DIALOG_W - VIEWPORT_GUTTER);
    }
    if (top + DIALOG_H_ESTIMATE + VIEWPORT_GUTTER > vh) {
      const above = rect.top - ANCHOR_OFFSET - DIALOG_H_ESTIMATE;
      top =
        above >= VIEWPORT_GUTTER
          ? above
          : Math.max(VIEWPORT_GUTTER, vh - DIALOG_H_ESTIMATE - VIEWPORT_GUTTER);
    }
    setPos({ top, left });
  }, [anchor]);

  // Dialog is sticky — clicks outside, viewport resize, and scrolling
  // do NOT dismiss. Curators routinely open the disposition dialog,
  // then scroll around the experiment page to check samples / read the
  // paper / look at related findings before deciding; an auto-dismiss
  // discards the chip + notes they'd already filled in.
  //
  // Escape closes the dialog WITHOUT clearing the draft — reopening
  // restores the chip + notes from `draftStore`. Cancel / × / Confirm
  // explicitly clear the draft.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, submitting]);

  // Server requires `<mode>_reason` whenever the disposition is set
  // (dismiss/accept/not-sure each have their own enum). When the chips
  // are present the curator must pick one; when "other" is picked the
  // server requires non-empty notes too. Block submit on either
  // missing input rather than letting the PATCH 422 with a red box.
  const trimmedNotes = notes.trim();
  const requiresChip = chips.length > 0;
  const otherRequiresNotes = tag === "other" && trimmedNotes.length === 0;
  const canSubmit =
    !submitting &&
    (!requiresChip || tag !== null) &&
    !otherRequiresNotes;
  const submitHint = submitting
    ? ""
    : requiresChip && tag === null
      ? "pick a reason chip first"
      : otherRequiresNotes
        ? `add a note when reason is "Other"`
        : "";

  async function handleConfirm() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onConfirm(tag, trimmedNotes);
      clearDraft();
    } finally {
      setSubmitting(false);
    }
  }

  if (!pos) return null;

  return createPortal(
    <div
      ref={ref}
      className="fixed z-50 bg-white border border-slate-300 rounded shadow-xl p-2.5 text-xs overflow-y-auto dark:bg-slate-900 dark:border-slate-700"
      style={{ top: pos.top, left: pos.left, width: DIALOG_W, maxHeight: "90vh" }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="font-semibold text-slate-800 dark:text-slate-100">
          {isEdit ? `Edit · ${config.title}` : config.title}
        </span>
        <button
          type="button"
          onClick={cancelWithClear}
          disabled={submitting}
          className="text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200 disabled:opacity-50"
          title="close (discards your chip + notes; press Esc to keep them)"
          aria-label="close dialog"
        >
          ×
        </button>
      </div>
      <div className="text-[10px] text-slate-500 dark:text-slate-400 mb-2 line-clamp-2">
        {finding.rationale}
      </div>
      {chips.length > 0 ? (
        <div className="flex gap-1 flex-wrap mb-2">
          {chips.map((t) => (
            <button
              key={t.key}
              type="button"
              title={t.help}
              onClick={() => setTag(tag === t.key ? null : t.key)}
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded border transition-colors",
                tag === t.key
                  ? "bg-slate-700 text-white border-slate-700 dark:bg-slate-200 dark:text-slate-900 dark:border-slate-200"
                  : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600 dark:hover:bg-slate-700",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="note (optional)"
        className="w-full text-[11px] border border-slate-300 rounded px-1.5 py-1 mb-2 resize-y dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 dark:placeholder-slate-500"
      />
      {submitHint ? (
        <div className="text-[10px] text-amber-700 dark:text-amber-400 italic mb-1.5">
          {submitHint}
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={cancelWithClear}
          disabled={submitting}
          title="discards your chip + notes (press Esc instead to keep them)"
          className="text-[11px] px-2 py-0.5 rounded text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:text-slate-100 dark:hover:bg-slate-800"
        >
          cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!canSubmit}
          title={submitHint || undefined}
          className="text-[11px] px-2 py-0.5 rounded font-medium bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-100"
        >
          {submitting
            ? config.confirmingLabel
            : isEdit
              ? "Save"
              : config.confirmLabel}
        </button>
      </div>
    </div>,
    document.body,
  );
}
