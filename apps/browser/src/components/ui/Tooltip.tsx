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

/**
 * Lightweight hover tooltip ported from apps/curation. Replaces the
 * browser-native ``title=`` attribute where we want a styled,
 * faster-popup tooltip that matches the rest of the app chrome.
 * Portal-mounted so the bubble escapes any overflow-clipped parent.
 *
 * Defaults:
 *  - 60ms open delay (Paul: much faster than native ~700ms).
 *  - Above the trigger; auto-flips below if no room.
 *  - 320px max width with line-wrapping; long strings stay legible.
 *  - Closes on mouseleave / blur / Escape / scroll.
 *
 * Usage:
 *
 *   <Tooltip label="distinct ontology terms in use">
 *     <span>(i)</span>
 *   </Tooltip>
 *
 * The single child must be an element that accepts ref + standard
 * hover/focus handlers.
 */

const OPEN_DELAY_MS = 60;
const VIEWPORT_GUTTER = 6;
const ARROW_SIZE = 5;

export function Tooltip({
  label,
  children,
  side = "top",
  disabled = false,
}: {
  label: ReactNode | string;
  children: ReactElement;
  side?: "top" | "bottom";
  disabled?: boolean;
}) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    placement: "top" | "bottom";
  } | null>(null);

  const scheduleOpen = useCallback(() => {
    if (disabled) return;
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setOpen(true);
      timerRef.current = null;
    }, OPEN_DELAY_MS);
  }, [disabled]);

  const cancelOpen = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setOpen(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, []);

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
    function onScroll() {
      cancelOpen();
    }
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, cancelOpen]);

  if (!isValidElement(children)) {
    return children as unknown as ReactElement;
  }

  const childProps = (children as ReactElement<Record<string, unknown>>).props;
  const enhancedChild = cloneElement(
    children as ReactElement<Record<string, unknown>>,
    {
      ref: (node: HTMLElement | null) => {
        triggerRef.current = node;
        const childRef = (children as unknown as { ref?: unknown }).ref;
        if (typeof childRef === "function") {
          (childRef as (n: HTMLElement | null) => void)(node);
        } else if (childRef && typeof childRef === "object") {
          (childRef as { current: HTMLElement | null }).current = node;
        }
      },
      onMouseEnter: (e: React.MouseEvent) => {
        scheduleOpen();
        const orig = childProps.onMouseEnter as
          | ((ev: React.MouseEvent) => void)
          | undefined;
        if (orig) orig(e);
      },
      onMouseLeave: (e: React.MouseEvent) => {
        cancelOpen();
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
              className={[
                "fixed z-[1000] pointer-events-none",
                "rounded px-2.5 py-1.5 text-[11px] leading-snug",
                "bg-stone-900 text-stone-50 shadow-lg",
                "max-w-[320px] whitespace-normal break-words",
                pos ? "" : "opacity-0",
              ].join(" ")}
              style={
                pos
                  ? { top: pos.top, left: pos.left }
                  : { top: -9999, left: -9999 }
              }
            >
              {label}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
