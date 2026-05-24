/**
 * Two-click destructive-action button: first click reveals
 * "really? cancel | confirm" inline; second click fires. Avoids a
 * full modal for the lighter destructive actions on this page
 * (clear cache, reset hibernate stats). Use a real modal for the
 * heavier ones (clear ALL caches).
 */

import { useState } from "react";

export interface ConfirmButtonProps {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
  disabled?: boolean;
  tone?: "default" | "danger";
  title?: string;
  className?: string;
}

export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  disabled = false,
  tone = "default",
  title,
  className,
}: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    const palette =
      tone === "danger"
        ? "border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-900/30"
        : "border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700";
    return (
      <button
        type="button"
        className={
          "text-[11px] px-2 py-0.5 rounded border bg-transparent " +
          palette +
          " " +
          (className ?? "")
        }
        title={title}
        disabled={disabled}
        onClick={() => setArmed(true)}
      >
        {label}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-[11px] text-slate-600 dark:text-slate-400">
        sure?
      </span>
      <button
        type="button"
        className="text-[11px] px-2 py-0.5 rounded bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
        disabled={disabled}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {confirmLabel ?? "yes"}
      </button>
      <button
        type="button"
        className="text-[11px] px-2 py-0.5 rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
        onClick={() => setArmed(false)}
      >
        cancel
      </button>
    </span>
  );
}
