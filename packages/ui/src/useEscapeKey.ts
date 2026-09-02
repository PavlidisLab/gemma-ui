import { useEffect } from "react";

/**
 * Close-on-Escape for a modal surface.
 *
 * Escape is the one key every reader tries on a dialog, and it was
 * handled per-component or not at all — the popover-shaped pickers had
 * it, the full-screen overlays mostly did not, so whether it worked
 * depended on which surface you were standing in.
 *
 * `enabled` is the dialog's own open state, so the listener exists only
 * while the dialog does. Bound to `keydown` on the document because a
 * modal rarely holds focus itself — the reader may have clicked a chart
 * inside it — and a handler on the dialog element would never see the
 * key.
 *
 * 🛑 **`capture: false`, deliberately.** Nested surfaces should close
 * innermost-first: a popover inside a dialog handles its own Escape and
 * calls `stopPropagation`, and bubbling means the dialog behind it does
 * not also close. Capturing here would take the key before the popover
 * ever saw it and shut both at once.
 */
export function useEscapeKey(enabled: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      onEscape();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled, onEscape]);
}
