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

function externalUrl(uri: string): string | null {
  for (const src of ontologySources) {
    if (src.pattern.test(uri)) return src.getExternalUrl(uri);
  }
  return null;
}

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
  } = props;

  // Selection state derives from props — we don't keep a parallel
  // copy; we read selected[] / negative[] / categories[] / negCats[]
  // and look them up by id.

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});

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
  function categoryState(cat: CategoryWithChildren): CategoryDerived {
    const catId = categoryId(cat);
    if (selectedCatIds.has(catId)) return "all-pos";
    if (negativeCatIds.has(catId)) return "all-neg";
    const states = cat.children.map((c) => termState(c, catId));
    const hasPos = states.some((s) => s === 1);
    const hasNeg = states.some((s) => s === -1);
    if (hasPos && hasNeg) return "mixed";
    if (hasPos) return "some-pos";
    if (hasNeg) return "some-neg";
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
      // pos -> neg
      onChangeSelected(clearedSel);
      onChangeNegative(clearedNeg);
      onChangeCategoriesSelected(clearedCatSel);
      onChangeCategoriesNegative([...clearedCatNeg, asCategory]);
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
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="side-heading">Annotations</h3>
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
          {selectedAnnotations.map((a) => (
            <ChipRemovable
              key={`an-${a.termUri ?? a.termName}`}
              cls="chip-pos"
              text={titleCase(a.termName ?? a.termUri ?? "")}
              title={`${a.className ?? ""} → ${a.termName ?? a.termUri}`}
              onRemove={() =>
                onChangeSelected(
                  selectedAnnotations.filter(
                    (x) => (x.termUri ?? x.termName) !== (a.termUri ?? a.termName),
                  ),
                )
              }
            />
          ))}
          {negativeAnnotations.map((a) => (
            <ChipRemovable
              key={`xan-${a.termUri ?? a.termName}`}
              cls="chip-neg"
              text={`NOT ${titleCase(a.termName ?? a.termUri ?? "")}`}
              title={`NOT ${a.className ?? ""} → ${a.termName ?? a.termUri}`}
              onRemove={() =>
                onChangeNegative(
                  negativeAnnotations.filter(
                    (x) => (x.termUri ?? x.termName) !== (a.termUri ?? a.termName),
                  ),
                )
              }
            />
          ))}
        </div>
      ) : null}

      <div className="relative mb-1">
        <input
          type="text"
          placeholder="Filter annotations…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={disabled}
          className="input text-xs pr-7"
        />
        {fallback.isFetching ? (
          <Loader2
            className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-gemma-subtle"
            aria-label="Searching all annotations…"
          />
        ) : null}
      </div>

      {debouncedSearch.length >= 2 && fallbackNew.length > 0 ? (
        <div className="mb-2 pt-1 border-t border-gemma-grid">
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

      <ul className="text-sm">
        {ranked.length === 0 && !loading ? (
          <li className="text-gemma-subtle italic py-1">No annotations available</li>
        ) : null}
        {ranked.map((cat) => {
          const cid = categoryId(cat);
          const isOpen = search ? true : !!open[cid];
          const visibleChildren = cat.children.filter(filterTermBySearch);
          if (search && visibleChildren.length === 0) return null;
          const catState = categoryState(cat);

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
                </button>
                <span className="text-gemma-subtle text-xs tabular-nums">
                  {formatNumber(cat.numberOfExpressionExperiments ?? 0)}
                </span>
              </div>
              {isOpen ? (
                <ul className="pl-5 border-l border-gemma-grid ml-1 mt-0.5 max-h-72 overflow-y-auto">
                  {visibleChildren.map((t) => {
                    const state = termState(t, cid);
                    const uri = getUri(t, false);
                    const ext = uri ? externalUrl(uri) : null;
                    return (
                      <li key={getId(t)} className="flex items-center gap-1.5 py-0.5">
                        <TermStateButton state={state} onClick={() => cycleTerm(t, cat)} disabled={disabled} />
                        <span
                          className={`flex-1 truncate text-xs ${isExcluded(t) ? "line-through text-gemma-subtle" : ""}`}
                          title={getTitle(t, false)}
                        >
                          {titleCase(t.termName ?? "")}
                        </span>
                        {ext ? (
                          <a
                            href={ext}
                            target="_blank"
                            rel="noreferrer"
                            className="text-gemma-subtle hover:text-gemma-accent text-xs"
                            title="Open in ontology browser"
                          >
                            ↗
                          </a>
                        ) : null}
                        <span className="text-gemma-subtle text-xs tabular-nums">
                          ≥{formatNumber(t.numberOfExpressionExperiments ?? 0)}
                        </span>
                      </li>
                    );
                  })}
                  {!search && cat.children.length >= ANNOTATION_FETCH_LIMIT ? (
                    <li className="text-xs text-gemma-subtle italic py-1 pl-1">
                      … limit reached ({ANNOTATION_FETCH_LIMIT} terms shown, narrow filters to see more)
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
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

function TermStateButton({
  state,
  disabled,
  onClick,
}: {
  state: 1 | -1 | 0;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`tristate-btn ${state === 1 ? "pos" : state === -1 ? "neg" : ""}`}
      title={state === 1 ? "Selected (click to negate)" : state === -1 ? "Negated (click to clear)" : "Click to select"}
    >
      {state === 1 ? <Check className="h-3 w-3" /> : state === -1 ? <X className="h-3 w-3" /> : null}
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
  let cls = "tristate-btn";
  let icon: React.ReactNode = null;
  switch (state) {
    case "all-pos": cls += " pos"; icon = <Check className="h-3 w-3" />; break;
    case "all-neg": cls += " neg"; icon = <X className="h-3 w-3" />; break;
    case "some-pos": icon = <Minus className="h-3 w-3 text-gemma-accent" />; break;
    case "some-neg": icon = <Minus className="h-3 w-3 text-rose-500" />; break;
    case "mixed":   icon = <Square className="h-3 w-3 text-gemma-subtle" />; break;
    case "empty":   icon = null; break;
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls} title="Cycle category">
      {icon}
    </button>
  );
}
