import { useEffect, useRef, type ReactNode } from "react";

/**
 * Tiny styled confirmation modal — replaces `window.confirm` for
 * destructive actions where we want a richer message and visual
 * consistency with the rest of the editor.
 *
 * Open/close is controlled (`open` prop). Confirm and cancel both
 * close the modal via the parent's state. Escape and click-outside
 * trigger cancel.
 *
 * ``body`` takes a node as well as a string, and ``width`` widens the
 * shell — enough for a decision surface that needs rows rather than a
 * sentence (the factor-adoption picker) to reuse this chrome instead
 * of forking a second modal. A string body keeps its
 * ``whitespace-pre-wrap`` treatment; a node is rendered as given.
 */
export function ConfirmModal({
  open,
  title,
  body,
  confirmLabel = "delete",
  cancelLabel = "cancel",
  destructive = true,
  confirmDisabled = false,
  width = "md",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Grey out confirm while the choice is incomplete. */
  confirmDisabled?: boolean;
  /** Shell width. ``"md"`` is the confirmation default; ``"lg"`` fits
   *  a scrollable list of choices. */
  width?: "md" | "lg";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
      onClick={onCancel}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className={`bg-white dark:bg-slate-800 dark:text-slate-100 border border-slate-300 dark:border-slate-600 rounded-lg shadow-xl w-full ${
          width === "lg" ? "max-w-3xl" : "max-w-md"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <h2
            id="confirm-title"
            className="text-sm font-semibold text-slate-900 dark:text-slate-100"
          >
            {title}
          </h2>
        </div>
        <div
          className={`px-4 py-3 text-sm text-slate-700 dark:text-slate-200 ${
            typeof body === "string" ? "whitespace-pre-wrap" : ""
          } ${width === "lg" ? "max-h-[70vh] overflow-y-auto" : ""}`}
        >
          {body}
        </div>
        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
          <button type="button" className="btn ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            disabled={confirmDisabled}
            className={destructive ? "btn primary !bg-rose-600 !ring-rose-700" : "btn primary"}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
