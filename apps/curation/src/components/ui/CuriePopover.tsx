/**
 * Inline term-detail popover anchored to a CURIE chip.
 *
 * Curator clicks the small CURIE portion of a Term chip and gets a
 * small floating card with the term's label, definition, parents,
 * and a footer source pill ("from Gemma" / "from OLS"). Beats
 * tabbing out to ``purl.obolibrary.org`` for the quick-verify case
 * — the canonical resolver is still available via the
 * "open in OBO ↗" link inside the popover.
 *
 * Two-stage fetch (per Paul 2026-06-13 "fallback to OLS: require
 * another click"):
 *   1. On open, fetch from Gemma's ``/annotations/term``. If Gemma
 *      knows the term, render it.
 *   2. If Gemma returns null, show a "Fetch from OLS" button. Click
 *      enables the OLS query.
 *
 * Click-out / Escape closes. ``stopPropagation`` on every interactive
 * element so the underlying card (audit row, FV picker, …) doesn't
 * react to popover clicks.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useGemmaTerm, useOlsTerm } from "@/api/annotations";
import { curieToUrl, shortenUri } from "@/lib/curie";

export interface CuriePopoverProps {
  uri: string;
  /** Anchor element — popover positions itself relative to it. */
  anchorRect: DOMRect;
  onClose: () => void;
}

export function CuriePopover({ uri, anchorRect, onClose }: CuriePopoverProps) {
  const [olsRequested, setOlsRequested] = useState(false);
  const gemma = useGemmaTerm(uri);
  const ols = useOlsTerm(uri, olsRequested);

  const gemmaDone = !gemma.isLoading;
  const gemmaHit = !!gemma.data;
  // Show OLS results when the curator explicitly requested them.
  // Falls back to Gemma's result whenever both are present and OLS
  // wasn't requested (so we don't surprise the curator by switching
  // sources after they didn't ask).
  const detail = olsRequested && ols.data ? ols.data : gemma.data ?? null;
  const showOlsCta = gemmaDone && !gemmaHit && !olsRequested;

  // Position: below the chip if there's room, else above. Width
  // capped so the popover doesn't blow up on a wide screen.
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({
    left: anchorRect.left,
    top: anchorRect.bottom + 6,
  });
  useEffect(() => {
    if (!popoverRef.current) return;
    const rect = popoverRef.current.getBoundingClientRect();
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
  }, [anchorRect, detail]);

  // Outside-click + Escape close.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!popoverRef.current) return;
      if (e.target instanceof Node && !popoverRef.current.contains(e.target)) {
        onClose();
      }
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
      ref={popoverRef}
      role="dialog"
      aria-label={`Ontology term ${shortenUri(uri)}`}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className="fixed z-50 rounded-md border border-slate-300 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800 max-w-sm min-w-[18rem] text-[11px]"
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="px-3 py-2 space-y-1.5">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
            {shortenUri(uri)}
          </span>
          {detail?.ontology ? (
            <span className="text-[9px] uppercase tracking-wide text-slate-400">
              {detail.ontology}
            </span>
          ) : null}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="ml-auto text-[10px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {gemma.isLoading ? (
          <Loading />
        ) : detail ? (
          <Body detail={detail} />
        ) : showOlsCta ? (
          <NotInGemmaCta
            uri={uri}
            onFetchOls={() => setOlsRequested(true)}
          />
        ) : ols.isLoading ? (
          <Loading source="ols" />
        ) : (
          <NotFound uri={uri} />
        )}
      </div>
    </div>,
    document.body,
  );
}

function Loading({ source }: { source?: "ols" }) {
  return (
    <div className="text-slate-500 dark:text-slate-400 italic">
      {source === "ols" ? "Fetching from OLS…" : "Looking up…"}
    </div>
  );
}

function Body({
  detail,
}: {
  detail: NonNullable<ReturnType<typeof useGemmaTerm>["data"]>;
}) {
  return (
    <>
      <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
        {detail.label || <em className="text-slate-400">(no label)</em>}
      </div>
      {detail.definition ? (
        <div className="text-slate-600 dark:text-slate-300 leading-snug">
          {detail.definition}
        </div>
      ) : (
        <div className="italic text-slate-400 dark:text-slate-500">
          No definition recorded
        </div>
      )}
      {detail.parents.length > 0 ? (
        <div className="text-[10px] text-slate-500 dark:text-slate-400">
          <span className="font-semibold">parents: </span>
          {detail.parents.join(", ")}
        </div>
      ) : null}
      <div className="flex items-baseline gap-2 pt-1 border-t border-slate-200 dark:border-slate-700 mt-1">
        <span
          className={
            detail.source === "ols"
              ? "text-[9px] uppercase tracking-wide text-indigo-700 dark:text-indigo-300"
              : "text-[9px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300"
          }
        >
          {detail.source === "ols" ? "from OLS" : "from Gemma"}
        </span>
        {detail.canonicalUrl ? (
          <a
            href={detail.canonicalUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="ml-auto text-[10px] text-blue-700 hover:underline dark:text-blue-300"
          >
            open in OBO ↗
          </a>
        ) : null}
      </div>
    </>
  );
}

function NotInGemmaCta({
  uri,
  onFetchOls,
}: {
  uri: string;
  onFetchOls: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="italic text-slate-500 dark:text-slate-400">
        Gemma doesn&rsquo;t know this term.
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onFetchOls();
        }}
        className="text-[11px] px-2 py-0.5 rounded border border-blue-400 bg-blue-50 text-blue-900 hover:bg-blue-100 dark:border-blue-600 dark:bg-blue-900/30 dark:text-blue-100 dark:hover:bg-blue-900/50"
      >
        Fetch from OLS
      </button>
      <div className="text-[10px] text-slate-400">
        <a
          href={curieToUrl(uri) ?? uri}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="hover:underline"
        >
          or open in OBO ↗
        </a>
      </div>
    </div>
  );
}

function NotFound({ uri }: { uri: string }) {
  return (
    <div className="space-y-1">
      <div className="italic text-slate-500 dark:text-slate-400">
        Term not found.
      </div>
      <a
        href={curieToUrl(uri) ?? uri}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-[10px] text-blue-700 hover:underline dark:text-blue-300"
      >
        open in OBO ↗
      </a>
    </div>
  );
}
