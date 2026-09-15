// Left-side filter panel: query input + selectors.

import { useEffect, useState, type Dispatch, type MouseEvent as ReactMouseEvent } from "react";
import { VisibilityChip } from "@/components/VisibilityChip";
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

const SIDEBAR_WIDTH_KEY = "gemma-browser-sidebar-width";
const SIDEBAR_DEFAULT = 360;
const SIDEBAR_MIN = 280;
const SIDEBAR_MAX = 640;

/** The stored panel width, or the default when it is missing, unreadable
 *  or out of range. */
function readSidebarWidth(): number {
  try {
    const n = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return Number.isFinite(n) && n >= SIDEBAR_MIN && n <= SIDEBAR_MAX ? n : SIDEBAR_DEFAULT;
  } catch {
    return SIDEBAR_DEFAULT;
  }
}

interface Props {
  settings: SearchSettings;
  dispatch: Dispatch<SearchAction>;
  taxa: Taxon[];
  platforms: Platform[];
  /** Platforms under each Microarray channel row, keyed by strategy. */
  platformsByStrategy: Record<string, Platform[]>;
  annotations: CategoryWithChildren[];
  /** Datasets per library strategy; null while unknown. */
  libraryStrategyCounts: Map<string, number | null>;
  /** Offer the CURATOR_ONLY_LIBRARY_STRATEGIES rows. */
  showCuratorOnlyTypes: boolean;
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
  platformsByStrategy,
  annotations,
  libraryStrategyCounts,
  showCuratorOnlyTypes,
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
    (settings.libraryStrategies.length > 0 ? 1 : 0) +
    (settings.annotations.length > 0 ? 1 : 0) +
    (settings.negativeAnnotations.length > 0 ? 1 : 0) +
    (settings.categories.length > 0 ? 1 : 0) +
    (settings.negativeCategories.length > 0 ? 1 : 0) +
    (settings.query ? 1 : 0);

  const [width, setWidth] = useState(readSidebarWidth);
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
    } catch {
      // localStorage unavailable — the width still holds for this visit.
    }
  }, [width]);

  // Drag the gutter on the panel's right edge. Same handler shape as the
  // curation app's proposals sidebar (apps/curation/src/App.tsx).
  function startResize(e: ReactMouseEvent<HTMLDivElement>) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    function onMove(ev: MouseEvent) {
      setWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWidth + ev.clientX - startX)));
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <>
    <aside
      style={{ width }}
      className="shrink-0 border-r border-gemma-grid bg-white overflow-y-auto p-3"
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium inline-flex items-center gap-1.5">
          Search & filter
          <HelpHint
            label="Search & filter"
            body={
              "Free-text search runs against dataset titles, descriptions, and annotated terms." +
              "\nFilters narrow the same corpus by taxon, platform / technology (including one- or two-colour microarray), and ontology annotations." +
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
        platformsByStrategy={platformsByStrategy}
        annotations={annotations}
        selectedPlatforms={settings.platforms}
        selectedTechnologyTypes={settings.technologyTypes}
        selectedTechAnnotations={settings.annotations.filter((a) =>
          a.classUri === "http://purl.obolibrary.org/obo/OBI_0000070",
        )}
        selectedLibraryStrategies={settings.libraryStrategies}
        libraryStrategyCounts={libraryStrategyCounts}
        showCuratorOnlyTypes={showCuratorOnlyTypes}
        onChangeLibraryStrategies={(v) => dispatch({ type: "setLibraryStrategies", value: v })}
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
          Show all terms
          <VisibilityChip
            tone="restricted"
            label="admin"
            title="Only administrators see this option."
          />
        </label>
      ) : null}
    </aside>
    <div
      onMouseDown={startResize}
      className="w-1.5 -ml-1.5 shrink-0 cursor-col-resize relative z-10 group"
      title="Drag to resize the filter panel"
      role="separator"
      aria-orientation="vertical"
    >
      <div className="absolute inset-y-0 right-0 w-px group-hover:bg-blue-400 group-active:bg-blue-500 transition-colors" />
    </div>
    </>
  );
}
