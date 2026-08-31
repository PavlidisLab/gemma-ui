/**
 * The two behaviours every anchored detail card needs: sit under the
 * chip that opened it, and close when the curator looks away.
 *
 * Extracted from `CuriePopover` when `PubmedPopover` needed the same
 * thing. Both are "click a small identifier, get a floating card", and
 * a second copy of the flip-above-when-it-would-clip arithmetic is how
 * the two cards start behaving differently at the bottom of a screen.
 */
import { useEffect, useRef, useState, type RefObject } from "react";

/** Position below the anchor when there is room, above when there is
 *  not, clamped into the viewport either way.
 *
 *  `deps` re-runs the measurement when the card's own content changes
 *  size — a card that grows after its fetch resolves would otherwise
 *  keep the position it had while it was one line tall, and hang off
 *  the bottom of the window. */
export function useAnchoredPosition<T extends HTMLElement>(
  anchorRect: DOMRect,
  deps: readonly unknown[] = [],
): { ref: RefObject<T>; pos: { left: number; top: number } } {
  const ref = useRef<T>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({
    left: anchorRect.left,
    top: anchorRect.bottom + 6,
  });
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const margin = 8;
    let left = anchorRect.left;
    if (left + rect.width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    let top = anchorRect.bottom + 6;
    if (top + rect.height > window.innerHeight - margin) {
      top = anchorRect.top - rect.height - 6;
      if (top < margin) top = margin;
    }
    setPos({ left, top });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorRect, ...deps]);
  return { ref, pos };
}

/** Close on a click outside the card, and on Escape.
 *
 *  🛑 `mousedown`, not `click`. A `click` listener fires after the
 *  press has already moved focus, and a card anchored inside a
 *  blur-managed surface (the term picker) is gone by then. */
export function useDismissOnOutside(
  ref: RefObject<HTMLElement>,
  onClose: () => void,
): void {
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (e.target instanceof Node && !ref.current.contains(e.target)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, onClose]);
}
