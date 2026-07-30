/**
 * Generic prose-orientation slot for the top of a panel.
 *
 * Render-the-string component — takes an optional text and renders
 * it as a methods-paragraph-style block above whatever interactive
 * content follows. Knows nothing about the source of the text. Drop
 * it anywhere a panel wants a paragraph of context above the active
 * surface (audit findings list, proposal review card, ticket detail,
 * preboarding, …) by passing the relevant string in.
 *
 * Design constraints per design review (2026-06-12): no border, no
 * icon, no badge, no heading. Reads as
 * methods-section prose above a results table. The slot's job is to
 * orient the curator before they look at the interactive content; if
 * it competed visually with the cards it would just be noise.
 *
 * Suppresses ENTIRELY when text is null / undefined / empty /
 * whitespace-only — no "no summary available" caption, no empty
 * frame. Old packages + tags-only audits should render identically
 * to today.
 *
 * Long text collapses to a preview with a "show more" toggle. Default
 * threshold is 400 characters; callers can override via
 * ``collapseChars``. The collapse trigger is character-count rather
 * than paragraph-count because the slot may receive single long
 * paragraphs without internal newlines.
 */
import { useState } from "react";

export interface OrientationProseProps {
  /** The prose text to render. Null / undefined / empty / whitespace
   *  → component returns null and renders nothing at all (no
   *  wrapping div). */
  text: string | null | undefined;
  /** Character budget above which the text collapses to a preview
   *  with a "show more" toggle. Defaults to 400. */
  collapseChars?: number;
  /** Optional extra className for spacing / max-width overrides. */
  className?: string;
}

const DEFAULT_COLLAPSE_CHARS = 400;

/** Resolve the empty-state suppression rule. Returns the trimmed
 *  text when there's something to render; ``null`` for null /
 *  undefined / empty / whitespace-only input. Exported for unit
 *  tests; the component uses it internally. */
export function resolveOrientationText(
  text: string | null | undefined,
): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  return trimmed ? trimmed : null;
}

/** Cut the preview at a word boundary near ``budget`` so the
 *  collapsed form doesn't slice through a word. Falls back to a hard
 *  cut when no whitespace lands in the back-half of the budget.
 *  Exported for unit tests; not part of the component's public API. */
export function previewOf(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const cut = text.slice(0, budget);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > budget * 0.6) return cut.slice(0, lastSpace);
  return cut;
}

export function OrientationProse({
  text,
  collapseChars = DEFAULT_COLLAPSE_CHARS,
  className,
}: OrientationProseProps): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const trimmed = resolveOrientationText(text);
  if (!trimmed) return null;

  const isLong = trimmed.length > collapseChars;
  const shown = !isLong || expanded ? trimmed : previewOf(trimmed, collapseChars);
  const cls =
    "text-[12px] leading-snug text-slate-800 dark:text-slate-200 whitespace-pre-wrap" +
    (className ? ` ${className}` : "");

  return (
    <div className={cls}>
      {shown}
      {isLong && !expanded ? (
        <>
          <span className="text-slate-400 dark:text-slate-500">… </span>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-[11px] text-blue-600 hover:underline underline-offset-2 dark:text-blue-300"
            aria-label="Show full text"
          >
            show more
          </button>
        </>
      ) : null}
      {isLong && expanded ? (
        <>
          {" "}
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="text-[11px] text-blue-600 hover:underline underline-offset-2 dark:text-blue-300"
            aria-label="Collapse text"
          >
            show less
          </button>
        </>
      ) : null}
    </div>
  );
}
