// Left-side filter panel: query input + selectors.

import { useEffect, type Dispatch } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { getMyself } from "@/api/endpoints";
import { HelpHint } from "@/features/shared/HelpHint";
import type {
  CategoryWithChildren,
  Platform,
  SearchSettings,
  Taxon,
} from "@/lib/types";
import type { SearchAction } from "./searchSettingsState";
import { TaxonSelector } from "./TaxonSelector";
import { TechnologyTypeSelector } from "./TechnologyTypeSelector";
import { AnnotationSelector } from "./AnnotationSelector";

interface Props {
  settings: SearchSettings;
  dispatch: Dispatch<SearchAction>;
  taxa: Taxon[];
  platforms: Platform[];
  annotations: CategoryWithChildren[];
  loadingTaxa?: boolean;
  loadingPlatforms?: boolean;
  loadingAnnotations?: boolean;
  loadingDatasets?: boolean;
  onApplyQuery: (q: string | undefined) => void;
}

export function SidePanel({
  settings,
  dispatch,
  taxa,
  platforms,
  annotations,
  loadingTaxa,
  loadingPlatforms,
  loadingAnnotations,
  loadingDatasets,
  onApplyQuery,
}: Props) {
  const me = useQuery({ queryKey: ["me"], queryFn: ({ signal }) => getMyself(signal) });

  function applyQuery() {
    onApplyQuery(settings.currentQuery?.trim() ? settings.currentQuery.trim() : undefined);
  }

  // Unified search/filter: as the curator types, the same query
  // string drives the annotation-tree filter (live), the cross-
  // corpus "more matches" fallback (debounced inside the selector),
  // and — after a 400ms beat — the dataset text-search.
  //
  // The debounced apply dispatches ``setQuery`` directly (rather
  // than ``onApplyQuery`` which also navigates) so live typing
  // doesn't pile history entries onto the browser back stack —
  // navigation only fires on explicit Enter / clear via
  // ``applyQuery``. Per design review 2026-05-27: filter + search are the
  // same thing.
  useEffect(() => {
    const v = (settings.currentQuery ?? "").trim();
    const applied = settings.query ?? "";
    if (v === applied) return;
    const t = window.setTimeout(() => {
      dispatch({ type: "setQuery", value: v || undefined });
    }, 400);
    return () => window.clearTimeout(t);
  }, [settings.currentQuery, settings.query, dispatch]);

  function clearAll() {
    dispatch({ type: "reset" });
    onApplyQuery(undefined);
  }

  const filledCount =
    (settings.taxon.length > 0 ? 1 : 0) +
    (settings.platforms.length > 0 ? 1 : 0) +
    (settings.technologyTypes.length > 0 ? 1 : 0) +
    (settings.annotations.length > 0 ? 1 : 0) +
    (settings.negativeAnnotations.length > 0 ? 1 : 0) +
    (settings.categories.length > 0 ? 1 : 0) +
    (settings.negativeCategories.length > 0 ? 1 : 0) +
    (settings.query ? 1 : 0);

  return (
    <aside className="w-[360px] shrink-0 border-r border-gemma-grid bg-white overflow-y-auto p-3">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium inline-flex items-center gap-1.5">
          Search & filter
          <HelpHint
            label="Search & filter"
            body={
              "Free-text search runs against dataset titles, descriptions, and annotated terms." +
              "\nFilters narrow the same corpus by taxon, platform / technology, and ontology annotations." +
              "\nAll filters compose as AND; multi-pick within a section is OR." +
              "\nA term matches only where it is annotated under the category you picked it from — not merely somewhere in the dataset."
            }
          />
        </h2>
        {filledCount > 1 ? (
          <button onClick={clearAll} className="text-xs text-gemma-accent hover:underline">
            Clear all
          </button>
        ) : null}
      </div>

      {/* Unified search + filter. One input drives the annotation
          tree filter, the cross-corpus "more matches" fallback, and
          the dataset text-search. Enter applies immediately;
          otherwise a 400ms debounce kicks the dataset fetch (see
          the ``useEffect`` above).

          NOTE: the input is intentionally NOT ``disabled`` while the
          dataset query refetches. Disabling drops focus, and the
          400ms debounce + fast keystroke cadence meant the input
          went disabled mid-typing — every other character. Visual
          loading state goes on the right-edge slot instead. */}
      <div className="relative mb-4">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gemma-subtle" />
        <input
          type="text"
          placeholder="Search & filter…"
          value={settings.currentQuery ?? ""}
          onChange={(e) => dispatch({ type: "setCurrentQuery", value: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") applyQuery();
            if (e.key === "Escape" && settings.currentQuery) {
              e.preventDefault();
              dispatch({ type: "setCurrentQuery", value: "" });
              onApplyQuery(undefined);
            }
          }}
          className="input pl-7 pr-7"
        />
        {settings.currentQuery ? (
          <button
            type="button"
            onClick={() => {
              dispatch({ type: "setCurrentQuery", value: "" });
              onApplyQuery(undefined);
            }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-5 w-5 rounded text-gemma-subtle hover:text-gemma-ink hover:bg-stone-200"
            aria-label="Clear search"
            title="Clear (Esc)"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : loadingDatasets ? (
          <span
            className="absolute right-2 top-1/2 -translate-y-1/2 inline-block h-2 w-2 rounded-full bg-gemma-accent/70 animate-pulse"
            aria-label="Refreshing results…"
            title="Refreshing results…"
          />
        ) : null}
      </div>

      <TaxonSelector
        available={taxa}
        selected={settings.taxon}
        loading={loadingTaxa}
        disabled={loadingTaxa}
        onChange={(t) => dispatch({ type: "setTaxon", value: t })}
      />

      <TechnologyTypeSelector
        platforms={platforms}
        annotations={annotations}
        selectedPlatforms={settings.platforms}
        selectedTechnologyTypes={settings.technologyTypes}
        selectedTechAnnotations={settings.annotations.filter((a) =>
          a.classUri === "http://purl.obolibrary.org/obo/OBI_0000070",
        )}
        loading={loadingPlatforms}
        disabled={loadingPlatforms}
        onChangePlatforms={(p) => dispatch({ type: "setPlatforms", value: p })}
        onChangeTechnologyTypes={(t) => dispatch({ type: "setTechnologyTypes", value: t })}
        onChangeTechAnnotations={(picks) => {
          // Replace assay-category annotations in the full annotation list.
          const rest = settings.annotations.filter(
            (a) => a.classUri !== "http://purl.obolibrary.org/obo/OBI_0000070",
          );
          dispatch({ type: "setAnnotations", value: [...rest, ...picks] });
        }}
      />

      <AnnotationSelector
        annotations={annotations}
        selectedAnnotations={settings.annotations}
        negativeAnnotations={settings.negativeAnnotations}
        selectedCategories={settings.categories}
        negativeCategories={settings.negativeCategories}
        loading={loadingAnnotations}
        disabled={loadingAnnotations}
        onChangeSelected={(a) => dispatch({ type: "setAnnotations", value: a })}
        onChangeNegative={(a) => dispatch({ type: "setNegativeAnnotations", value: a })}
        onChangeCategoriesSelected={(c) => dispatch({ type: "setCategories", value: c })}
        onChangeCategoriesNegative={(c) => dispatch({ type: "setNegativeCategories", value: c })}
        // Wire the unified search/filter input above through to the
        // annotation tree so typing narrows it live, AND the
        // cross-corpus "more matches" fallback fires off the same
        // value. The selector's own input is hidden — the SidePanel
        // owns the input now.
        query={settings.currentQuery ?? ""}
        onQueryChange={(q) => dispatch({ type: "setCurrentQuery", value: q })}
        hideOwnInput
      />

      {me.data?.group === "Administrators" ? (
        <label className="flex items-center gap-2 text-xs text-gemma-subtle">
          <input
            type="checkbox"
            checked={settings.ignoreExcludedTerms}
            onChange={(e) => dispatch({ type: "setIgnoreExcludedTerms", value: e.target.checked })}
            className="h-3 w-3 accent-gemma-accent"
          />
          Show all terms (admin)
        </label>
      ) : null}
    </aside>
  );
}
