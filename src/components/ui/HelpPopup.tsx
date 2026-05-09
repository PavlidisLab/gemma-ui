import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Small "?" affordance that opens a popover with curation-guideline
 * content. Click to toggle, click-outside or Esc to close.
 *
 * Use this everywhere the curator might need a reminder of the
 * Confluence rule for a specific surface — per-category EFC cards,
 * predicate picker, baseline marker, tag panel, etc.
 */
export function HelpPopup({
  title,
  source,
  sourceUrl,
  children,
  size = "sm",
  align = "left",
}: {
  /** Heading shown at the top of the popover. */
  title: string;
  /** Confluence page label (e.g. "Curating Genotype EFCs"). */
  source?: string;
  /** Direct link to the Confluence page. */
  sourceUrl?: string;
  /** Body content — usually a few short lines / a list. */
  children: ReactNode;
  /** Popover width. */
  size?: "sm" | "md" | "lg";
  /** Horizontal alignment relative to the trigger. */
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  // Flip above the trigger when below would overflow the viewport
  // bottom. Same pattern as the audit-card popovers — measured on
  // open from the trigger's bounding rect.
  const [flipUp, setFlipUp] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
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

  const widthCls = {
    sm: "w-72",
    md: "w-96",
    lg: "w-[28rem]",
  }[size];

  const alignCls = align === "right" ? "right-0" : "left-0";

  return (
    <span ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          // Measure synchronously before toggling so the popover
          // opens in the right direction on first paint. Estimate
          // the body height conservatively — body caps at max-h-96
          // (~24rem) plus header + footer.
          if (!open && ref.current) {
            const rect = ref.current.getBoundingClientRect();
            const margin = 8;
            const POPOVER_H_ESTIMATE = 420;
            setFlipUp(
              rect.bottom + POPOVER_H_ESTIMATE + margin >
                window.innerHeight && rect.top > POPOVER_H_ESTIMATE,
            );
          }
          setOpen((v) => !v);
        }}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-slate-300 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-900 text-[10px] leading-none align-middle dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100"
        title={`Curation guidelines: ${title}`}
        aria-label={`help: ${title}`}
      >
        ?
      </button>
      {open ? (
        <div
          className={`absolute z-40 ${alignCls} ${
            flipUp ? "bottom-full mb-1" : "top-full mt-1"
          } ${widthCls} bg-white border border-slate-200 rounded shadow-lg text-xs text-slate-700 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 border-b border-slate-100 flex items-baseline justify-between gap-2 dark:border-slate-800">
            <span className="font-semibold text-slate-800 dark:text-slate-100">{title}</span>
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
          {source ? (
            <div className="px-3 py-1.5 border-t border-slate-100 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
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
        </div>
      ) : null}
    </span>
  );
}
