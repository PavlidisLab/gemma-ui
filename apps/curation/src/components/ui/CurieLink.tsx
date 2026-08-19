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
import { useEffect, useRef, useState } from "react";
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
  /** Keep focus where it is when the chip is clicked. For chips
   *  inside a focus-scoped overlay (the term-picker dropdown lives
   *  on its input's blur), letting the button take focus closes the
   *  very surface the popover is anchored to. */
  preserveFocus?: boolean;
  /** Popover open/close notifications, so a blur-managed host can
   *  suspend its close-on-blur while the curator is inspecting the
   *  term. Also fired with ``false`` if the chip unmounts with the
   *  popover open (the host's hold must not outlive the popover). */
  onOpenChange?: (open: boolean) => void;
  /** Stacking override passed to the popover — see
   *  ``CuriePopoverProps.zIndex``. */
  popoverZIndex?: number;
}

const DEFAULT_CLS =
  "text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 font-mono text-[10px] whitespace-nowrap no-underline hover:underline cursor-pointer bg-transparent border-0 p-0";

export function CurieLink({
  uri,
  display,
  className,
  title,
  preserveFocus,
  onOpenChange,
  popoverZIndex,
}: CurieLinkProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  // Refs so the unmount cleanup below reads the CURRENT open state and
  // callback, not the ones captured on mount — and so notification
  // happens outside the state updater (StrictMode double-invokes
  // updaters; a side effect there would fire the host twice).
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const openRef = useRef(open);
  openRef.current = open;

  const setOpenNotified = (next: boolean) => {
    if (next !== openRef.current) onOpenChangeRef.current?.(next);
    setOpen(next);
  };

  // A host holding state on our behalf (see ``onOpenChange``) must be
  // released if the chip unmounts while open — the picker's rows
  // re-render away on every keystroke, and a hold with no popover left
  // to close it would wedge the host permanently.
  useEffect(() => {
    return () => {
      if (openRef.current) onOpenChangeRef.current?.(false);
    };
  }, []);

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
          setOpenNotified(!open);
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
          // Keep the focus owner focused (a picker input, say) — the
          // click still fires; only the focus shift is suppressed.
          if (preserveFocus) e.preventDefault();
        }}
        className={className ?? DEFAULT_CLS}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {display ?? shortenUri(uri)}
      </button>
      {open && rect ? (
        <CuriePopover
          uri={uri}
          anchorRect={rect}
          onClose={() => setOpenNotified(false)}
          zIndex={popoverZIndex}
        />
      ) : null}
    </>
  );
}
