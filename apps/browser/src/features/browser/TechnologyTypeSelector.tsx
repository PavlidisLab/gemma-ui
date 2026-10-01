// Platform chooser.
//
// Top tier: technology-type groups (RNA_SEQ / MICROARRAY / OTHER).
//
// Under RNA-Seq: subgroup rows (TECH_SUBGROUPS) that bundle one or more
// OBI assay-annotation URIs into a single checkbox — "Single-cell /
// single-nucleus" (sc + sn) and "Bulk" (bulk RNA-seq) — then "Other",
// which opens onto the remaining library strategies
// (LIBRARY_STRATEGY_SUBGROUPS). Individual SEQUENCING platforms are
// intentionally hidden — Gemma users pick RNA-Seq via the assay
// annotation, not a specific array.
//
// Under Microarray: One-colour / Two-colour (library strategy), each
// opening onto the platforms its datasets were run on.
//
// Last, the library strategies regular visitors are not shown
// (CURATOR_ONLY_LIBRARY_STRATEGIES), for a curator.

import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { AnnotationTerm, Platform, CategoryWithChildren } from "@/lib/types";
import {
  CURATOR_ONLY_LIBRARY_STRATEGIES,
  flattenStrategyRows,
  isStrategyNest,
  LIBRARY_STRATEGY_SUBGROUPS,
  libraryStrategyLabel,
  platformNameForList,
  TECH_SUBGROUPS,
  TOP_TECHNOLOGY_TYPES,
  type StrategyEntry,
  type StrategyNest,
  type StrategyRow,
} from "@/lib/platformConstants";
import { formatNumber } from "@/lib/utils";
import { VisibilityChip } from "@/components/VisibilityChip";

const ASSAY_CATEGORY_URI = "http://purl.obolibrary.org/obo/OBI_0000070";

/** Unselected platform rows drawn under an expanded row. Selected ones
 *  are drawn regardless — see `visiblePlatforms`. */
const PLATFORM_ROW_CAP = 40;

interface Props {
  platforms: Platform[];
  /** Platforms per library strategy, for the rows that list their own
   *  (the Microarray channels). */
  platformsByStrategy: Record<string, Platform[]>;
  annotations: CategoryWithChildren[];
  selectedPlatforms: Platform[];
  selectedTechnologyTypes: string[];
  selectedTechAnnotations: AnnotationTerm[];
  selectedLibraryStrategies: string[];
  /** Datasets per library strategy; null while unknown. */
  libraryStrategyCounts: Map<string, number | null>;
  /** Offer the CURATOR_ONLY_LIBRARY_STRATEGIES rows. */
  showCuratorOnlyTypes: boolean;
  loading?: boolean;
  disabled?: boolean;
  onChangePlatforms: (p: Platform[]) => void;
  onChangeTechnologyTypes: (t: string[]) => void;
  onChangeTechAnnotations: (a: AnnotationTerm[]) => void;
  onChangeLibraryStrategies: (v: string[]) => void;
}

export function TechnologyTypeSelector({
  platforms,
  platformsByStrategy,
  annotations,
  selectedPlatforms,
  selectedTechnologyTypes,
  selectedTechAnnotations,
  selectedLibraryStrategies,
  libraryStrategyCounts,
  showCuratorOnlyTypes,
  loading,
  disabled,
  onChangePlatforms,
  onChangeTechnologyTypes,
  onChangeTechAnnotations,
  onChangeLibraryStrategies,
}: Props) {
  // RNA-Seq starts expanded so users see the sc/nuc + Bulk split
  // without having to click. Microarray stays collapsed since its
  // child list is long. Keys are group ids and, for the channel rows,
  // strategy values.
  const [open, setOpen] = useState<Record<string, boolean>>({ RNA_SEQ: true });

  const selectedPlatformIds = new Set(selectedPlatforms.map((p) => p.id));
  const selectedStrategySet = new Set(selectedLibraryStrategies);
  const strategyEntries = (groupId: string): readonly StrategyEntry[] =>
    LIBRARY_STRATEGY_SUBGROUPS[groupId] ?? [];
  /** The strategy values a group offers, whatever depth they render at. */
  const strategyValues = (groupId: string): string[] =>
    flattenStrategyRows(strategyEntries(groupId)).map((s) => s.value);

  // Open whatever holds a selection. Without this a visitor arriving on
  // a filter — the platform page's "open in browser", `/browser/twocolor`,
  // a shared link — sees collapsed rows, nothing ticked anywhere, and a
  // result count that looks unexplained. The selection was applied; it
  // just had nowhere to show.
  const openKey = [
    [...selectedPlatformIds].sort().join(","),
    [...selectedLibraryStrategies].sort().join(","),
    Object.entries(platformsByStrategy)
      .map(([v, list]) => `${v}:${list.filter((p) => selectedPlatformIds.has(p.id)).length}`)
      .join(","),
  ].join("|");
  useEffect(() => {
    const holders = new Set<string>();
    for (const [id, , tts] of TOP_TECHNOLOGY_TYPES) {
      if (selectedPlatforms.some((p) => p.technologyType && tts.includes(p.technologyType))) {
        holders.add(id);
      }
      if (strategyValues(id).some((v) => selectedStrategySet.has(v))) holders.add(id);
      // A picked strategy also opens the "Other" row it sits under.
      for (const e of strategyEntries(id)) {
        if (isStrategyNest(e) && e.rows.some((s) => selectedStrategySet.has(s.value))) {
          holders.add(id);
          holders.add(e.id);
        }
      }
    }
    // A picked platform also opens the channel row that lists it.
    for (const [value, list] of Object.entries(platformsByStrategy)) {
      if (list.some((p) => selectedPlatformIds.has(p.id))) holders.add(value);
    }
    if (holders.size === 0) return;
    setOpen((prev) => {
      if ([...holders].every((h) => prev[h])) return prev;
      const next = { ...prev };
      for (const h of holders) next[h] = true;
      return next;
    });
    // Keyed on what is selected and where it is listed, not on array
    // identities, which are new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey]);
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
    // A strategy row narrows its group, so the group's own checkbox
    // clears them either way: off means none of the group, on means all
    // of it.
    const members = strategyValues(g.id);
    if (members.some((m) => selectedStrategySet.has(m))) {
      onChangeLibraryStrategies(selectedLibraryStrategies.filter((v) => !members.includes(v)));
    }
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
    if (strategyValues(g.id).some((v) => selectedStrategySet.has(v))) return "partial";
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

  /** The child rows to draw for a list: everything selected, then the
   *  rest up to the cap. A selected platform is always present. */
  function visiblePlatforms(list: Platform[]): Platform[] {
    const picked = list.filter((p) => selectedPlatformIds.has(p.id));
    const rest = list.filter((p) => !selectedPlatformIds.has(p.id));
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

  function toggleStrategy(value: string) {
    if (disabled) return;
    onChangeLibraryStrategies(
      selectedStrategySet.has(value)
        ? selectedLibraryStrategies.filter((v) => v !== value)
        : [...selectedLibraryStrategies, value],
    );
  }

  /** A strategy row shows unless its count is known to be 0, or while
   *  it holds a selection. */
  const strategyShown = (value: string) =>
    selectedStrategySet.has(value) || libraryStrategyCounts.get(value) !== 0;
  const strategyCount = (value: string) => {
    const n = libraryStrategyCounts.get(value);
    return n == null ? "" : formatNumber(n);
  };

  /** A nest's checkbox: on when every row under it is picked. */
  function nestState(e: StrategyNest): "on" | "off" | "partial" {
    const picked = e.rows.filter((s) => selectedStrategySet.has(s.value)).length;
    if (picked === 0) return "off";
    return picked === e.rows.length ? "on" : "partial";
  }

  function toggleNest(e: StrategyNest) {
    if (disabled) return;
    const members = e.rows.map((s) => s.value);
    if (nestState(e) === "on") {
      onChangeLibraryStrategies(selectedLibraryStrategies.filter((v) => !members.includes(v)));
    } else {
      const next = new Set(selectedLibraryStrategies);
      members.forEach((v) => next.add(v));
      onChangeLibraryStrategies([...next]);
    }
  }

  /** A nest has no count of its own — each value costs its own
   *  `/datasets/count` and nothing counts the union. The sum of its rows
   *  is an upper bound, because a dataset carrying two of them is
   *  counted twice, so it is shown as one. */
  function nestCount(e: StrategyNest): string {
    const known = e.rows
      .map((s) => libraryStrategyCounts.get(s.value))
      .filter((n): n is number => n != null);
    if (known.length === 0) return "";
    return `≤${formatNumber(known.reduce((a, b) => a + b, 0))}`;
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

  const chevron = (isOpen: boolean) => (
    <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`} />
  );

  /** Selected platforms first, and never cut by the cap: arriving on a
   *  filter for a platform that sorts 200th would otherwise show an
   *  unticked list under a row that says nothing is selected. */
  const platformList = (list: Platform[]) => {
    const visible = visiblePlatforms(list);
    return (
      <>
        {visible.map((p) => (
          <li key={p.id} className="flex items-start gap-2 py-0.5">
            <input
              type="checkbox"
              checked={selectedPlatformIds.has(p.id)}
              disabled={disabled}
              onChange={() => togglePlatform(p)}
              className="h-3.5 w-3.5 mt-px accent-gemma-accent"
            />
            <span
              className="flex-1 min-w-0 text-xs break-words"
              title={[p.shortName, p.name].filter(Boolean).join(" — ")}
            >
              <span className="font-mono text-gemma-subtle">{p.shortName || `#${p.id}`}</span>
              {p.name && p.name !== p.shortName ? <> {platformNameForList(p.name)}</> : null}
            </span>
            <span className="text-gemma-subtle text-xs tabular-nums">
              {formatNumber(p.numberOfExpressionExperiments ?? 0)}
            </span>
          </li>
        ))}
        {list.length > visible.length ? (
          <li className="text-xs text-gemma-subtle py-0.5">
            + {list.length - visible.length} more
          </li>
        ) : null}
      </>
    );
  };

  const strategyCheckbox = (value: string) => (
    <input
      type="checkbox"
      checked={selectedStrategySet.has(value)}
      disabled={disabled}
      onChange={() => toggleStrategy(value)}
      className="h-3.5 w-3.5 accent-gemma-accent"
    />
  );

  /** One library-strategy row. Rows with platforms of their own (the
   *  Microarray channels) open onto them; the rest are plain. */
  const strategyRow = (s: StrategyRow, g: { tts: readonly string[] }) => {
    const list = platformsByStrategy[s.value];
    if (!list) {
      return (
        <li key={s.value} className="flex items-center gap-2 py-0.5">
          {strategyCheckbox(s.value)}
          <span className="flex-1 truncate text-xs" title={s.value}>
            {s.label}
          </span>
          <span className="text-gemma-subtle text-xs tabular-nums">
            {strategyCount(s.value)}
          </span>
        </li>
      );
    }
    const rowOpen = !!open[s.value];
    const groupList = list.filter(
      (p) => p.technologyType && g.tts.includes(p.technologyType),
    );
    return (
      <li key={s.value} className="py-0.5">
        <div className="flex items-center gap-2">
          {strategyCheckbox(s.value)}
          <button
            type="button"
            onClick={() => setOpen({ ...open, [s.value]: !rowOpen })}
            className="flex-1 text-left truncate hover:text-gemma-accent flex items-center gap-1 text-xs"
            title={`${s.label} — expand for individual platforms`}
          >
            {chevron(rowOpen)}
            <span className="truncate">{s.label}</span>
          </button>
          <span className="text-gemma-subtle text-xs tabular-nums">
            {strategyCount(s.value)}
          </span>
        </div>
        {rowOpen ? (
          <ul className="pl-6 border-l border-gemma-grid ml-1.5">
            {platformList(groupList)}
          </ul>
        ) : null}
      </li>
    );
  };

  const curatorOnlyRows = CURATOR_ONLY_LIBRARY_STRATEGIES.filter(
    (v) => (showCuratorOnlyTypes || selectedStrategySet.has(v)) && strategyShown(v),
  );
  const ownedStrategies = new Set([
    ...Object.values(LIBRARY_STRATEGY_SUBGROUPS).flatMap((entries) =>
      flattenStrategyRows(entries).map((s) => s.value),
    ),
    ...CURATOR_ONLY_LIBRARY_STRATEGIES,
  ]);
  const anySelected =
    selectedPlatforms.length +
      selectedTechnologyTypes.length +
      selectedTechAnnotations.length +
      selectedLibraryStrategies.filter((v) => ownedStrategies.has(v)).length >
    0;

  return (
    <section className="mb-4">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="side-heading">Platforms</h3>
        {anySelected ? (
          <button
            type="button"
            onClick={() => {
              onChangePlatforms([]);
              onChangeTechnologyTypes([]);
              onChangeTechAnnotations([]);
              onChangeLibraryStrategies(
                selectedLibraryStrategies.filter((v) => !ownedStrategies.has(v)),
              );
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
          const entries = strategyEntries(g.id);
          const shownEntries = entries.filter((e) =>
            isStrategyNest(e)
              ? e.rows.some((s) => strategyShown(s.value))
              : strategyShown(e.value),
          );
          const nSelected = selectedInGroup(g);
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
                    hasSubgroups || entries.length > 0
                      ? `${g.name} — expand for types`
                      : `${g.name} — expand for individual platforms`
                  }
                >
                  {chevron(isOpen)}
                  <span className="truncate">{g.name}</span>
                  {nSelected > 0 ? (
                    <span
                      className="text-[10px] text-gemma-accent font-medium tabular-nums"
                      title={`${nSelected} selected`}
                    >
                      ·{nSelected}
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
                    : null}
                  {shownEntries.map((e) =>
                    isStrategyNest(e) ? (
                      <li key={e.id} className="py-0.5">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={nestState(e) === "on"}
                            ref={(el) => {
                              if (el) el.indeterminate = nestState(e) === "partial";
                            }}
                            disabled={disabled}
                            onChange={() => toggleNest(e)}
                            className="h-3.5 w-3.5 accent-gemma-accent"
                          />
                          <button
                            type="button"
                            onClick={() => setOpen({ ...open, [e.id]: !open[e.id] })}
                            className="flex-1 text-left truncate hover:text-gemma-accent flex items-center gap-1 text-xs"
                            title={`${e.label} — expand for its types`}
                          >
                            {chevron(!!open[e.id])}
                            <span className="truncate">{e.label}</span>
                          </button>
                          <span
                            className="text-gemma-subtle text-xs tabular-nums"
                            title="At most this many — the rows below are summed, and a dataset carrying two of them is counted twice."
                          >
                            {nestCount(e)}
                          </span>
                        </div>
                        {open[e.id] ? (
                          <ul className="pl-6 border-l border-gemma-grid ml-1.5">
                            {e.rows
                              .filter((s) => strategyShown(s.value))
                              .map((s) => strategyRow(s, g))}
                          </ul>
                        ) : null}
                      </li>
                    ) : (
                      strategyRow(e, g)
                    ),
                  )}
                  {!hasSubgroups && entries.length === 0 ? platformList(g.platforms) : null}
                </ul>
              ) : null}
            </li>
          );
        })}
        {curatorOnlyRows.map((v) => (
          <li key={v} className="flex items-center gap-2 py-0.5">
            {strategyCheckbox(v)}
            <span className="flex-1 min-w-0 flex items-center gap-1.5" title={v}>
              {/* Lines the label up with the group names after their chevron. */}
              <span className="w-3 shrink-0" aria-hidden />
              <span className="truncate">{libraryStrategyLabel(v)}</span>
              {showCuratorOnlyTypes ? (
                <VisibilityChip
                  tone="restricted"
                  label="curators"
                  title="Hidden from visitors who are not curators or administrators, along with every dataset whose samples carry only this type."
                />
              ) : null}
            </span>
            <span className="text-gemma-subtle text-xs tabular-nums">{strategyCount(v)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
