import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Biomaterial } from "@/features/experiment/types";
import { sampleExternalUrl } from "@/lib/gemmaUrls";
import { Term } from "@/components/ui/Term";

/**
 * Tiny "i" chip beside a sample's short_name in the samples table.
 * Clicking opens a popover that dumps every per-BM field — all
 * characteristics (incl. ones the curator has hidden via colFilter
 * / hide-constant), bio_assays, source-biomaterial bookkeeping for
 * single-cell rows, and any ontology URIs Gemma's preprocessor
 * mapped onto characteristic values.
 *
 * Lets a curator inspect the full metadata for one sample without
 * touching column visibility — most useful when a row is flagged
 * (audit dot, proposal hit) and they want context on a constant or
 * collapsed column without exposing it across every row.
 *
 * For grouped (single-cell) rows: the popover shows the
 * representative's fields and notes the constituent count up top.
 * Walking every constituent's characteristics gets noisy fast and
 * the bucket-level diffs already show in the cell-level "mixed"
 * styling — surface them there, not here.
 *
 * Renders via `createPortal` into `document.body` with
 * `position: fixed` anchored to the chip button. The samples table
 * lives inside an overflow-auto scroll container; an
 * absolute-positioned popover inside that ancestor gets clipped
 * (the original first pass had this — flagged in the v0.3.0 doc).
 * Portal escapes the boundary; fixed coordinates from the
 * anchor's bounding rect keep the popover visually attached. Same
 * pattern as `src/features/audit/DismissDialog.tsx`. Closes on Esc
 * / click-outside / resize. Close-on-scroll deliberately skipped —
 * a chip click moves keyboard focus, the browser auto-scrolls the
 * focused element into view, and the resulting scroll event
 * snapped the dialog shut on the dismiss-dialog version of this
 * pattern. Curator dismisses with Esc or click-outside instead.
 */
const POPOVER_W = 384; // matches the old w-96
const POPOVER_MAX_H = 480; // header + body's max-h-96 + padding
const ANCHOR_OFFSET = 4; // matches the old mt-1 spacing

export function BiomaterialMetaPopover({
  bm,
  source,
  groupSize,
}: {
  /** The representative biomaterial — for grouped single-cell rows
   *  this is the source BM; for plain rows it's the row's BM. */
  bm: Biomaterial;
  /** Used to build per-assay external URLs (GEO / ArrayExpress /
   *  CELLxGENE etc.). Null when the dataset wasn't imported from
   *  an external database. */
  source: { database?: string } | null | undefined;
  /** Constituent BM count for grouped rows; 1 for plain rows.
   *  Surfaced in the header so curators inspecting a collapsed
   *  single-cell row know they're seeing one of N buckets. */
  groupSize: number;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Position relative to the chip's viewport coords. Drops below by
  // default; flips above when there isn't enough room below (rare
  // for top rows, common for the last few rows of a long table).
  // Slides left when the right edge would overflow the viewport so
  // the popover never paints off-screen.
  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      setPos(null);
      return;
    }
    const rect = anchorRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = rect.bottom + ANCHOR_OFFSET;
    let left = rect.left;
    if (left + POPOVER_W + 8 > vw) {
      left = Math.max(8, vw - POPOVER_W - 8);
    }
    if (top + POPOVER_MAX_H + 8 > vh) {
      const above = rect.top - ANCHOR_OFFSET - POPOVER_MAX_H;
      top = above >= 8 ? above : Math.max(8, vh - POPOVER_MAX_H - 8);
    }
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onResize() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const charEntries = Object.entries(bm.characteristics ?? {}).filter(
    ([, v]) => v != null && v !== "",
  );
  // Raw GEO MINiML fields (treatment/growth/extract protocol, source_name,
  // title, …). Verbatim submitter text, NOT curated — surfaced so a curator
  // can read whole-experiment context (disease induction, treatment) that
  // Gemma doesn't promote to a characteristic. `description` is already shown
  // up top, so drop it here to avoid duplication.
  const geoEntries = Object.entries(bm.geo_fields ?? {}).filter(
    ([k, v]) => k !== "description" && v != null && String(v).trim() !== "",
  );
  const assays = bm.bio_assays ?? [];

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-slate-300 bg-white text-slate-500 hover:bg-slate-50 hover:text-blue-700 text-[9px] leading-none font-bold ml-1.5 align-middle"
        title="show all metadata for this sample"
        aria-label="show sample metadata"
      >
        i
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={popoverRef}
              className="fixed z-50 bg-white border border-slate-200 rounded shadow-xl text-xs text-slate-700"
              style={{
                top: pos.top,
                left: pos.left,
                width: POPOVER_W,
                maxHeight: POPOVER_MAX_H,
              }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="px-3 py-2 border-b border-slate-100 flex items-baseline justify-between gap-2">
                <span className="font-semibold text-slate-800 font-mono text-xs truncate">
                  {bm.short_name}
                </span>
                <button
                  type="button"
                  className="text-slate-400 hover:text-slate-700"
                  onClick={() => setOpen(false)}
                  title="close"
                >
                  ×
                </button>
              </div>
              <div
                className="px-3 py-2 space-y-2 overflow-auto"
                // Body scrolls internally; the wrapper's max-height
                // budgets ~50px for the header so the body cap below
                // matches.
                style={{ maxHeight: POPOVER_MAX_H - 50 }}
              >
                {bm.name && bm.name !== bm.short_name ? (
                  <Section label="Name">
                    <div className="text-slate-800">{bm.name}</div>
                  </Section>
                ) : null}

                {groupSize > 1 ? (
                  <Section label="Single-cell row">
                    <div className="text-slate-600">
                      {groupSize} cell-type bucket
                      {groupSize === 1 ? "" : "s"} share this source sample.
                      Showing the representative; per-bucket differences
                      surface as mixed cells in the table.
                    </div>
                  </Section>
                ) : null}

                {bm.source_biomaterial_id != null ? (
                  <Section label="Source biomaterial id">
                    <code className="text-[11px] text-slate-700">
                      {bm.source_biomaterial_id}
                    </code>
                  </Section>
                ) : null}

                {assays.length > 0 ? (
                  <Section label={`Bio assays (${assays.length})`}>
                    <ul className="space-y-1">
                      {assays.map((a, i) => {
                        const url = sampleExternalUrl(
                          source?.database,
                          a.short_name,
                        );
                        const dupName = (a.name ?? "") === (bm.name ?? "");
                        return (
                          <li
                            key={`${a.short_name}-${i}`}
                            className="leading-tight"
                          >
                            {url ? (
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-[11px] text-blue-700 hover:underline"
                              >
                                {a.short_name}
                              </a>
                            ) : (
                              <span className="font-mono text-[11px] text-slate-700">
                                {a.short_name}
                              </span>
                            )}
                            {!dupName && a.name ? (
                              <span className="text-slate-700 ml-1.5">
                                {a.name}
                              </span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </Section>
                ) : null}

                <Section label={`Characteristics (${charEntries.length})`}>
                  {charEntries.length === 0 ? (
                    <div className="italic text-slate-400">
                      none recorded
                    </div>
                  ) : (
                    <table className="w-full text-[11px]">
                      <tbody>
                        {charEntries.map(([k, v]) => {
                          const uri =
                            bm.characteristic_uris?.[k]?.value_uri ?? null;
                          return (
                            <tr
                              key={k}
                              className="align-top border-b border-slate-100 last:border-b-0"
                            >
                              <td className="py-0.5 pr-2 text-slate-500 whitespace-nowrap">
                                {k}
                              </td>
                              <td className="py-0.5 text-slate-800 break-words">
                                {uri ? (
                                  <Term uri={uri}>{v}</Term>
                                ) : (
                                  v
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </Section>

                {geoEntries.length > 0 ? (
                  <Section label={`From GEO — raw (${geoEntries.length})`}>
                    <div className="mb-1 text-[10px] italic text-slate-400">
                      Verbatim GEO submitter metadata — not curated. On a split
                      experiment, series-level text may describe the original
                      series (samples not shown here).
                    </div>
                    <table className="w-full text-[11px]">
                      <tbody>
                        {geoEntries.map(([k, v]) => (
                          <tr
                            key={k}
                            className="align-top border-b border-slate-100 last:border-b-0"
                          >
                            <td className="py-0.5 pr-2 text-slate-500 whitespace-nowrap">
                              {k}
                            </td>
                            <td className="py-0.5 text-slate-800 break-words whitespace-pre-wrap">
                              {v}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Section>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-0.5">
        {label}
      </div>
      {children}
    </div>
  );
}
