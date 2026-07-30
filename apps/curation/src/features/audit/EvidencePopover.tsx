/**
 * On-demand evidence affordance for compact surfaces (tag chips, list
 * rows) where a full inline blockquote would clutter. A small ❝ glyph
 * marks an item that carries verbatim provenance; clicking pops a
 * portal panel that reuses the audit ``FindingEvidenceBlock`` — same
 * per-source colour + quote + location rendering the finding cards
 * use, so curators learn one evidence visual, not two. Design goal:
 * clearly identifiable, not cluttered.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FindingEvidence } from "@/api/auditTypes";
import { cn } from "@/lib/cn";
import { FindingEvidenceBlock } from "./agentDetailsPanel";

/** Anchored popover listing each evidence row as a FindingEvidenceBlock. */
export function EvidencePopover({
  evidence,
  anchorRect,
  onClose,
}: {
  evidence: FindingEvidence[];
  anchorRect: DOMRect;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({
    left: anchorRect.left,
    top: anchorRect.bottom + 6,
  });

  // Position below the anchor, flipping above / clamping into the
  // viewport — same approach as CuriePopover.
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
  }, [anchorRect]);

  // Outside-click + Escape close.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (e.target instanceof Node && !ref.current.contains(e.target)) onClose();
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
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Evidence"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className="fixed z-50 rounded-md border border-slate-300 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800 max-w-sm min-w-[18rem] text-[11px]"
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="px-2 py-1.5 flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-700">
        <span className="text-[9px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
          Evidence{evidence.length > 1 ? ` · ${evidence.length}` : ""}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="text-[10px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <div className="px-2 py-2 space-y-1.5 max-h-80 overflow-y-auto">
        {evidence.map((e, i) => (
          <FindingEvidenceBlock key={i} evidence={e} />
        ))}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The ❝ glyph that sits beside a chip / row carrying evidence. Renders
 * nothing when there's no evidence, so callers can drop it next to any
 * chip unconditionally:
 *
 *   <TagChip … /> <EvidenceTrigger evidence={tag.supporting_evidence} />
 */
export function EvidenceTrigger({
  evidence,
  className,
}: {
  evidence: FindingEvidence[] | null | undefined;
  className?: string;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  if (!evidence || evidence.length === 0) return null;
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setAnchor(
            anchor ? null : e.currentTarget.getBoundingClientRect(),
          );
        }}
        className={cn(
          "inline-flex items-center justify-center text-[11px] leading-none text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 shrink-0",
          anchor && "text-slate-700 dark:text-slate-200",
          className,
        )}
        title={`evidence available (${evidence.length} quote${evidence.length === 1 ? "" : "s"}) — click to view`}
        aria-label="Show evidence"
      >
        ❝
      </button>
      {anchor ? (
        <EvidencePopover
          evidence={evidence}
          anchorRect={anchor}
          onClose={() => setAnchor(null)}
        />
      ) : null}
    </>
  );
}
