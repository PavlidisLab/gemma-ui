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

const DIALOG_W = 240;
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

const SIGNAL_TAGS: { key: string; label: string; help: string }[] = [
  {
    key: "fp",
    label: "FP",
    help: "false positive — agent flagged an issue that isn't real",
  },
  {
    key: "tp",
    label: "TP",
    help: "true positive — agent correctly flagged a real issue",
  },
  {
    key: "fn",
    label: "FN",
    help: "false negative — agent missed something real",
  },
  {
    key: "tn",
    label: "TN",
    help: "true negative — agent correctly noted this is fine",
  },
];

export function DismissDialog({
  mode = "dismiss",
  finding,
  anchor,
  onCancel,
  onConfirm,
}: {
  mode?: DispositionMode;
  finding: { issue_code: string; rationale: string };
  anchor: HTMLElement | null;
  onCancel: () => void;
  /** Optional signal tag (FP/FN/TP/TN or null) plus free-text notes. */
  onConfirm: (tag: string | null, notes: string) => Promise<void> | void;
}) {
  const config = MODE_CONFIG[mode];
  const [tag, setTag] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
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

  async function handleConfirm() {
    setSubmitting(true);
    try {
      await onConfirm(tag, notes.trim());
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
        {config.title}
      </div>
      <div className="text-[10px] text-slate-500 dark:text-slate-400 mb-2 line-clamp-2">
        <span className="font-mono mr-1">{finding.issue_code}</span>
        {finding.rationale}
      </div>
      {/* Optional signal tags — FP/FN/TP/TN, none mandatory */}
      <div className="flex gap-1 mb-2">
        {SIGNAL_TAGS.map((t) => (
          <button
            key={t.key}
            type="button"
            title={t.help}
            onClick={() => setTag(tag === t.key ? null : t.key)}
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded border font-mono transition-colors",
              tag === t.key
                ? "bg-slate-700 text-white border-slate-700 dark:bg-slate-200 dark:text-slate-900 dark:border-slate-200"
                : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600 dark:hover:bg-slate-700",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="note (optional)"
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
          disabled={submitting}
          className="text-[11px] px-2 py-0.5 rounded font-medium bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-100"
        >
          {submitting ? config.confirmingLabel : config.confirmLabel}
        </button>
      </div>
    </div>,
    document.body,
  );
}
