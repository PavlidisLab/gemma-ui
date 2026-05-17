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

import { useState } from "react";
import type { AnnotationTerm, Platform, CategoryWithChildren } from "@/lib/types";
import { TECH_SUBGROUPS, TOP_TECHNOLOGY_TYPES } from "@/lib/platformConstants";
import { formatNumber } from "@/lib/utils";

const ASSAY_CATEGORY_URI = "http://purl.obolibrary.org/obo/OBI_0000070";

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
    const isOn = g.tts.every((t) => selectedTechSet.has(t));
    if (isOn) {
      onChangeTechnologyTypes(selectedTechnologyTypes.filter((t) => !g.tts.includes(t)));
    } else {
      const nextSet = new Set(selectedTechnologyTypes);
      g.tts.forEach((t) => nextSet.add(t));
      onChangeTechnologyTypes([...nextSet]);
    }
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
          const isOn = g.tts.every((t) => selectedTechSet.has(t));
          const isOpen = !!open[g.id];
          const hasSubgroups = (g.subgroups?.length ?? 0) > 0;
          return (
            <li key={g.id} className="py-0.5">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isOn}
                  disabled={disabled}
                  onChange={() => toggleGroup(g)}
                  className="h-3.5 w-3.5 accent-gemma-accent"
                />
                <button
                  type="button"
                  onClick={() => setOpen({ ...open, [g.id]: !isOpen })}
                  className="flex-1 text-left truncate hover:text-gemma-accent"
                >
                  {g.name}
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
                        {g.platforms.slice(0, 40).map((p) => (
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
                        {g.platforms.length > 40 ? (
                          <li className="text-xs text-gemma-subtle py-0.5">
                            + {g.platforms.length - 40} more
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
