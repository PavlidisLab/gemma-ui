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

export function DismissDialog({
  mode = "dismiss",
  chips = [],
  finding,
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
  const [tag, setTag] = useState<string | null>(initialTag);
  const [notes, setNotes] = useState(initialNotes);
  const [submitting, setSubmitting] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) {
      setPos(null);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
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

  useEffect(() => {
    if (submitting) return;
    window.addEventListener("resize", onCancel);
    return () => window.removeEventListener("resize", onCancel);
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
      <div className="font-semibold text-slate-800 dark:text-slate-100 mb-1.5">
        {isEdit ? `Edit · ${config.title}` : config.title}
      </div>
      <div className="text-[10px] text-slate-500 dark:text-slate-400 mb-2 line-clamp-2">
        <span className="font-mono mr-1">{finding.issue_code}</span>
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
          onClick={onCancel}
          disabled={submitting}
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
