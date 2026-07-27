/**
 * Tiny modular CURIE chip — the ``EFO:0005263`` shortform next to a
 * term label that, on click, opens an inline ``CuriePopover`` with
 * the term's label / definition / parents (from Gemma, with an
 * explicit "fetch from OLS" fallback button).
 *
 * Drop this anywhere a CURIE needs to render. The component owns
 * its own anchor-rect tracking + popover open state so callers
 * don't have to plumb that through. Click event bubbling is
 * stopped at the button so the surrounding card / row / cell
 * doesn't react.
 *
 * Used by:
 *   - ``Term`` (the canonical term chip) — most surfaces inherit
 *     the popover from this single wire.
 *   - any custom term renderer in features/* that builds its own
 *     chip shape (search the repo for ``shortenUri(uri)`` if you
 *     find a surface still rendering CURIEs as plain spans —
 *     swap in ``<CurieLink uri={uri} />`` and you're done).
 *
 * Per design review 2026-06-13: "make sure this is a modular item that
 * shows up for all places ontology terms go".
 */
import { useRef, useState } from "react";
import { shortenUri } from "@/lib/curie";
import { CuriePopover } from "./CuriePopover";

export interface CurieLinkProps {
  /** The full URI or CURIE. ``null`` / empty → renders nothing. */
  uri: string | null | undefined;
  /** Override the displayed shortened text. Defaults to
   *  ``shortenUri(uri)``. Useful when the caller already computed
   *  a custom display (e.g. ``NCBI:gene:12345``). */
  display?: string;
  /** className override for the visible chip text. The default
   *  styling matches the Term-chip CURIE suffix (mono, 10px,
   *  slate). */
  className?: string;
  /** Optional surrounding text for the ``title`` hover. Defaults
   *  to the raw URI. */
  title?: string;
}

const DEFAULT_CLS =
  "text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 font-mono text-[10px] whitespace-nowrap no-underline hover:underline cursor-pointer bg-transparent border-0 p-0";

export function CurieLink({
  uri,
  display,
  className,
  title,
}: CurieLinkProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  if (!uri) return null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title={title ?? uri}
        onClick={(e) => {
          // Don't let the click bubble to a parent card / row /
          // cell click handler — the curator's intent is verify
          // the term, not toggle the surface around it.
          e.stopPropagation();
          if (btnRef.current) {
            setRect(btnRef.current.getBoundingClientRect());
          }
          setOpen((v) => !v);
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className={className ?? DEFAULT_CLS}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {display ?? shortenUri(uri)}
      </button>
      {open && rect ? (
        <CuriePopover uri={uri} anchorRect={rect} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
