import { useEffect, useRef, useState } from "react";
import { shortenUri } from "@/lib/curie";

/**
 * Compact graphical view of an FV / statement-shape value's
 * underlying triples. Three discs joined by short lines:
 *
 *   ●━━●━━●     (all three URI-mapped)
 *   ○━━●━━●     (free-text subject, mapped predicate + object)
 *
 * Green disc = the term has an ontology URI; grey = free-text.
 * Missing predicate / object render as faint outline rings.
 *
 * Curators kept reading single-line FV labels like "ATG9A knockout"
 * as if the whole FV were one free-text blob, missing that it's
 * actually a structured ``has_genotype: knockout`` statement.
 * The glyph names the structure without crowding the row; the full
 * triple text lives in the hover popover. Multi-statement FVs render
 * the first triple plus an ``×N`` count + every triple in the
 * popover.
 *
 * Used in the proposal card (proposed FV row) and the audit
 * proposer-suggestion panel (FV-shape findings) — same shape signal
 * across both surfaces. Tag-shape findings keep the single-``Term``
 * render since they only ever have one slot.
 */
export type GlyphTerm =
  | { label?: string; uri?: string | null }
  | null
  | undefined;

export type GlyphStatement = {
  subject?: GlyphTerm;
  predicate?: GlyphTerm;
  object?: GlyphTerm;
};

export function StatementGlyph({
  statements,
}: {
  statements: GlyphStatement[];
}) {
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const [flipUp, setFlipUp] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const POPOVER_W = 320;
  const POPOVER_H_ESTIMATE = 280;

  // Same dismiss-on-outside-click + Escape pattern as ``Why``.
  useEffect(() => {
    if (!open) return;
    function onDocPointer(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!statements || statements.length === 0) return null;
  const first = statements[0];

  const dotFill = (
    term: GlyphTerm,
  ): { fill: string; stroke: string } => {
    if (!term) return { fill: "transparent", stroke: "rgb(203 213 225)" };
    return term.uri
      ? { fill: "rgb(16 185 129)", stroke: "rgb(5 150 105)" }
      : { fill: "rgb(203 213 225)", stroke: "rgb(148 163 184)" };
  };

  const sDot = dotFill(first.subject);
  const pDot = dotFill(first.predicate);
  const oDot = dotFill(first.object);

  return (
    <span
      ref={wrapRef}
      className="relative inline-flex items-center gap-0.5 ml-1 align-middle"
    >
      <button
        type="button"
        aria-label="show statement structure"
        aria-expanded={open}
        title="show statement structure"
        className={`inline-flex items-center justify-center cursor-pointer rounded-sm px-0.5 ${
          open
            ? "bg-slate-200 dark:bg-slate-700"
            : "hover:bg-slate-100 dark:hover:bg-slate-800"
        }`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!open && wrapRef.current) {
            const rect = wrapRef.current.getBoundingClientRect();
            const margin = 8;
            setFlip(rect.left + POPOVER_W > window.innerWidth - margin);
            setFlipUp(
              rect.bottom + POPOVER_H_ESTIMATE + margin >
                window.innerHeight && rect.top > POPOVER_H_ESTIMATE,
            );
          }
          setOpen((v) => !v);
        }}
      >
        <svg width="34" height="10" viewBox="0 0 34 10" role="img">
          <line x1="4" y1="5" x2="13" y2="5" stroke="rgb(148 163 184)" strokeWidth="1" />
          <line x1="21" y1="5" x2="30" y2="5" stroke="rgb(148 163 184)" strokeWidth="1" />
          <circle cx="4" cy="5" r="2.5" fill={sDot.fill} stroke={sDot.stroke} strokeWidth="1" />
          <circle cx="17" cy="5" r="2.5" fill={pDot.fill} stroke={pDot.stroke} strokeWidth="1" />
          <circle cx="30" cy="5" r="2.5" fill={oDot.fill} stroke={oDot.stroke} strokeWidth="1" />
        </svg>
        {statements.length > 1 ? (
          <span className="text-[10px] text-slate-500 dark:text-slate-400 leading-none ml-0.5">
            ×{statements.length}
          </span>
        ) : null}
      </button>
      {open && (
        <div
          role="tooltip"
          className={`absolute z-30 ${flip ? "right-0" : "left-0"} ${
            flipUp ? "bottom-full mb-1" : "top-full mt-1"
          } w-80 max-w-[80vw] rounded-md border border-slate-200 bg-white shadow-lg p-2 text-xs text-slate-700 leading-snug dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200`}
        >
          <div className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">
            {statements.length === 1
              ? "Statement"
              : `${statements.length} statements`}
          </div>
          <ul className="space-y-1.5">
            {statements.map((s, i) => (
              <li
                key={i}
                className={`${
                  i > 0
                    ? "pt-1.5 border-t border-slate-100 dark:border-slate-800"
                    : ""
                }`}
              >
                <GlyphTermRow role="subject" term={s.subject} />
                <GlyphTermRow role="predicate" term={s.predicate} />
                <GlyphTermRow role="object" term={s.object} />
              </li>
            ))}
          </ul>
          <div className="mt-2 pt-1.5 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
              ontology term
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-500" />
              free-text
            </span>
          </div>
        </div>
      )}
    </span>
  );
}

/** One row inside the StatementGlyph popover. Renders the role,
 *  the label (italic when free-text), and a linkified curie when
 *  the term has a URI. Missing predicate / object → em dash. */
function GlyphTermRow({
  role,
  term,
}: {
  role: "subject" | "predicate" | "object";
  term: GlyphTerm;
}) {
  const ROLE_LABEL: Record<typeof role, string> = {
    subject: "S",
    predicate: "P",
    object: "O",
  };
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500 w-3 text-right">
        {ROLE_LABEL[role]}
      </span>
      {!term ? (
        <span className="text-slate-400 dark:text-slate-500">—</span>
      ) : (
        <>
          <span
            className={
              term.uri
                ? "text-slate-800 dark:text-slate-100"
                : "text-slate-600 dark:text-slate-300 italic"
            }
          >
            {term.label || "—"}
          </span>
          {term.uri ? (
            <a
              href={term.uri}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[10px] text-slate-400 hover:text-blue-700 hover:underline dark:text-slate-500 dark:hover:text-blue-300"
              onClick={(e) => e.stopPropagation()}
              title={term.uri}
            >
              {shortenUri(term.uri)}
            </a>
          ) : (
            <span className="text-[10px] text-slate-400 dark:text-slate-500">
              free-text
            </span>
          )}
        </>
      )}
    </div>
  );
}
