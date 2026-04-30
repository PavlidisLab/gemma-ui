import { useEffect } from "react";

/**
 * Wire the Escape key to a callback while the hook is mounted /
 * ``active`` is true. Drop into modal components so curators can
 * dismiss dialogs without reaching for the close × or click-outside.
 *
 * Pass ``active=false`` to detach without unmounting (e.g. while the
 * modal is hidden but the parent component stays). The handler
 * captures so it runs ahead of inner components that might also
 * listen for Escape (input field "cancel-edit" etc.) — modals
 * generally win those races.
 */
export function useEscape(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onEscape();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, onEscape]);
}
