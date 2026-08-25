/**
 * The site's one modal shell — backdrop, Esc / backdrop-click
 * dismissal, a titled header with a close button, and a scrollable
 * body. AboutModal and MorePlotsModal both mount through here so the
 * chrome can't drift apart between them.
 *
 * LoginModal deliberately stays on its own shell: its dialog is a
 * <form> with a submit handler and a dismissal that has to stay
 * disabled mid-request, which this shell doesn't model.
 */

import { useEffect } from "react";
import type React from "react";

export function Modal({
  open,
  onClose,
  title,
  maxWidth = "max-w-3xl",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Tailwind max-width class for the dialog. */
  maxWidth?: string;
  children: React.ReactNode;
}) {
  // Esc closes.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center px-4 py-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`bg-surface rounded-lg shadow-2xl w-full ${maxWidth} max-h-full flex flex-col overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-3 border-b border-gemma-grid shrink-0">
          <h1 className="text-lg font-semibold tracking-tight text-gemma-ink">
            {title}
          </h1>
          <button
            type="button"
            className="text-gemma-subtle hover:text-gemma-ink text-xl leading-none bg-transparent border-none cursor-pointer p-0"
            onClick={onClose}
            aria-label="close"
          >
            ×
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-6">{children}</div>
      </div>
    </div>
  );
}
