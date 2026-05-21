import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

/**
 * Document-level hover/focus listener that upgrades every native
 * `title="..."` attribute on the page to the styled Tooltip
 * chrome (slate-800 bubble, faster delay, portal-mounted).
 *
 * Mount once at the App root — no per-element refactoring needed.
 * Authors keep writing `<button title="...">` as usual; this
 * intercepts the hover and renders a prettier popup.
 *
 * Mechanics:
 *
 * 1. On `mouseover` / `focusin` we walk up the event target chain
 *    looking for the nearest element with a non-empty `title`.
 * 2. We STRIP the `title` attribute (preserving the original under
 *    `data-tt`) so the browser-native tooltip doesn't fire on top
 *    of our styled one.
 * 3. After a short delay we render the styled bubble, positioned
 *    above the element (auto-flips to below if no room).
 * 4. On `mouseout` / `focusout` we restore the title attribute and
 *    hide the bubble.
 *
 * Caveats this handles:
 *  - React re-renders during hover re-write the `title` attribute.
 *    A MutationObserver re-strips it.
 *  - The currently-hovered element might detach from the DOM
 *    (cards getting un-rendered while we hover). We watch for
 *    that and hide the bubble.
 *  - The tooltip itself is `pointer-events-none` so it never
 *    catches the mouse and creates flicker.
 *
 * Behaviour NOT changed:
 *  - Elements that already use `<Tooltip>` keep working — they
 *    don't have a `title` attribute so the hover walk skips
 *    them.
 *  - The browser-native title attribute is preserved for
 *    accessibility tools (screen readers, automation) — we only
 *    remove it during the active hover window, then restore.
 */

const OPEN_DELAY_MS = 150;
const VIEWPORT_GUTTER = 6;
const ARROW_OFFSET = 6;
const STORED_KEY = "data-tt";

interface ActiveTooltip {
  el: HTMLElement;
  text: string;
}

function findTitledAncestor(start: EventTarget | null): {
  el: HTMLElement;
  text: string;
} | null {
  let el = start as HTMLElement | null;
  while (el && el.nodeType === 1) {
    const live = el.getAttribute("title");
    if (live && live.trim().length > 0) {
      return { el, text: live };
    }
    const stored = el.getAttribute(STORED_KEY);
    if (stored && stored.trim().length > 0) {
      return { el, text: stored };
    }
    el = el.parentElement;
  }
  return null;
}

function stripTitle(el: HTMLElement, text: string) {
  el.setAttribute(STORED_KEY, text);
  el.removeAttribute("title");
}

function restoreTitle(el: HTMLElement) {
  const stored = el.getAttribute(STORED_KEY);
  if (stored != null) {
    el.setAttribute("title", stored);
    el.removeAttribute(STORED_KEY);
  }
}

export function GlobalTooltips() {
  const [active, setActive] = useState<ActiveTooltip | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(
    null,
  );
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const observerRef = useRef<MutationObserver | null>(null);

  // Open / close handlers
  useEffect(() => {
    function clearOpenTimer() {
      if (openTimerRef.current != null) {
        window.clearTimeout(openTimerRef.current);
        openTimerRef.current = null;
      }
    }

    function close(restoreEl?: HTMLElement) {
      clearOpenTimer();
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      if (restoreEl) restoreTitle(restoreEl);
      setActive((prev) => {
        if (prev && !restoreEl) restoreTitle(prev.el);
        return null;
      });
      setPos(null);
    }

    function open(el: HTMLElement, text: string) {
      clearOpenTimer();
      stripTitle(el, text);
      openTimerRef.current = window.setTimeout(() => {
        setActive({ el, text });
        // Watch for React re-renders that re-add the `title`
        // attribute mid-hover; if seen, re-strip so the native
        // bubble doesn't pop on top of ours.
        const obs = new MutationObserver(() => {
          const live = el.getAttribute("title");
          if (live && live.length > 0) {
            stripTitle(el, live);
            setActive({ el, text: live });
          }
          if (!document.body.contains(el)) {
            close();
          }
        });
        obs.observe(el, {
          attributes: true,
          attributeFilter: ["title"],
        });
        observerRef.current = obs;
        openTimerRef.current = null;
      }, OPEN_DELAY_MS);
    }

    function onPointerOver(e: PointerEvent) {
      const hit = findTitledAncestor(e.target);
      if (!hit) {
        // Pointer moved off any titled element while open
        if (active) close();
        return;
      }
      if (active && active.el === hit.el) return;
      if (active) restoreTitle(active.el);
      open(hit.el, hit.text);
    }

    function onPointerOut(e: PointerEvent) {
      // pointerout fires when moving between children of the
      // titled element too — only close when leaving the element
      // entirely.
      const related = e.relatedTarget as Node | null;
      if (
        active &&
        active.el !== related &&
        (!related || !active.el.contains(related))
      ) {
        close();
      }
    }

    function onFocusIn(e: FocusEvent) {
      const hit = findTitledAncestor(e.target);
      if (!hit) return;
      if (active && active.el === hit.el) return;
      if (active) restoreTitle(active.el);
      open(hit.el, hit.text);
    }

    function onFocusOut() {
      if (active) close();
    }

    function onScroll() {
      if (active) close();
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && active) close();
    }

    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointerout", onPointerOut, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    window.addEventListener("scroll", onScroll, true);
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("pointerover", onPointerOver, true);
      document.removeEventListener("pointerout", onPointerOut, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
      window.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("keydown", onKey);
      clearOpenTimer();
      if (observerRef.current) observerRef.current.disconnect();
      if (active) restoreTitle(active.el);
    };
  }, [active]);

  // Position the bubble whenever the active element changes.
  useLayoutEffect(() => {
    if (!active) {
      setPos(null);
      return;
    }
    const el = active.el;
    const b = bubbleRef.current;
    if (!b) return;
    const rect = el.getBoundingClientRect();
    const bw = b.offsetWidth;
    const bh = b.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = rect.top - bh - ARROW_OFFSET;
    if (top < VIEWPORT_GUTTER) {
      top = rect.bottom + ARROW_OFFSET;
    }
    if (top + bh + VIEWPORT_GUTTER > vh) {
      top = Math.max(VIEWPORT_GUTTER, vh - bh - VIEWPORT_GUTTER);
    }

    let left = rect.left + rect.width / 2 - bw / 2;
    if (left < VIEWPORT_GUTTER) left = VIEWPORT_GUTTER;
    if (left + bw + VIEWPORT_GUTTER > vw) {
      left = vw - bw - VIEWPORT_GUTTER;
    }
    setPos({ top, left });
  }, [active]);

  if (!active) return null;

  return createPortal(
    <div
      ref={bubbleRef}
      role="tooltip"
      className={cn(
        "fixed z-[1000] pointer-events-none",
        "rounded px-2 py-1 text-[11px] leading-snug",
        "bg-slate-800 text-slate-50 shadow-md",
        "dark:bg-slate-700 dark:text-slate-50",
        "max-w-[320px] whitespace-pre-wrap break-words",
        pos ? "" : "opacity-0",
      )}
      style={
        pos
          ? { top: pos.top, left: pos.left }
          : { top: -9999, left: -9999 }
      }
    >
      {active.text}
    </div>,
    document.body,
  );
}
