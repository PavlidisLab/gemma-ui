import { useEffect, useRef, useState } from "react";
import type { Biomaterial } from "@/features/experiment/types";
import { sampleExternalUrl } from "@/lib/gemmaUrls";

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
 */
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

  const charEntries = Object.entries(bm.characteristics ?? {}).filter(
    ([, v]) => v != null && v !== "",
  );
  const assays = bm.bio_assays ?? [];

  return (
    <span ref={ref} className="relative inline-block ml-1.5 align-middle">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-slate-300 bg-white text-slate-500 hover:bg-slate-50 hover:text-blue-700 text-[9px] leading-none font-bold"
        title="show all metadata for this sample"
        aria-label="show sample metadata"
      >
        i
      </button>
      {open ? (
        <div
          className="absolute z-40 left-0 top-full mt-1 w-96 bg-white border border-slate-200 rounded shadow-lg text-xs text-slate-700"
          onClick={(e) => e.stopPropagation()}
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
          <div className="px-3 py-2 space-y-2 max-h-96 overflow-auto">
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
                      <li key={`${a.short_name}-${i}`} className="leading-tight">
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
                            {v}
                            {uri ? (
                              <a
                                href={uri}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ml-1.5 text-emerald-700 hover:underline text-[10px]"
                                title={uri}
                              >
                                ↗ ontology
                              </a>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </Section>
          </div>
        </div>
      ) : null}
    </span>
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
