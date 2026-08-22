// Two-level platform selector.
//
// Top tier: technology-type groups (RNA_SEQ / MICROARRAY / OTHER).
//
// Under RNA-Seq, we show subgroup rows (TECH_SUBGROUPS) that bundle
// one or more OBI assay-annotation URIs into a single checkbox —
// "Single-cell / single-nucleus" (sc + sn) and "Bulk" (bulk RNA-seq).
// Individual SEQUENCING platforms are intentionally hidden — Gemma
// users pick RNA-Seq via the assay annotation, not a specific array.
//
// Microarray and Other have no subgroups and fall back to listing the
// individual platforms under each.

import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { AnnotationTerm, Platform, CategoryWithChildren } from "@/lib/types";
import { TECH_SUBGROUPS, TOP_TECHNOLOGY_TYPES } from "@/lib/platformConstants";
import { formatNumber } from "@/lib/utils";

const ASSAY_CATEGORY_URI = "http://purl.obolibrary.org/obo/OBI_0000070";

/** Unselected platform rows drawn under an expanded group. Selected
 *  ones are drawn regardless — see `visiblePlatforms`. */
const PLATFORM_ROW_CAP = 40;

interface Props {
  platforms: Platform[];
  annotations: CategoryWithChildren[];
  selectedPlatforms: Platform[];
  selectedTechnologyTypes: string[];
  selectedTechAnnotations: AnnotationTerm[];
  loading?: boolean;
  disabled?: boolean;
  onChangePlatforms: (p: Platform[]) => void;
  onChangeTechnologyTypes: (t: string[]) => void;
  onChangeTechAnnotations: (a: AnnotationTerm[]) => void;
}

export function TechnologyTypeSelector({
  platforms,
  annotations,
  selectedPlatforms,
  selectedTechnologyTypes,
  selectedTechAnnotations,
  loading,
  disabled,
  onChangePlatforms,
  onChangeTechnologyTypes,
  onChangeTechAnnotations,
}: Props) {
  // RNA-Seq starts expanded so users see the sc/nuc + Bulk split
  // without having to click. Microarray stays collapsed since its
  // child list is long.
  const [open, setOpen] = useState<Record<string, boolean>>({ RNA_SEQ: true });

  const selectedPlatformIds = new Set(selectedPlatforms.map((p) => p.id));

  // Open whichever group holds a selected platform. Without this a
  // visitor arriving on a platform filter — from the platform page's
  // "open in browser", or a shared link — sees a collapsed Microarray
  // row, nothing ticked anywhere, and a result count that looks
  // unexplained. The selection was applied; it just had nowhere to
  // show.
  const selectedGroupKey = [...selectedPlatformIds].sort().join(",");
  useEffect(() => {
    if (selectedPlatforms.length === 0) return;
    const holders = TOP_TECHNOLOGY_TYPES.filter(([, , tts]) =>
      selectedPlatforms.some((p) => p.technologyType && tts.includes(p.technologyType)),
    ).map(([id]) => id);
    if (holders.length === 0) return;
    setOpen((prev) => {
      if (holders.every((h) => prev[h])) return prev;
      const next = { ...prev };
      for (const h of holders) next[h] = true;
      return next;
    });
    // Keyed on the id set rather than the array identity, which is new
    // on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroupKey]);
  const selectedTechSet = new Set(selectedTechnologyTypes);
  const selectedAnnotUris = new Set(
    selectedTechAnnotations.map((a) => a.termUri).filter(Boolean) as string[],
  );

  // Pre-index assay terms by URI for fast subgroup lookup.
  const assayCategory = annotations.find((c) => c.classUri === ASSAY_CATEGORY_URI);
  const assayTermByUri = new Map<string, AnnotationTerm>();
  if (assayCategory) {
    for (const t of assayCategory.children) {
      if (t.termUri) assayTermByUri.set(t.termUri, t);
    }
  }

  // Build the top-level groups. "Other" is hidden — its members
  // (Generic_*_ncbilds) are RNA-seq-equivalent placeholders, so
  // showing them is redundant.
  //
  // Count: `numberOfExpressionExperimentsForTechnologyType` is a
  // per-technologyType value duplicated across every platform of that
  // type — sum once per unique technologyType, not once per platform,
  // or you'll inflate by the platform count.
  const groups = TOP_TECHNOLOGY_TYPES
    .filter(([id]) => id !== "OTHER")
    .map(([id, name, tts]) => {
      const groupPlatforms = platforms.filter((p) => p.technologyType && tts.includes(p.technologyType));
      let count = 0;
      for (const tt of tts) {
        const first = groupPlatforms.find((p) => p.technologyType === tt);
        if (first) count += first.numberOfExpressionExperimentsForTechnologyType ?? 0;
      }
      const subgroups = TECH_SUBGROUPS[id] ?? null;
      return { id, name, tts, platforms: groupPlatforms, count, subgroups };
    })
    .filter((g) => g.platforms.length > 0 || (g.subgroups?.length ?? 0) > 0);

  function toggleGroup(g: typeof groups[number]) {
    if (disabled) return;
    const allSubgroupUris = (g.subgroups ?? []).flatMap((sg) => sg.termUris);
    const state = groupState(g);
    if (state === "on") {
      onChangeTechnologyTypes(selectedTechnologyTypes.filter((t) => !g.tts.includes(t)));
      if (allSubgroupUris.length > 0) {
        onChangeTechAnnotations(
          selectedTechAnnotations.filter((a) => !a.termUri || !allSubgroupUris.includes(a.termUri)),
        );
      }
    } else {
      const nextSet = new Set(selectedTechnologyTypes);
      g.tts.forEach((t) => nextSet.add(t));
      onChangeTechnologyTypes([...nextSet]);
      if (allSubgroupUris.length > 0) {
        const additions: AnnotationTerm[] = [];
        for (const uri of allSubgroupUris) {
          if (selectedAnnotUris.has(uri)) continue;
          const t = assayTermByUri.get(uri);
          if (t) additions.push(t);
          else
            additions.push({
              classUri: ASSAY_CATEGORY_URI,
              className: "assay",
              termUri: uri,
              termName: uri,
            });
        }
        if (additions.length > 0) onChangeTechAnnotations([...selectedTechAnnotations, ...additions]);
      }
    }
  }

  function groupState(g: typeof groups[number]): "on" | "off" | "partial" {
    const ttOn = g.tts.every((t) => selectedTechSet.has(t));
    const ttOff = g.tts.every((t) => !selectedTechSet.has(t));
    const allSgUris = (g.subgroups ?? []).flatMap((sg) => sg.termUris);
    if (allSgUris.length === 0) {
      if (ttOn) return "on";
      if (ttOff) return "off";
      return "partial";
    }
    const sgOn = allSgUris.every((u) => selectedAnnotUris.has(u));
    const sgOff = allSgUris.every((u) => !selectedAnnotUris.has(u));
    if (ttOn && sgOn) return "on";
    if (ttOff && sgOff) return "off";
    return "partial";
  }

  /** The child rows to draw for a group: everything selected, then the
   *  rest up to the cap. A selected platform is always present. */
  function visiblePlatforms(groupPlatforms: Platform[]): Platform[] {
    const picked = groupPlatforms.filter((p) => selectedPlatformIds.has(p.id));
    const rest = groupPlatforms.filter((p) => !selectedPlatformIds.has(p.id));
    return [...picked, ...rest.slice(0, PLATFORM_ROW_CAP)];
  }

  /** How many individually-picked platforms sit under a group. Shown on
   *  the collapsed row so a selection is never invisible. */
  function selectedInGroup(g: { tts: readonly string[] }): number {
    return selectedPlatforms.filter(
      (p) => p.technologyType && g.tts.includes(p.technologyType),
    ).length;
  }

  function togglePlatform(p: Platform) {
    if (disabled) return;
    const next = selectedPlatformIds.has(p.id)
      ? selectedPlatforms.filter((x) => x.id !== p.id)
      : [...selectedPlatforms, p];
    onChangePlatforms(next);
  }

  function subgroupState(termUris: string[]): "on" | "off" | "partial" {
    const matched = termUris.filter((u) => selectedAnnotUris.has(u));
    if (matched.length === 0) return "off";
    if (matched.length === termUris.length) return "on";
    return "partial";
  }

  function subgroupCount(termUris: string[]): number {
    let n = 0;
    for (const uri of termUris) {
      const t = assayTermByUri.get(uri);
      if (t) n += t.numberOfExpressionExperiments ?? 0;
    }
    return n;
  }

  function toggleSubgroup(termUris: string[]) {
    if (disabled) return;
    const state = subgroupState(termUris);
    if (state === "on") {
      // Remove all of this subgroup's terms
      onChangeTechAnnotations(
        selectedTechAnnotations.filter((a) => !a.termUri || !termUris.includes(a.termUri)),
      );
    } else {
      // Add any missing terms (resolving from the live annotation list
      // so labels and counts come along).
      const additions: AnnotationTerm[] = [];
      for (const uri of termUris) {
        if (selectedAnnotUris.has(uri)) continue;
        const t = assayTermByUri.get(uri);
        if (t) additions.push(t);
        else
          additions.push({
            classUri: ASSAY_CATEGORY_URI,
            className: "assay",
            termUri: uri,
            termName: uri,
          });
      }
      onChangeTechAnnotations([...selectedTechAnnotations, ...additions]);
    }
  }

  return (
    <section className="mb-4">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="side-heading">Platforms</h3>
        {selectedPlatforms.length + selectedTechnologyTypes.length + selectedTechAnnotations.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              onChangePlatforms([]);
              onChangeTechnologyTypes([]);
              onChangeTechAnnotations([]);
            }}
            disabled={disabled}
            className="text-xs text-gemma-accent hover:underline"
          >
            Clear
          </button>
        ) : null}
      </div>

      {loading ? <div className="h-0.5 bg-gemma-accent/30 animate-pulse" /> : null}

      <ul className="text-sm">
        {groups.length === 0 && !loading ? (
          <li className="text-gemma-subtle italic py-1">No platforms available</li>
        ) : null}
        {groups.map((g) => {
          const state = groupState(g);
          const isOpen = !!open[g.id];
          const hasSubgroups = (g.subgroups?.length ?? 0) > 0;
          return (
            <li key={g.id} className="py-0.5">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={state === "on"}
                  ref={(el) => {
                    if (el) el.indeterminate = state === "partial";
                  }}
                  disabled={disabled}
                  onChange={() => toggleGroup(g)}
                  className="h-3.5 w-3.5 accent-gemma-accent"
                />
                {/* Chevron, matching the Annotations rows. The label
                    was already a toggle, but with nothing to say so —
                    Microarray looked like a leaf and its platform list
                    was unreachable unless you happened to click the
                    word. */}
                <button
                  type="button"
                  onClick={() => setOpen({ ...open, [g.id]: !isOpen })}
                  className="flex-1 text-left truncate hover:text-gemma-accent flex items-center gap-1"
                  title={
                    hasSubgroups
                      ? `${g.name} — expand for assay types`
                      : `${g.name} — expand for individual platforms`
                  }
                >
                  <ChevronRight
                    className={`h-3 w-3 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                  />
                  <span className="truncate">{g.name}</span>
                  {selectedInGroup(g) > 0 ? (
                    <span
                      className="text-[10px] text-gemma-accent font-medium tabular-nums"
                      title={`${selectedInGroup(g)} selected`}
                    >
                      ·{selectedInGroup(g)}
                    </span>
                  ) : null}
                </button>
                <span className="text-gemma-subtle text-xs tabular-nums">{formatNumber(g.count)}</span>
              </div>
              {isOpen ? (
                <ul className="pl-6 border-l border-gemma-grid ml-1.5">
                  {hasSubgroups
                    ? g.subgroups!.map((sg) => {
                        const state = subgroupState(sg.termUris);
                        return (
                          <li key={sg.id} className="flex items-center gap-2 py-0.5">
                            <input
                              type="checkbox"
                              checked={state === "on"}
                              ref={(el) => {
                                if (el) el.indeterminate = state === "partial";
                              }}
                              disabled={disabled}
                              onChange={() => toggleSubgroup(sg.termUris)}
                              className="h-3.5 w-3.5 accent-gemma-accent"
                            />
                            <span className="flex-1 truncate text-xs" title={sg.label}>
                              {sg.label}
                            </span>
                            <span className="text-gemma-subtle text-xs tabular-nums">
                              ≥{formatNumber(subgroupCount(sg.termUris))}
                            </span>
                          </li>
                        );
                      })
                    : (
                      <>
                        {/* Selected platforms first, and never cut by
                            the cap below: arriving on a filter for a
                            platform that sorts 200th would otherwise
                            show an unticked list under a group that
                            says nothing is selected. */}
                        {visiblePlatforms(g.platforms).map((p) => (
                          <li key={p.id} className="flex items-center gap-2 py-0.5">
                            <input
                              type="checkbox"
                              checked={selectedPlatformIds.has(p.id)}
                              disabled={disabled}
                              onChange={() => togglePlatform(p)}
                              className="h-3.5 w-3.5 accent-gemma-accent"
                            />
                            <span className="flex-1 truncate text-xs" title={p.name ?? ""}>
                              {p.shortName || p.name || `#${p.id}`}
                            </span>
                            <span className="text-gemma-subtle text-xs tabular-nums">
                              {formatNumber(p.numberOfExpressionExperiments ?? 0)}
                            </span>
                          </li>
                        ))}
                        {g.platforms.length > visiblePlatforms(g.platforms).length ? (
                          <li className="text-xs text-gemma-subtle py-0.5">
                            + {g.platforms.length - visiblePlatforms(g.platforms).length} more
                          </li>
                        ) : null}
                      </>
                    )}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
