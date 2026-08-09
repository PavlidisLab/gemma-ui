import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

/**
 * Lightweight hover tooltip — replaces the browser-native `title=`
 * attribute where we want a styled, faster-popup tooltip that
 * matches the rest of the app chrome (slate-800 bg, white text,
 * small shadow, rounded). Portal-mounted so the popup escapes
 * sidebar overflow contexts.
 *
 * Defaults:
 *  - 150ms open delay (snappier than native ~700ms but not so
 *    fast it flashes during normal mouse-tracking).
 *  - Above the trigger; auto-flips below if no room.
 *  - 280px max width with line-wrapping; long strings stay legible.
 *  - Closes on mouseleave / blur / Escape / scroll.
 *
 * Usage:
 *
 *   <Tooltip label="AI judge says this proposal is strong">
 *     <span>●</span>
 *   </Tooltip>
 *
 * The single child must be an element that accepts ref + the
 * standard hover/focus handlers (any HTML element does).
 *
 * The `label` prop accepts string OR ReactNode — use a node when
 * the tooltip body needs richer content (multiple lines, a mini
 * key/value list, etc.).
 *
 * `interactive` is for bodies the curator has to reach into — a
 * long GEO protocol in a `max-h-* overflow-auto` box, say. The
 * default bubble is `pointer-events-none` and dies on the trigger's
 * mouseleave, so its own scrollbar is unreachable: the cursor has to
 * cross the gap to grab it, and the tooltip is gone before it gets
 * there. Interactive mode gives the bubble pointer events, a short
 * grace period to cross that gap, and exempts scrolls that start
 * INSIDE the bubble from the close-on-scroll rule (a scroll event
 * doesn't bubble, but it does reach a capture-phase window listener).
 * Opt-in, because a pointer-events bubble swallows clicks on
 * whatever it covers — which is wrong for a two-word tooltip.
 */

const OPEN_DELAY_MS = 150;
/** Grace period for the cursor to cross the trigger→bubble gap. */
const CLOSE_DELAY_MS = 160;
const VIEWPORT_GUTTER = 6;
const ARROW_SIZE = 5;

export function Tooltip({
  label,
  children,
  side = "top",
  disabled = false,
  interactive = false,
  wide = false,
}: {
  label: ReactNode | string;
  children: ReactElement;
  /** Preferred placement; auto-flips when there's no room. */
  side?: "top" | "bottom";
  /** When true, the tooltip never opens. Useful for conditionally
   *  suppressing tooltips on disabled-looking elements. */
  disabled?: boolean;
  /** Hoverable + scrollable bubble; see the note above. */
  interactive?: boolean;
  /** Widen the bubble to `max-w-md` for prose-length bodies. */
  wide?: boolean;
}) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    placement: "top" | "bottom";
  } | null>(null);

  const clearTimers = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleOpen = useCallback(() => {
    if (disabled) return;
    clearTimers();
    timerRef.current = window.setTimeout(() => {
      setOpen(true);
      timerRef.current = null;
    }, OPEN_DELAY_MS);
  }, [disabled, clearTimers]);

  /** Close now — Escape, blur, page scroll. */
  const cancelOpen = useCallback(() => {
    clearTimers();
    setOpen(false);
  }, [clearTimers]);

  /** Leaving the trigger: interactive bubbles get a grace period so
   *  the cursor can reach them; plain ones close immediately. */
  const scheduleClose = useCallback(() => {
    if (!interactive) {
      cancelOpen();
      return;
    }
    clearTimers();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, CLOSE_DELAY_MS);
  }, [interactive, cancelOpen, clearTimers]);

  /** Cursor made it into the bubble (or came back to the trigger). */
  const keepOpen = useCallback(() => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const t = triggerRef.current;
    const b = bubbleRef.current;
    if (!t || !b) return;
    const rect = t.getBoundingClientRect();
    const bw = b.offsetWidth;
    const bh = b.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let placement: "top" | "bottom" = side;
    let top =
      side === "top"
        ? rect.top - bh - ARROW_SIZE - 2
        : rect.bottom + ARROW_SIZE + 2;
    if (side === "top" && top < VIEWPORT_GUTTER) {
      placement = "bottom";
      top = rect.bottom + ARROW_SIZE + 2;
    } else if (side === "bottom" && top + bh + VIEWPORT_GUTTER > vh) {
      placement = "top";
      top = rect.top - bh - ARROW_SIZE - 2;
    }

    let left = rect.left + rect.width / 2 - bw / 2;
    if (left < VIEWPORT_GUTTER) left = VIEWPORT_GUTTER;
    if (left + bw + VIEWPORT_GUTTER > vw) left = vw - bw - VIEWPORT_GUTTER;
    setPos({ top, left, placement });
  }, [open, side]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") cancelOpen();
    }
    function onScroll(e: Event) {
      // The bubble's own scroller must not close the bubble. Scroll
      // events don't bubble, but this listener is capture-phase on
      // window, so it sees them anyway.
      if (
        interactive &&
        e.target instanceof Node &&
        bubbleRef.current?.contains(e.target)
      ) {
        return;
      }
      cancelOpen();
    }
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, cancelOpen, interactive]);

  if (!isValidElement(children)) {
    return children as unknown as ReactElement;
  }

  const childProps = (children as ReactElement<Record<string, unknown>>).props;
  const enhancedChild = cloneElement(
    children as ReactElement<Record<string, unknown>>,
    {
      ref: (node: HTMLElement | null) => {
        triggerRef.current = node;
        const childRef = (
          children as unknown as { ref?: unknown }
        ).ref;
        if (typeof childRef === "function") {
          (childRef as (n: HTMLElement | null) => void)(node);
        } else if (childRef && typeof childRef === "object") {
          (childRef as { current: HTMLElement | null }).current = node;
        }
      },
      onMouseEnter: (e: React.MouseEvent) => {
        if (open) keepOpen();
        else scheduleOpen();
        const orig = childProps.onMouseEnter as
          | ((ev: React.MouseEvent) => void)
          | undefined;
        if (orig) orig(e);
      },
      onMouseLeave: (e: React.MouseEvent) => {
        scheduleClose();
        const orig = childProps.onMouseLeave as
          | ((ev: React.MouseEvent) => void)
          | undefined;
        if (orig) orig(e);
      },
      onFocus: (e: React.FocusEvent) => {
        scheduleOpen();
        const orig = childProps.onFocus as
          | ((ev: React.FocusEvent) => void)
          | undefined;
        if (orig) orig(e);
      },
      onBlur: (e: React.FocusEvent) => {
        cancelOpen();
        const orig = childProps.onBlur as
          | ((ev: React.FocusEvent) => void)
          | undefined;
        if (orig) orig(e);
      },
    },
  );

  return (
    <>
      {enhancedChild}
      {open
        ? createPortal(
            <div
              ref={bubbleRef}
              role="tooltip"
              className={cn(
                "fixed z-[1000]",
                interactive ? "pointer-events-auto" : "pointer-events-none",
                "rounded px-2 py-1 text-[11px] leading-snug",
                "bg-slate-800 text-slate-50 shadow-md",
                "dark:bg-slate-700 dark:text-slate-50",
                wide ? "max-w-md" : "max-w-[280px]",
                "whitespace-normal break-words",
                pos ? "" : "opacity-0",
              )}
              style={
                pos
                  ? { top: pos.top, left: pos.left }
                  : { top: -9999, left: -9999 }
              }
              onMouseEnter={interactive ? keepOpen : undefined}
              onMouseLeave={interactive ? scheduleClose : undefined}
            >
              {label}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
