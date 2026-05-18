// Left-side filter panel: query input + selectors.

import { useQuery } from "@tanstack/react-query";
import type { Dispatch } from "react";
import { Search } from "lucide-react";
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
              "\nAll filters compose as AND; multi-pick within a section is OR."
            }
          />
        </h2>
        {filledCount > 1 ? (
          <button onClick={clearAll} className="text-xs text-gemma-accent hover:underline">
            Clear all
          </button>
        ) : null}
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gemma-subtle" />
        <input
          type="text"
          placeholder="Search… (press Enter)"
          value={settings.currentQuery ?? ""}
          onChange={(e) => dispatch({ type: "setCurrentQuery", value: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") applyQuery();
          }}
          className="input pl-7"
          disabled={loadingDatasets}
        />
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
