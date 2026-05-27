// Faceted ontology-annotation filter — ported from
// legacy-vue/src/components/AnnotationSelector.vue (592 lines).
//
// Tristate per term:
//   1  positive (include)
//   -1 negative (exclude)
//   0  unselected
//
// Categories collapse to one of five derived states (see iconForRoot).
// Clicking a category toggles all its children to the same state.

import { useEffect, useMemo, useState } from "react";
import pluralize from "pluralize";
import { titleCase } from "title-case";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Check, Loader2, Minus, Plus, X, Square } from "lucide-react";
import type {
  AnnotationSearchResult,
  AnnotationTerm,
  Category,
  CategoryWithChildren,
} from "@/lib/types";
import { searchAnnotations } from "@/api/endpoints";
import {
  annotationSelectorOrderArray,
  excludedTerms,
  ontologySources,
} from "@/lib/gemmaConfig";
import { formatNumber, getCategoryId, getTermId, TERM_ID_SEP } from "@/lib/utils";

// Matches the per-category fetch cap in api/endpoints.ts
// (getAnnotationsByCategory default `limit`). When a category returns
// at least this many children we surface a "… limit reached" hint so
// the user knows the list is truncated.
const ANNOTATION_FETCH_LIMIT = 200;

interface Props {
  annotations: CategoryWithChildren[];
  selectedAnnotations: AnnotationTerm[];
  negativeAnnotations: AnnotationTerm[];
  selectedCategories: Category[];
  negativeCategories: Category[];
  loading?: boolean;
  disabled?: boolean;
  onChangeSelected: (a: AnnotationTerm[]) => void;
  onChangeNegative: (a: AnnotationTerm[]) => void;
  onChangeCategoriesSelected: (c: Category[]) => void;
  onChangeCategoriesNegative: (c: Category[]) => void;
  /** Search query, lifted from the parent so the unified search +
   *  filter input can live at the top of the SidePanel and drive the
   *  annotation tree filter, the cross-corpus "more matches" fallback,
   *  AND the dataset text-search query simultaneously. When omitted,
   *  the component falls back to its own internal state for
   *  backwards-compat with older callers. */
  query?: string;
  onQueryChange?: (q: string) => void;
  /** When ``true``, hide the in-component search input — the parent
   *  is rendering its own (e.g. the SidePanel's top input). The
   *  ranked list still narrows by ``query``. */
  hideOwnInput?: boolean;
}

function getId(t: AnnotationTerm | Category): string {
  return `${getCategoryId(t)}${TERM_ID_SEP}${getTermId(t as AnnotationTerm)}`;
}

function categoryId(c: Category): string {
  return getCategoryId(c) ?? "";
}

function isExcluded(item: AnnotationTerm | Category): boolean {
  return (
    (item.classUri != null && excludedTerms.includes(item.classUri)) ||
    ((item as AnnotationTerm).termUri != null &&
      excludedTerms.includes((item as AnnotationTerm).termUri!))
  );
}

function getUri(item: AnnotationTerm | Category, isCategory: boolean): string | null {
  return isCategory ? item.classUri : (item as AnnotationTerm).termUri ?? null;
}

// externalUrl(uri) — kept in source for the planned hover-revealed
// "open in ontology" action; the ↗ link itself was hidden 2026-05-27
// because it was too noisy at scroll-pace. Re-enable when that
// enhancement lands. Until then, suppressed below to keep the
// no-unused-vars rule quiet.
//
// function externalUrl(uri: string): string | null {
//   for (const src of ontologySources) {
//     if (src.pattern.test(uri)) return src.getExternalUrl(uri);
//   }
//   return null;
// }
void ontologySources;

function getTitle(item: AnnotationTerm | Category, isCategory: boolean): string {
  if (isCategory) {
    return (
      (item.className && titleCase(pluralize(item.className))) ||
      item.classUri ||
      ""
    );
  }
  const t = item as AnnotationTerm;
  return titleCase(t.termName ?? "") || t.termUri || "";
}

function rankCategories(annotations: CategoryWithChildren[]): CategoryWithChildren[] {
  const sorted = [...annotations];
  sorted.sort((a, b) => {
    if (a.classUri && b.classUri) {
      const aI = annotationSelectorOrderArray.indexOf(a.classUri);
      const bI = annotationSelectorOrderArray.indexOf(b.classUri);
      if (aI !== -1 && bI !== -1) return aI - bI;
      if (aI !== -1) return -1;
      if (bI !== -1) return 1;
    } else if (a.classUri && annotationSelectorOrderArray.includes(a.classUri)) {
      return -1;
    } else if (b.classUri && annotationSelectorOrderArray.includes(b.classUri)) {
      return 1;
    }
    if (a.className && b.className) {
      return (b.numberOfExpressionExperiments ?? 0) - (a.numberOfExpressionExperiments ?? 0);
    }
    if (a.className) return -1;
    if (b.className) return 1;
    return 0;
  });
  return sorted;
}

export function AnnotationSelector(props: Props) {
  const {
    annotations,
    selectedAnnotations,
    negativeAnnotations,
    selectedCategories,
    negativeCategories,
    loading,
    disabled,
    onChangeSelected,
    onChangeNegative,
    onChangeCategoriesSelected,
    onChangeCategoriesNegative,
    query: controlledQuery,
    onQueryChange,
    hideOwnInput,
  } = props;

  // Selection state derives from props — we don't keep a parallel
  // copy; we read selected[] / negative[] / categories[] / negCats[]
  // and look them up by id.

  // Controlled-when-parent-passes-query / uncontrolled fallback. Old
  // callers that don't pass ``query`` keep the legacy behaviour
  // (component owns its own input + state).
  const isControlled = controlledQuery !== undefined;
  const [internalSearch, setInternalSearch] = useState("");
  const search = isControlled ? (controlledQuery ?? "") : internalSearch;
  const setSearch = (next: string) => {
    if (onQueryChange) onQueryChange(next);
    if (!isControlled) setInternalSearch(next);
  };
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // Per-category expansion of the chip strip. Keys are
  // `${pos|neg}:${catId}` so positive + negative groups for the same
  // category track independently.
  const [chipGroupExpanded, setChipGroupExpanded] = useState<Record<string, boolean>>({});

  // Debounce the search text by 300ms so we don't fire one /annotations/search
  // call per keystroke.
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  const fallback = useQuery({
    queryKey: ["annotationsFallback", debouncedSearch],
    enabled: debouncedSearch.length >= 2,
    queryFn: ({ signal }) => searchAnnotations(debouncedSearch, 30, signal),
    staleTime: 60_000,
  });

  const ranked = useMemo(() => rankCategories(annotations), [annotations]);

  // Ghost rows for any cat-level selection/negation whose category
  // isn't in the current facet response. Without these, a category
  // can become a chip the user can't get rid of via its parent
  // button — cat-level NOT narrows the result set enough that the
  // category drops out of the facet, leaving the chip stranded.
  // Ghosts give the cycle (all-pos → … → off) a parent button to
  // click for the final clean-up step.
  const displayCategories = useMemo(() => {
    const known = new Set(ranked.map((c) => categoryId(c)));
    const ghosts: CategoryWithChildren[] = [];
    for (const c of [...selectedCategories, ...negativeCategories]) {
      const cid = categoryId(c);
      if (!cid || known.has(cid)) continue;
      ghosts.push({
        classUri: c.classUri,
        className: c.className,
        numberOfExpressionExperiments: 0,
        children: [],
      });
      known.add(cid);
    }
    return [...ranked, ...ghosts];
  }, [ranked, selectedCategories, negativeCategories]);

  // De-dup fallback results against terms already present in the local
  // tree (by termUri), and against terms already selected/negated.
  const localTermUris = useMemo(() => {
    const s = new Set<string>();
    for (const cat of annotations) {
      for (const t of cat.children) if (t.termUri) s.add(t.termUri);
    }
    return s;
  }, [annotations]);
  const selectedTermUris = useMemo(
    () =>
      new Set(
        [...selectedAnnotations, ...negativeAnnotations]
          .map((a) => a.termUri)
          .filter(Boolean) as string[],
      ),
    [selectedAnnotations, negativeAnnotations],
  );
  const fallbackNew: AnnotationSearchResult[] = useMemo(() => {
    if (!fallback.data) return [];
    return fallback.data.filter(
      (r) => r.valueUri && !localTermUris.has(r.valueUri) && !selectedTermUris.has(r.valueUri),
    );
  }, [fallback.data, localTermUris, selectedTermUris]);

  const selectedIds = useMemo(() => new Set(selectedAnnotations.map(getId)), [selectedAnnotations]);
  const negativeIds = useMemo(() => new Set(negativeAnnotations.map(getId)), [negativeAnnotations]);
  const selectedCatIds = useMemo(() => new Set(selectedCategories.map(categoryId)), [selectedCategories]);
  const negativeCatIds = useMemo(() => new Set(negativeCategories.map(categoryId)), [negativeCategories]);

  const totalMarked =
    selectedAnnotations.length +
    negativeAnnotations.length +
    selectedCategories.length +
    negativeCategories.length;

  function termState(t: AnnotationTerm, catId: string): 1 | -1 | 0 {
    // category-level pos/neg overrides individual term state
    if (selectedCatIds.has(catId)) return 1;
    if (negativeCatIds.has(catId)) return -1;
    const id = getId(t);
    if (selectedIds.has(id)) return 1;
    if (negativeIds.has(id)) return -1;
    return 0;
  }

  type CategoryDerived = "all-pos" | "all-neg" | "some-pos" | "some-neg" | "mixed" | "empty";

  // Merge cat.children with any per-term selections / negations the
  // user holds for this category. The facet response narrows after a
  // bulk negation (server drops terms not present in the narrowed
  // result set), so without this supplement the in-list children
  // collapse to whatever survived — even though the user's filter
  // chips still reference the dropped terms.
  function mergedChildren(cat: CategoryWithChildren): AnnotationTerm[] {
    const cid = categoryId(cat);
    const merged = new Map<string, AnnotationTerm>();
    for (const c of cat.children) merged.set(getId(c), c);
    for (const t of selectedAnnotations) {
      if (getCategoryId(t) === cid) merged.set(getId(t), t);
    }
    for (const t of negativeAnnotations) {
      if (getCategoryId(t) === cid) merged.set(getId(t), t);
    }
    return [...merged.values()];
  }

  function categoryState(cat: CategoryWithChildren): CategoryDerived {
    const catId = categoryId(cat);
    if (selectedCatIds.has(catId)) return "all-pos";
    if (negativeCatIds.has(catId)) return "all-neg";
    const all = mergedChildren(cat);
    if (all.length === 0) return "empty";
    const states = all.map((c) => termState(c, catId));
    const hasPos = states.some((s) => s === 1);
    const hasNeg = states.some((s) => s === -1);
    // Treat "some children marked, none of the other polarity" as the
    // fully-marked state. Distinguishing some-vs-all is brittle because
    // ``cat.children`` changes after facet refresh (the set of "all" is
    // unstable). The cycle logic also requires this: ``some-neg`` would
    // route through the else branch into all-pos, making it impossible
    // to cycle back to off after a bulk negation.
    if (hasPos && hasNeg) return "mixed";
    if (hasPos) return "all-pos";
    if (hasNeg) return "all-neg";
    return "empty";
  }

  function cycleTerm(t: AnnotationTerm, cat: CategoryWithChildren) {
    if (disabled) return;
    const catId = categoryId(cat);
    // If category is in pos/neg mode, demote it to per-term first:
    // expand into individual-term selections excluding this one's flip.
    if (selectedCatIds.has(catId)) {
      const others = cat.children.filter((c) => getId(c) !== getId(t));
      onChangeCategoriesSelected(selectedCategories.filter((c) => categoryId(c) !== catId));
      onChangeSelected([
        ...selectedAnnotations.filter((a) => getCategoryId(a) !== catId),
        ...others,
      ]);
      onChangeNegative([...negativeAnnotations.filter((a) => getCategoryId(a) !== catId), t]);
      return;
    }
    if (negativeCatIds.has(catId)) {
      const others = cat.children.filter((c) => getId(c) !== getId(t));
      onChangeCategoriesNegative(negativeCategories.filter((c) => categoryId(c) !== catId));
      onChangeNegative([
        ...negativeAnnotations.filter((a) => getCategoryId(a) !== catId),
        ...others,
      ]);
      onChangeSelected([...selectedAnnotations.filter((a) => getCategoryId(a) !== catId), t]);
      return;
    }

    const id = getId(t);
    const cur = selectedIds.has(id) ? 1 : negativeIds.has(id) ? -1 : 0;
    const next: 1 | -1 | 0 = cur === 0 ? 1 : cur === 1 ? -1 : 0;
    // remove from both, then add to the right one
    const sel = selectedAnnotations.filter((a) => getId(a) !== id);
    const neg = negativeAnnotations.filter((a) => getId(a) !== id);
    if (next === 1) onChangeSelected([...sel, t]);
    else onChangeSelected(sel);
    if (next === -1) onChangeNegative([...neg, t]);
    else onChangeNegative(neg);
  }

  function cycleCategory(cat: CategoryWithChildren) {
    if (disabled) return;
    const cid = categoryId(cat);
    const state = categoryState(cat);
    const asCategory: Category = { classUri: cat.classUri, className: cat.className };

    // Clear all per-term states for this category as we move category-level
    const clearedSel = selectedAnnotations.filter((a) => getCategoryId(a) !== cid);
    const clearedNeg = negativeAnnotations.filter((a) => getCategoryId(a) !== cid);
    const clearedCatSel = selectedCategories.filter((c) => categoryId(c) !== cid);
    const clearedCatNeg = negativeCategories.filter((c) => categoryId(c) !== cid);

    if (state === "all-pos") {
      // pos -> neg. Expand to per-term negation rather than category-
      // level NOT: cat-level NOT narrows the facet response so hard
      // that the children list collapses to whatever still survives
      // in the narrowed result set, which reads as "the click ate the
      // list." Per-term keeps each previously-visible child pinned via
      // negativeAnnotations + the supplemented render path, so all
      // children flip from blue check to red X.
      const children = mergedChildren(cat);
      onChangeSelected(clearedSel);
      onChangeNegative([...clearedNeg, ...children]);
      onChangeCategoriesSelected(clearedCatSel);
      onChangeCategoriesNegative(clearedCatNeg);
    } else if (state === "all-neg") {
      // neg -> off
      onChangeSelected(clearedSel);
      onChangeNegative(clearedNeg);
      onChangeCategoriesSelected(clearedCatSel);
      onChangeCategoriesNegative(clearedCatNeg);
    } else {
      // off / some / mixed -> all-pos
      onChangeSelected(clearedSel);
      onChangeNegative(clearedNeg);
      onChangeCategoriesNegative(clearedCatNeg);
      onChangeCategoriesSelected([...clearedCatSel, asCategory]);
    }
  }

  function clearAll() {
    onChangeSelected([]);
    onChangeNegative([]);
    onChangeCategoriesSelected([]);
    onChangeCategoriesNegative([]);
  }

  function filterTermBySearch(term: AnnotationTerm): boolean {
    if (!search) return true;
    const fragments = pluralize.singular(search.toLowerCase()).split(" ");
    const title = getTitle(term, false).toLowerCase();
    const uri = (getUri(term, false) ?? "").toLowerCase();
    return fragments.every((f) => title.includes(f) || uri === f);
  }

  return (
    <section className="mb-4">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <h3 className="side-heading">Annotations</h3>
        <div className="flex items-baseline gap-3">
          {/* Collapse-all — appears only when at least one category
              is open. No open-all counterpart (Paul lukewarm on it —
              expanding every category at once is rarely the curator's
              intent; the search field is the better discovery path). */}
          {Object.values(open).some(Boolean) ? (
            <button
              type="button"
              onClick={() => setOpen({})}
              disabled={disabled}
              className="text-xs text-gemma-subtle hover:text-gemma-ink hover:underline"
              title="Collapse all categories"
            >
              Collapse all
            </button>
          ) : null}
          {totalMarked > 0 ? (
            <button
              type="button"
              onClick={clearAll}
              disabled={disabled}
              className="text-xs text-gemma-accent hover:underline"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {loading ? <div className="h-0.5 bg-gemma-accent/30 animate-pulse mb-1" /> : null}

      {totalMarked > 0 ? (
        <div className="flex flex-wrap gap-1 mb-2">
          {selectedCategories.map((c) => (
            <ChipRemovable
              key={`cat-${c.classUri ?? c.className}`}
              cls="chip-cat"
              text={`${titleCase(c.className ?? c.classUri ?? "Uncategorized")}: ANY`}
              title={c.classUri ?? undefined}
              onRemove={() =>
                onChangeCategoriesSelected(
                  selectedCategories.filter(
                    (x) => (x.classUri ?? x.className) !== (c.classUri ?? c.className),
                  ),
                )
              }
            />
          ))}
          {negativeCategories.map((c) => (
            <ChipRemovable
              key={`xcat-${c.classUri ?? c.className}`}
              cls="chip-neg"
              text={`NOT ${titleCase(c.className ?? c.classUri ?? "Uncategorized")}: ANY`}
              onRemove={() =>
                onChangeCategoriesNegative(
                  negativeCategories.filter(
                    (x) => (x.classUri ?? x.className) !== (c.classUri ?? c.className),
                  ),
                )
              }
            />
          ))}
          {renderTermChipsGrouped({
            terms: selectedAnnotations,
            sign: "pos",
            chipGroupExpanded,
            setChipGroupExpanded,
            onRemoveOne: (a) =>
              onChangeSelected(
                selectedAnnotations.filter(
                  (x) => (x.termUri ?? x.termName) !== (a.termUri ?? a.termName),
                ),
              ),
            onRemoveGroup: (cid) =>
              onChangeSelected(
                selectedAnnotations.filter((x) => (getCategoryId(x) ?? "") !== cid),
              ),
          })}
          {renderTermChipsGrouped({
            terms: negativeAnnotations,
            sign: "neg",
            chipGroupExpanded,
            setChipGroupExpanded,
            onRemoveOne: (a) =>
              onChangeNegative(
                negativeAnnotations.filter(
                  (x) => (x.termUri ?? x.termName) !== (a.termUri ?? a.termName),
                ),
              ),
            onRemoveGroup: (cid) =>
              onChangeNegative(
                negativeAnnotations.filter((x) => (getCategoryId(x) ?? "") !== cid),
              ),
          })}
        </div>
      ) : null}

      {hideOwnInput ? null : (
        <div className="relative mb-1">
          <input
            type="text"
            placeholder="Filter annotations…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              // Escape resets the filter without losing focus — saves
              // the curator from having to mouse over to the clear
              // button when they're already typing.
              if (e.key === "Escape" && search) {
                e.preventDefault();
                setSearch("");
              }
            }}
            disabled={disabled}
            className="input text-xs pr-7"
          />
          {/* Right-edge slot: clear-button when there's a query, spinner
              while the cross-corpus fallback is fetching. Spinner only
              renders when there's no clear button to take its slot;
              ``search`` is the gate. */}
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              disabled={disabled}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-5 w-5 rounded text-gemma-subtle hover:text-gemma-ink hover:bg-stone-200 disabled:opacity-40"
              aria-label="Clear filter"
              title="Clear filter (Esc)"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : fallback.isFetching ? (
            <Loader2
              className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-gemma-subtle"
              aria-label="Searching all annotations…"
            />
          ) : null}
        </div>
      )}

      <ul className="text-sm">
        {displayCategories.length === 0 && !loading ? (
          <li className="text-gemma-subtle italic py-1">No annotations available</li>
        ) : null}
        {displayCategories.map((cat) => {
          const cid = categoryId(cat);
          const isOpen = search ? true : !!open[cid];
          const mergedKids = mergedChildren(cat);
          const visibleChildren = mergedKids.filter(filterTermBySearch);
          if (search && visibleChildren.length === 0) return null;
          const catState = categoryState(cat);

          // Folded-state summary: name the first two selected terms
          // inline below the category header so a curator can see at a
          // glance which categories carry active filters without
          // expanding each one. Truncated; "+N" expander shows the
          // overflow count. Mirrors how the dashboard ticket cards
          // surface their per-target progress. Per Paul 2026-05-27.
          const selectedHere = mergedKids.filter(
            (t) => termState(t, cid) !== 0,
          );
          return (
            <li key={cid} className="py-0.5">
              <div className="flex items-center gap-1.5">
                <CategoryStateButton state={catState} onClick={() => cycleCategory(cat)} disabled={disabled} />
                <button
                  type="button"
                  onClick={() => setOpen({ ...open, [cid]: !isOpen })}
                  className="flex-1 text-left truncate hover:text-gemma-accent flex items-center gap-1"
                  title={getTitle(cat, true)}
                >
                  <ChevronRight
                    className={`h-3 w-3 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                  />
                  <span className="truncate">
                    {cat.className ? titleCase(pluralize(cat.className)) : (cat.classUri ?? <i>Uncategorized</i>)}
                  </span>
                  {selectedHere.length > 0 ? (
                    <span
                      className="text-[10px] text-gemma-accent font-medium tabular-nums"
                      aria-label={`${selectedHere.length} selected`}
                      title={`${selectedHere.length} selected`}
                    >
                      ·{selectedHere.length}
                    </span>
                  ) : null}
                </button>
                <span className="text-gemma-subtle text-xs tabular-nums">
                  {formatNumber(cat.numberOfExpressionExperiments ?? 0)}
                </span>
              </div>
              {!isOpen && selectedHere.length > 0 ? (
                <div className="ml-7 -mt-0.5 flex flex-wrap items-baseline gap-1 text-[10px] text-gemma-accent truncate">
                  {selectedHere.slice(0, 2).map((t, i) => (
                    <span
                      key={getId(t)}
                      className={`truncate ${termState(t, cid) === -1 ? "line-through opacity-70" : ""}`}
                      title={getTitle(t, false)}
                    >
                      {i > 0 ? <span className="text-gemma-subtle mr-1">·</span> : null}
                      {titleCase(t.termName ?? "")}
                    </span>
                  ))}
                  {selectedHere.length > 2 ? (
                    <span className="text-gemma-subtle">
                      +{selectedHere.length - 2}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {isOpen ? (() => {
                // Pin checked terms (state ≠ 0) to the top of the
                // category's scroll area so a curator scanning a long
                // list of unselected terms doesn't lose track of what's
                // already in the filter. The selected group is its own
                // sticky band: capped at ``max-h-28`` with internal
                // overflow when many are checked — beyond that the
                // band scrolls, the rest of the list still scrolls
                // underneath it.
                //
                // Render order in the term row is unchanged
                // (checkbox · label · count); only the position is.
                // Ontology external-link (``↗``) hidden 2026-05-27 —
                // distracting at scroll-pace; we'll bring it back as
                // a hover-revealed action when the enhancement pass
                // happens. URI resolution kept in place for that
                // future surface.
                const selected = visibleChildren.filter(
                  (t) => termState(t, cid) !== 0,
                );
                const unselected = visibleChildren.filter(
                  (t) => termState(t, cid) === 0,
                );
                const renderRow = (t: AnnotationTerm) => {
                  const state = termState(t, cid);
                  return (
                    <li key={getId(t)} className="flex items-center gap-1.5 py-0.5">
                      <TermStateButton
                        state={state}
                        onClick={() => cycleTerm(t, cat)}
                        disabled={disabled}
                      />
                      <span
                        className={`flex-1 truncate text-xs ${isExcluded(t) ? "line-through text-gemma-subtle" : ""}`}
                        title={getTitle(t, false)}
                      >
                        {titleCase(t.termName ?? "")}
                      </span>
                      <span className="text-gemma-subtle text-xs tabular-nums">
                        ≥{formatNumber(t.numberOfExpressionExperiments ?? 0)}
                      </span>
                    </li>
                  );
                };
                return (
                  <div className="pl-5 border-l border-gemma-grid ml-1 mt-0.5 max-h-72 overflow-y-auto relative">
                    {selected.length > 0 ? (
                      <ul
                        className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-gemma-grid max-h-28 overflow-y-auto"
                        title={`${selected.length} selected in ${cat.className ?? "category"}`}
                      >
                        {selected.map(renderRow)}
                      </ul>
                    ) : null}
                    <ul>
                      {unselected.map(renderRow)}
                      {!search && cat.children.length >= ANNOTATION_FETCH_LIMIT ? (
                        <li className="text-xs text-gemma-subtle italic py-1 pl-1">
                          … limit reached ({ANNOTATION_FETCH_LIMIT} terms shown, narrow filters to see more)
                        </li>
                      ) : null}
                    </ul>
                  </div>
                );
              })() : null}
            </li>
          );
        })}
      </ul>

      {/* Cross-corpus fallback search — terms that match the query
          but are NOT currently in the dataset filter's catalog. These
          render BELOW the catalog list so the in-filter hits keep
          their visual primacy; the curator drops down here only when
          the catalog doesn't have what they need. Per Paul 2026-05-27. */}
      {debouncedSearch.length >= 2 && fallbackNew.length > 0 ? (
        <div className="mt-2 pt-1 border-t border-gemma-grid">
          <div className="text-[10px] uppercase tracking-wider text-gemma-subtle pt-1 pb-0.5">
            More matches ({fallbackNew.length})
            <span className="ml-1 italic normal-case tracking-normal">
              — not in current dataset filter; click to add anyway
            </span>
          </div>
          <ul className="text-sm">
            {fallbackNew.slice(0, 20).map((r) => (
              <li key={r.valueUri ?? r.value} className="flex items-center gap-1.5 py-0.5">
                <button
                  type="button"
                  onClick={() => {
                    onChangeSelected([
                      ...selectedAnnotations,
                      {
                        classUri: r.categoryUri ?? null,
                        className: r.category ?? null,
                        termUri: r.valueUri ?? null,
                        termName: r.value,
                      },
                    ]);
                  }}
                  disabled={disabled}
                  className="tristate-btn"
                  title="Add to filter"
                >
                  <Plus className="h-3 w-3" />
                </button>
                <span className="flex-1 truncate text-xs" title={r.value}>
                  {titleCase(r.value)}
                </span>
                {r.category ? (
                  <span className="text-[10px] text-gemma-subtle truncate max-w-[8ch]" title={r.category}>
                    {r.category}
                  </span>
                ) : null}
              </li>
            ))}
            {fallbackNew.length > 20 ? (
              <li className="text-xs text-gemma-subtle italic py-0.5">
                + {fallbackNew.length - 20} more — narrow the search
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function ChipRemovable({
  cls,
  text,
  title,
  onRemove,
}: {
  cls?: string;
  text: string;
  title?: string;
  onRemove: () => void;
}) {
  return (
    <span className={`chip ${cls ?? ""}`} title={title}>
      <span className="max-w-[18ch] truncate">{text}</span>
      <button onClick={onRemove} className="opacity-60 hover:opacity-100">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

// Per-term chips collapse into a single summary chip when there are
// ``CHIP_COLLAPSE_THRESHOLD`` or more for the same category — bulk-
// negating a large category (e.g. "Diets") previously produced ~20+
// individual chips that flooded the filter strip. Click the summary
// chip to expand into individuals; the X clears the entire group.
const CHIP_COLLAPSE_THRESHOLD = 5;

function renderTermChipsGrouped({
  terms,
  sign,
  chipGroupExpanded,
  setChipGroupExpanded,
  onRemoveOne,
  onRemoveGroup,
}: {
  terms: AnnotationTerm[];
  sign: "pos" | "neg";
  chipGroupExpanded: Record<string, boolean>;
  setChipGroupExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onRemoveOne: (a: AnnotationTerm) => void;
  onRemoveGroup: (cid: string) => void;
}): React.ReactNode {
  if (terms.length === 0) return null;
  const groups = new Map<string, AnnotationTerm[]>();
  const labels = new Map<string, string>();
  for (const t of terms) {
    const cid = getCategoryId(t) ?? "";
    if (!groups.has(cid)) {
      groups.set(cid, []);
      labels.set(cid, t.className ?? cid ?? "Uncategorized");
    }
    groups.get(cid)!.push(t);
  }
  const out: React.ReactNode[] = [];
  for (const [cid, group] of groups) {
    const key = `${sign}:${cid}`;
    const expanded = !!chipGroupExpanded[key];
    const overThreshold = group.length >= CHIP_COLLAPSE_THRESHOLD;
    const catLabel = titleCase(labels.get(cid) ?? "Uncategorized");
    if (overThreshold && !expanded) {
      const text =
        sign === "neg"
          ? `NOT ${catLabel} × ${group.length}`
          : `${catLabel} × ${group.length}`;
      out.push(
        <span
          key={`grp-${sign}-${cid}`}
          className={`chip ${sign === "neg" ? "chip-neg" : "chip-pos"} cursor-pointer`}
          title={`${group.length} ${sign === "neg" ? "negated" : "selected"} ${catLabel} term${group.length === 1 ? "" : "s"} — click to expand`}
          onClick={() => setChipGroupExpanded((s) => ({ ...s, [key]: true }))}
        >
          <span className="max-w-[20ch] truncate">{text}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemoveGroup(cid);
            }}
            className="opacity-60 hover:opacity-100"
          >
            <X className="h-3 w-3" />
          </button>
        </span>,
      );
      continue;
    }
    for (const a of group) {
      out.push(
        <ChipRemovable
          key={`${sign === "neg" ? "xan" : "an"}-${a.termUri ?? a.termName}`}
          cls={sign === "neg" ? "chip-neg" : "chip-pos"}
          text={
            sign === "neg"
              ? `NOT ${titleCase(a.termName ?? a.termUri ?? "")}`
              : titleCase(a.termName ?? a.termUri ?? "")
          }
          title={
            sign === "neg"
              ? `NOT ${a.className ?? ""} → ${a.termName ?? a.termUri}`
              : `${a.className ?? ""} → ${a.termName ?? a.termUri}`
          }
          onRemove={() => onRemoveOne(a)}
        />,
      );
    }
    if (overThreshold && expanded) {
      out.push(
        <button
          key={`collapse-${sign}-${cid}`}
          type="button"
          onClick={() => setChipGroupExpanded((s) => ({ ...s, [key]: false }))}
          className="text-[10px] text-gemma-subtle hover:text-gemma-ink hover:underline ml-1 self-center"
          title="Collapse group"
        >
          collapse
        </button>,
      );
    }
  }
  return out;
}

/** Tristate "checkbox" — three visible states so the curator can see
 *  the affordance even when nothing is selected:
 *
 *   - ``0`` (unselected) → empty square outline, click selects
 *   - ``1`` (include)    → filled accent square with check
 *   - ``-1`` (exclude)   → red square with X
 *
 *  Matches the legacy GemBrow's ``iconForState`` semantics — the
 *  ported React version had been collapsing state 0 to a bare
 *  unstyled button, which read as "no checkbox" on the page. */
function TermStateButton({
  state,
  disabled,
  onClick,
}: {
  state: 1 | -1 | 0;
  disabled?: boolean;
  onClick: () => void;
}) {
  const base =
    "inline-flex items-center justify-center h-4 w-4 shrink-0 rounded-sm border cursor-pointer transition-colors";
  const tone =
    state === 1
      ? "bg-blue-600 border-blue-600 text-white hover:bg-blue-700"
      : state === -1
        ? "bg-rose-600 border-rose-600 text-white hover:bg-rose-700"
        : "bg-white border-stone-400 text-stone-400 hover:border-stone-600 dark:bg-slate-800 dark:border-slate-500 dark:hover:border-slate-300";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${tone}`}
      title={
        state === 1
          ? "Selected (click to negate)"
          : state === -1
            ? "Negated (click to clear)"
            : "Click to select"
      }
    >
      {state === 1 ? (
        <Check className="h-3 w-3" />
      ) : state === -1 ? (
        <X className="h-3 w-3" />
      ) : null}
    </button>
  );
}

function CategoryStateButton({
  state,
  disabled,
  onClick,
}: {
  state: "all-pos" | "all-neg" | "some-pos" | "some-neg" | "mixed" | "empty";
  disabled?: boolean;
  onClick: () => void;
}) {
  const base =
    "inline-flex items-center justify-center h-4 w-4 shrink-0 rounded-sm border cursor-pointer transition-colors";
  let tone: string;
  let icon: React.ReactNode = null;
  switch (state) {
    case "all-pos":
      tone = "bg-blue-600 border-blue-600 text-white hover:bg-blue-700";
      icon = <Check className="h-3 w-3" />;
      break;
    case "all-neg":
      tone = "bg-rose-600 border-rose-600 text-white hover:bg-rose-700";
      icon = <X className="h-3 w-3" />;
      break;
    case "some-pos":
      tone =
        "bg-white border-blue-500 text-blue-600 hover:border-blue-700 dark:bg-slate-800";
      icon = <Minus className="h-3 w-3" />;
      break;
    case "some-neg":
      tone =
        "bg-white border-rose-500 text-rose-600 hover:border-rose-700 dark:bg-slate-800";
      icon = <Minus className="h-3 w-3" />;
      break;
    case "mixed":
      tone =
        "bg-white border-stone-400 text-stone-500 hover:border-stone-600 dark:bg-slate-800";
      icon = <Square className="h-3 w-3" />;
      break;
    case "empty":
      tone =
        "bg-white border-stone-400 text-stone-400 hover:border-stone-600 dark:bg-slate-800 dark:border-slate-500";
      icon = null;
      break;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${tone}`}
      title="Cycle category"
    >
      {icon}
    </button>
  );
}
