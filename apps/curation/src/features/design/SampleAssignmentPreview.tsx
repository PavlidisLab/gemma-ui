import { useMemo, useState } from "react";
import type { Biomaterial, Factor } from "@/features/experiment/types";
import { cn } from "@/lib/cn";
import { pickDistinguishingKey } from "@/features/samples/BulkAssignPanel";
import { experimentRoute, navigate } from "@/routes";

/**
 * Split-view of the selected factor's biomaterial → FV assignment,
 * with drag-and-drop reassignment.
 *
 * Layout per sample tile:
 *
 *   [primary]  → BioAssay name (descriptive title); falls back to
 *                Biomaterial.name → distinguishing characteristic →
 *                short_name when no BioAssay is attached.
 *   [secondary] → BioAssay short_name (typically a GSM accession);
 *                falls back to biomaterial short_name when no
 *                BioAssay is present.
 *   [hover]    → biomaterial short_name + name, every BioAssay, and
 *                key characteristics. The full record so a curator
 *                can verify the assignment without leaving the view.
 *
 * Drag a sample tile to a different FV column to reassign. The drop
 * fires `onReassign(short_name, toFvId)`; the parent flows it
 * through the `reassignSample` mutation, which removes the sample
 * from any other FV in the same factor (Gemma allows a biomaterial
 * to belong to one FV per factor).
 */
export function SampleAssignmentPreview({
  factor,
  biomaterials,
  experimentId,
  onReassignBulk,
}: {
  factor: Factor;
  biomaterials: Biomaterial[];
  /** Used to build the "open Samples tab" route for the bulk-assign
   *  shortcut. The bulk affordance lives on the Samples tab; we
   *  just deep-link there. */
  experimentId: number;
  /** Move many biomaterials to one target FV in a single design
   *  pass. Drag/drop on a single tile in a single-cell experiment
   *  fans out to all sibling cell-type buckets — without this bulk
   *  shape, that's N sequential ``apply()`` reductions over the
   *  entire design. Also used by the Samples tab's ``Bulk assign``
   *  modal — same shape, different entry point. */
  onReassignBulk: (
    biomaterialShortNames: string[],
    toFvId: number,
  ) => void;
}) {
  const bmIndex = useMemo(
    () => new Map(biomaterials.map((b) => [b.short_name, b])),
    [biomaterials],
  );
  const distinguishingKey = useMemo(
    () => pickDistinguishingKey(biomaterials),
    [biomaterials],
  );
  // For each BM, the set of "siblings" — BMs that share its
  // ``source_biomaterial_id``. Single-cell experiments group N
  // cell-type buckets under one source sample; without grouping
  // this preview shows N tiles per source sample, which floods the
  // column. We render one tile per source sample and badge it
  // with the bucket count. Bulk experiments leave
  // ``source_biomaterial_id`` unset → groups of 1 → no change.
  const siblingMap = useMemo(() => {
    const out = new Map<string, string[]>();  // shortName → [siblings incl. self]
    const bySource = new Map<number, string[]>();
    for (const b of biomaterials) {
      const sid = b.source_biomaterial_id ?? null;
      if (sid == null) {
        out.set(b.short_name, [b.short_name]);
        continue;
      }
      if (!bySource.has(sid)) bySource.set(sid, []);
      bySource.get(sid)!.push(b.short_name);
    }
    for (const sns of bySource.values()) {
      for (const sn of sns) out.set(sn, sns);
    }
    return out;
  }, [biomaterials]);
  const isCollapsedView = useMemo(
    () => [...siblingMap.values()].some((sns) => sns.length > 1),
    [siblingMap],
  );

  // Which sample is currently being dragged, and which column we're
  // hovering. Used purely for visual feedback; the actual
  // reassignment happens on drop.
  const [dragging, setDragging] = useState<{
    shortName: string;
    fromFvId: number;
  } | null>(null);
  const [hoverFvId, setHoverFvId] = useState<number | null>(null);

  // Filter input — large cohorts (100+ samples) need a way to find a
  // specific sample without scanning every column.
  const [filter, setFilter] = useState("");
  const matches = useMemo(
    () => buildMatchSet(biomaterials, filter),
    [biomaterials, filter],
  );

  const totalSamples = factor.factor_values.reduce(
    (n, fv) => n + fv.biomaterial_short_names.length,
    0,
  );

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-200 flex-wrap">
        <span className="section-h">
          Sample assignment preview · {factor.name}
          <span className="ml-2 text-xs text-slate-400 font-normal">
            {totalSamples} sample{totalSamples === 1 ? "" : "s"}
            {filter && matches
              ? ` · ${matches.size} match${matches.size === 1 ? "" : "es"}`
              : ""}
          </span>
        </span>
        <div className="flex items-center gap-3">
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="filter samples…"
            className="text-xs border border-slate-300 rounded px-2 py-1 w-56"
          />
          <button
            type="button"
            onClick={() => navigate(experimentRoute(experimentId, "samples"))}
            className="text-[11px] text-blue-700 hover:underline"
            title="Map a sample-table characteristic onto this factor's FVs in one go. Lives on the Samples tab — click 'bulk assign…' in the toolbar."
          >
            bulk assign on Samples tab ↗
          </button>
        </div>
      </div>
      <div
        className="grid gap-px bg-slate-200"
        style={{
          gridTemplateColumns: `repeat(${factor.factor_values.length}, minmax(0, 1fr))`,
        }}
      >
        {factor.factor_values.map((fv) => {
          const isHover = hoverFvId === fv.id;
          const isSource = dragging?.fromFvId === fv.id;
          return (
            <div
              key={fv.id}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                if (hoverFvId !== fv.id) setHoverFvId(fv.id);
              }}
              onDragLeave={() => {
                if (hoverFvId === fv.id) setHoverFvId(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (!dragging) return;
                if (dragging.fromFvId !== fv.id) {
                  // Fan out to all siblings — the visible tile is
                  // the source-sample representative; the curator
                  // expects every cell-type bucket of that sample
                  // to follow it. Bulk variant runs ONE reduction
                  // over the design regardless of sibling count.
                  const siblings =
                    siblingMap.get(dragging.shortName) ?? [dragging.shortName];
                  onReassignBulk(siblings, fv.id);
                }
                setDragging(null);
                setHoverFvId(null);
              }}
              className={cn(
                "p-3 min-w-0 transition-colors",
                isHover && dragging && !isSource
                  ? "bg-blue-50 outline outline-2 outline-blue-300 -outline-offset-2"
                  : "bg-white",
                isSource && "opacity-70",
              )}
            >
              {/*
                Collapse the FV's BM list into one tile per source
                sample (single-cell). Bulk experiments → one tile
                per BM as before. Group count and BM count both
                show in the header so curators don't have to do
                the math.
              */}
              {(() => {
                const groups = collapseAssignmentList(
                  fv.biomaterial_short_names,
                  siblingMap,
                );
                return (
                  <>
                    <div
                      className={
                        "text-xs font-semibold mb-2 " +
                        (fv.is_baseline ? "text-emerald-800" : "text-slate-800")
                      }
                    >
                      {fv.free_text_label || (
                        <span className="italic text-slate-400">(no label)</span>
                      )}{" "}
                      <span className="text-slate-400 font-normal">
                        ({groups.length}
                        {isCollapsedView &&
                        groups.length !== fv.biomaterial_short_names.length
                          ? ` source / ${fv.biomaterial_short_names.length} bucket${fv.biomaterial_short_names.length === 1 ? "" : "s"}`
                          : ""}
                        )
                      </span>
                    </div>
                    <ul className="text-xs space-y-1 max-h-[28rem] overflow-y-auto pr-1">
                      {groups.map((g) => {
                        const repName = g[0];
                        const bm = bmIndex.get(repName);
                        const primary = primaryLabel(
                          repName,
                          bm,
                          distinguishingKey,
                        );
                        const secondary = secondaryLabel(repName, bm);
                        const extraAssays = (bm?.bio_assays?.length ?? 0) - 1;
                        const isGroup = g.length > 1;
                        // Dragging the rep tile when grouped means
                        // dragging the whole source sample — drop
                        // fans out to all siblings.
                        const isThisDragged =
                          dragging != null && g.includes(dragging.shortName);
                        // Filter dims a tile when *no* sibling matches.
                        const dim =
                          matches !== null && !g.some((sn) => matches.has(sn));
                        return (
                          <li
                            key={`${fv.id}-${repName}`}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData("text/plain", repName);
                              e.dataTransfer.effectAllowed = "move";
                              setDragging({ shortName: repName, fromFvId: fv.id });
                            }}
                            onDragEnd={() => {
                              setDragging(null);
                              setHoverFvId(null);
                            }}
                            className={cn(
                              "min-w-0 cursor-grab active:cursor-grabbing rounded px-1 -mx-1 hover:bg-slate-100",
                              isThisDragged && "opacity-40",
                              dim && !isThisDragged && "opacity-25",
                            )}
                            title={hoverDetails(repName, bm, g)}
                          >
                            <div className="text-slate-800 truncate">
                              {primary}
                              {isGroup ? (
                                <span
                                  className="ml-1 text-[10px] font-semibold uppercase tracking-wide px-1 py-0 rounded bg-violet-100 text-violet-900 border border-violet-200"
                                  title={`single-cell: ${g.length} cell-type buckets share this source sample — drag to reassign all of them together`}
                                >
                                  +{g.length - 1}
                                </span>
                              ) : null}
                              {extraAssays > 0 ? (
                                <span
                                  className="ml-1 text-[10px] text-slate-500"
                                  title={`${extraAssays + 1} bio_assays attached`}
                                >
                                  +{extraAssays}
                                </span>
                              ) : null}
                            </div>
                            {secondary ? (
                              <div className="font-mono text-[10px] text-slate-400 truncate">
                                {secondary}
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                      {groups.length === 0 ? (
                        <li className="text-[11px] text-slate-400 italic">
                          drop samples here
                        </li>
                      ) : null}
                    </ul>
                  </>
                );
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* BulkAssignPanel + its helpers (bucketByCharacteristic, suggestPlan,
 * suggestFvForValue, collectVaryingCharacteristicKeys,
 * pickDistinguishingKey) all moved to
 * ``@/features/samples/BulkAssignPanel`` per Paul, 2026-04-29 — the
 * panel lives on the Samples tab now (where the per-sample data the
 * curator needs to make assignment decisions actually lives). The
 * Design tab keeps drag-and-drop reassignment for visual interaction
 * with one factor at a time. ``pickDistinguishingKey`` is imported
 * back from the new module so the sample-tile primary-label fallback
 * keeps working.
 *
 * Deleted-on-extract block (BulkAssignPanel + helpers) was here.
 */
/** Top line of the sample tile — the descriptive label a curator
 *  scans for. Prefers BioAssay.name (curator-facing title), falling
 *  back through Biomaterial.name and a varying characteristic
 *  before resorting to the bookkeeping short_name. */
function primaryLabel(
  shortName: string,
  bm: Biomaterial | undefined,
  distinguishingKey: string | null,
): string {
  if (!bm) return shortName;
  const ba = bm.bio_assays?.[0];
  if (ba?.name?.trim()) return ba.name.trim();
  if (ba?.short_name?.trim()) return ba.short_name.trim();
  const name = (bm.name ?? "").trim();
  if (name && name !== shortName) {
    return name;
  }
  if (distinguishingKey) {
    const v = bm.characteristics?.[distinguishingKey];
    if (v) return `${distinguishingKey}: ${v}`;
  }
  return shortName;
}

/** Bottom line of the sample tile — a canonical identifier
 *  (typically a GSM accession) shown beneath the descriptive label.
 *  Suppressed when it would just repeat the primary line. */
function secondaryLabel(
  shortName: string,
  bm: Biomaterial | undefined,
): string | null {
  const ba = bm?.bio_assays?.[0];
  const baShort = ba?.short_name?.trim();
  if (baShort) {
    // BioAssay primary already used ba.name; show the GSM accession
    // here. Skip if the accession somehow equals the primary
    // (shouldn't, but defensive).
    return baShort === ba?.name ? null : baShort;
  }
  // No BioAssay attached → the primary line was the biomaterial
  // name (or characteristic), so show the biomaterial short_name
  // for canonicality. Skip if primary already used short_name.
  return shortName;
}

/** Multi-line tooltip with everything a curator would want to
 *  verify: biomaterial identity, every BioAssay, and key
 *  characteristics. When ``siblings`` is supplied (single-cell
 *  collapsed tile), names every sibling so the curator can see
 *  what's bundled. */
function hoverDetails(
  shortName: string,
  bm: Biomaterial | undefined,
  siblings?: string[],
): string {
  const lines: string[] = [];
  lines.push(`biomaterial: ${shortName}`);
  if (bm?.name && bm.name !== shortName) {
    lines.push(`name: ${bm.name}`);
  }
  if (siblings && siblings.length > 1) {
    lines.push("");
    lines.push(`source sample bundles ${siblings.length} cell-type buckets:`);
    for (const sn of siblings) lines.push(`  ${sn}`);
  }
  if (bm?.bio_assays?.length) {
    lines.push("");
    lines.push(
      bm.bio_assays.length === 1 ? "bio_assay:" : `bio_assays (${bm.bio_assays.length}):`,
    );
    for (const a of bm.bio_assays) {
      lines.push(`  ${a.short_name}${a.name ? `  ${a.name}` : ""}`);
    }
  }
  const chars = Object.entries(bm?.characteristics ?? {}).filter(
    ([, v]) => v && String(v).trim(),
  );
  if (chars.length) {
    lines.push("");
    lines.push("characteristics:");
    for (const [k, v] of chars) {
      lines.push(`  ${k}: ${v}`);
    }
  }
  lines.push("");
  lines.push(
    siblings && siblings.length > 1
      ? "(drag to reassign all bundled buckets together)"
      : "(drag to reassign)",
  );
  return lines.join("\n");
}

/**
 * Walk an FV's biomaterial_short_names list and emit one entry
 * per source sample. Each entry is the BM names that share a
 * source_biomaterial_id, with the first one acting as the visible
 * representative tile. Bulk experiments (no source ids) → each
 * BM is its own one-element group.
 *
 * Order preserves the input — keeps tile placement stable when a
 * curator reassigns one sibling and the FV's list shifts.
 */
function collapseAssignmentList(
  shortNames: string[],
  siblingMap: Map<string, string[]>,
): string[][] {
  const out: string[][] = [];
  const seen = new Set<string>();
  for (const sn of shortNames) {
    if (seen.has(sn)) continue;
    const siblings = siblingMap.get(sn) ?? [sn];
    // Restrict to siblings that are also assigned to this FV — a
    // sibling assigned to a different FV shouldn't appear in this
    // tile (it's drawn under its own FV column). Preserves order
    // by walking shortNames.
    const inThisFv = shortNames.filter((x) => siblings.includes(x));
    for (const x of inThisFv) seen.add(x);
    out.push(inThisFv);
  }
  return out;
}

/** Build the set of biomaterial short_names that match a filter
 *  query. Returns ``null`` when the filter is empty (caller treats
 *  null as "no filter active"). Matches against biomaterial fields
 *  *and* attached BioAssay names — curators search by GSM accession
 *  or descriptive title, not by the bookkeeping short_name. */
function buildMatchSet(
  biomaterials: Biomaterial[],
  filter: string,
): Set<string> | null {
  const q = filter.trim().toLowerCase();
  if (!q) return null;
  const out = new Set<string>();
  for (const b of biomaterials) {
    if (b.short_name.toLowerCase().includes(q)) {
      out.add(b.short_name);
      continue;
    }
    if ((b.name ?? "").toLowerCase().includes(q)) {
      out.add(b.short_name);
      continue;
    }
    if (
      Object.values(b.characteristics ?? {}).some((v) =>
        String(v).toLowerCase().includes(q),
      )
    ) {
      out.add(b.short_name);
      continue;
    }
    if (
      (b.bio_assays ?? []).some(
        (a) =>
          a.short_name.toLowerCase().includes(q) ||
          (a.name ?? "").toLowerCase().includes(q),
      )
    ) {
      out.add(b.short_name);
    }
  }
  return out;
}

