import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * Small "?" affordance that opens a popover with curation-guideline
 * content. Click to toggle, click-outside or Esc to close.
 *
 * Use this everywhere the curator might need a reminder of the
 * Confluence rule for a specific surface — per-category EFC cards,
 * predicate picker, baseline marker, tag panel, etc.
 *
 * Implementation: the popover renders via `createPortal` to
 * `document.body` so it escapes any ancestor `overflow:hidden` /
 * `overflow:auto` / stacking-context clipping (the audit sidebar
 * scrolls, the result cards stack — both used to clip the popup).
 * Positioning is computed from the trigger's `getBoundingClientRect()`
 * and flipped / nudged to stay in-viewport.
 */
export function HelpPopup({
  title,
  source,
  sourceUrl,
  links,
  footer,
  children,
  size = "sm",
  align = "left",
  trigger,
  triggerClassName,
}: {
  /** Heading shown at the top of the popover. */
  title: string;
  /** Confluence page label (e.g. "Curating Genotype EFCs"). */
  source?: string;
  /** Direct link to the Confluence page. */
  sourceUrl?: string;
  /** Optional click-out anchors rendered above the source line. Each
   *  opens in a new tab. Used by ``RuleCite`` to surface a precise
   *  rule's wiki links; existing snippet callers pass nothing. */
  links?: { title: string; url: string }[];
  /** Optional extra footer content (e.g. a "more →" topic link). */
  footer?: ReactNode;
  /** Body content — usually a few short lines / a list. */
  children: ReactNode;
  /** Popover width. */
  size?: "sm" | "md" | "lg";
  /** Horizontal alignment relative to the trigger. */
  align?: "left" | "right";
  /** Override the default round "?" trigger with custom content
   *  (e.g. a text link like "Reasoning ▸"). When set,
   *  ``triggerClassName`` replaces the default button styles. */
  trigger?: ReactNode;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // ``HTMLSpanElement`` rather than ``HTMLButtonElement`` because the
  // trigger renders as ``<span role="button">`` — a real ``<button>``
  // gets ``disabled`` by an ancestor ``<fieldset disabled>``, but
  // HelpPopup is a pure read-only help affordance that should fire
  // regardless of edit-mode context (design review 2026-05-29: "curator
  // guidelines aren't appearing on the design tab" was this gating
  // bug). Span+role="button" bypasses fieldset disabled cleanly.
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const widthPx = size === "lg" ? 448 : size === "md" ? 384 : 288;
  const heightEstimate = 420;
  const margin = 8;

  // Re-measure on open (and on resize/scroll while open).
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    function measure() {
      const t = triggerRef.current;
      if (!t) return;
      const rect = t.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Horizontal: align left or right of the trigger, then clamp into viewport.
      let left = align === "right" ? rect.right - widthPx : rect.left;
      if (left + widthPx + margin > vw) left = vw - widthPx - margin;
      if (left < margin) left = margin;
      // Vertical: prefer below, flip above if it would overflow the
      // bottom and there's more room above.
      let top = rect.bottom + 4;
      if (top + heightEstimate + margin > vh && rect.top > heightEstimate) {
        top = rect.top - heightEstimate - 4;
      }
      if (top < margin) top = margin;
      setPos({ top, left });
    }
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, align, widthPx]);

  // Click-outside / Escape close.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const popover =
    open && pos
      ? createPortal(
          <div
            ref={popoverRef}
            className="fixed z-[1000] bg-white border border-slate-300 ring-1 ring-black/10 rounded shadow-xl text-xs text-slate-700 dark:bg-slate-800 dark:border-slate-500 dark:ring-black/40 dark:text-slate-200"
            style={{ top: pos.top, left: pos.left, width: widthPx }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2 border-b border-slate-100 flex items-baseline justify-between gap-2 dark:border-slate-700">
              <span className="font-semibold text-slate-800 dark:text-slate-100">
                {title}
              </span>
              <button
                type="button"
                className="text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200"
                onClick={() => setOpen(false)}
                title="close"
              >
                ×
              </button>
            </div>
            <div className="px-3 py-2 space-y-1.5 max-h-96 overflow-auto">
              {children}
            </div>
            {links?.length ? (
              <div className="px-3 py-1.5 border-t border-slate-100 space-y-0.5 dark:border-slate-700">
                {links.map((l, i) => (
                  <div key={i}>
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sky-700 hover:underline dark:text-sky-400"
                    >
                      {l.title} ↗
                    </a>
                  </div>
                ))}
              </div>
            ) : null}
            {footer ? (
              <div className="px-3 py-1.5 border-t border-slate-100 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
                {footer}
              </div>
            ) : null}
            {source ? (
              <div className="px-3 py-1.5 border-t border-slate-100 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Source:{" "}
                {sourceUrl ? (
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-700 hover:underline dark:text-sky-400"
                  >
                    {source}
                  </a>
                ) : (
                  <span>{source}</span>
                )}
              </div>
            ) : null}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <span
        ref={triggerRef}
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        className={
          triggerClassName ??
          "inline-flex items-center justify-center w-4 h-4 rounded-full border border-slate-300 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-900 text-[10px] leading-none align-middle dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100 cursor-pointer"
        }
        title={trigger ? title : `Curation guidelines: ${title}`}
        aria-label={`help: ${title}`}
      >
        {trigger ?? "?"}
      </span>
      {popover}
    </>
  );
}
