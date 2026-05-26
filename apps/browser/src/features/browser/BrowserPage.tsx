// The browser page — wires the side panel, results table, filter
// chips, paging, and the code-snippet / download actions.

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronUp, Code2 } from "lucide-react";
import { getMyself } from "@/api/endpoints";
import { HelpHint } from "@/features/shared/HelpHint";
import { fallbackTaxa } from "@/lib/gemmaConfig";
import { emptySearchSettings } from "@/lib/types";
import { generateFilter, generateFilterDescription, generateFilterSummary } from "@/lib/filter";
import { SidePanel } from "./SidePanel";
import { ResultsTable } from "./ResultsTable";
import { Pager } from "./Pager";
import { CodeSnippet } from "./CodeSnippet";
import { DownloadButton } from "./DownloadButton";
import {
  makeInitialSettings,
  searchReducer,
} from "./searchSettingsState";
import {
  useDatasets,
  usePlatforms,
  useTaxa,
  useCategories,
  type BrowsingOptions,
} from "./queries";
import { useUrlInitial } from "@/features/shared/useUrlInitial";

export function BrowserPage() {
  const url = useUrlInitial();
  const navigate = useNavigate();

  // We can't seed taxon[] without the taxa list, which loads async.
  // Start empty; once taxa arrive, swap in if initialTaxon was set.
  const [settings, dispatch] = useReducer(
    searchReducer,
    null,
    () =>
      makeInitialSettings({
        query: url.query,
        preset: url.preset,
      }),
  );

  const seededTaxonRef = useRef(false);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<string | undefined>("-id");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [showSnippet, setShowSnippet] = useState(false);

  const me = useQuery({ queryKey: ["me"], queryFn: ({ signal }) => getMyself(signal) });
  const gid = me.data?.group;

  const filter = useMemo(() => generateFilter(settings), [settings]);

  const browsing: BrowsingOptions = useMemo(
    () => ({
      query: settings.query,
      filter,
      offset: (page - 1) * pageSize,
      limit: pageSize,
      sort,
      ignoreExcludedTerms: settings.ignoreExcludedTerms,
      gid,
    }),
    [settings.query, filter, page, pageSize, sort, settings.ignoreExcludedTerms, gid],
  );

  const datasets = useDatasets(browsing);
  const taxa = useTaxa({ query: settings.query, filter, gid });
  const platforms = usePlatforms({ query: settings.query, filter, gid });
  const categories = useCategories({
    query: settings.query,
    filter,
    applyExclusions: !settings.ignoreExcludedTerms,
    gid,
  });

  // Seed initial taxon once taxa are loaded
  useEffect(() => {
    if (seededTaxonRef.current) return;
    if (!url.initialTaxon) {
      seededTaxonRef.current = true;
      return;
    }
    if (taxa.data?.data && taxa.data.data.length > 0) {
      const seeded = makeInitialSettings({
        query: url.query,
        preset: url.preset,
        initialTaxon: url.initialTaxon,
        taxa: taxa.data.data,
      });
      dispatch({ type: "load", value: seeded });
      seededTaxonRef.current = true;
    }
  }, [url.query, url.initialTaxon, url.preset, taxa.data?.data]);

  // Reset page on filter/query changes
  useEffect(() => {
    setPage(1);
  }, [settings.query, filter]);

  function onApplyQuery(q: string | undefined) {
    dispatch({ type: "setQuery", value: q });
    // Route is /browser/q/$query (see routeTree). The earlier
    // /q/<query> dropped the /browser prefix, landing the user on
    // a 404. Empty query falls back to the un-queried /browser.
    navigate({
      to: q ? `/browser/q/${encodeURIComponent(q)}` : "/browser",
    });
  }

  function toggleExpanded(id: number) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  }

  const total = datasets.data?.totalElements ?? 0;
  const list = datasets.data?.data ?? [];
  const taxaList = taxa.data?.data?.length ? taxa.data.data : fallbackTaxa;
  const platformList = platforms.data?.data ?? [];
  const annotationList = categories.data ?? [];

  const filterSummary = generateFilterSummary(settings);
  const filterDescription = generateFilterDescription(settings);

  return (
    <div className="flex h-full">
      <SidePanel
        settings={settings}
        dispatch={dispatch}
        taxa={taxaList}
        platforms={platformList}
        annotations={annotationList}
        loadingTaxa={taxa.isFetching}
        loadingPlatforms={platforms.isFetching}
        loadingAnnotations={categories.isFetching}
        loadingDatasets={datasets.isFetching}
        onApplyQuery={onApplyQuery}
      />

      <section className="flex-1 min-w-0 flex flex-col">
        <div
          className={`progress-lane ${
            datasets.isFetching ||
            taxa.isFetching ||
            platforms.isFetching ||
            categories.isFetching
              ? "busy"
              : ""
          }`}
          aria-hidden
        />
        <div className="flex items-center gap-3 px-3 h-10 border-b border-gemma-grid">
          <h2 className="text-sm font-medium inline-flex items-center gap-1.5">
            {total > 0 ? (
              <>Showing <span className="tabular-nums">{total.toLocaleString()}</span> results</>
            ) : datasets.isLoading ? "Loading…" : "No results"}
            <HelpHint
              label="Result row"
              body={
                "Each row is one Gemma expression dataset." +
                "\nClick a row to expand: full description, ontology annotations, and outbound links to Gemma / GEO." +
                "\nClick an annotation chip to add it to your filters; click the column header to sort." +
                "\nThe colored dot is the GEEQ quality score (green / amber / red)."
              }
            />
          </h2>
          {filterSummary ? (
            <div className="text-xs text-gemma-subtle truncate" title={filterDescription}>
              {filterSummary}
            </div>
          ) : null}
          <div className="flex-1" />
          {expanded.size > 0 ? (
            <button onClick={() => setExpanded(new Set())} className="btn btn-ghost text-xs">
              Collapse all
            </button>
          ) : (
            <button
              onClick={() => setExpanded(new Set(list.map((d) => d.id)))}
              className="btn btn-ghost text-xs"
              disabled={list.length === 0}
            >
              Expand all
            </button>
          )}
        </div>

        <ResultsTable
          datasets={list}
          loading={datasets.isFetching}
          sort={sort}
          onSortChange={setSort}
          expanded={expanded}
          onToggleExpanded={toggleExpanded}
          selectedAnnotations={settings.annotations}
          selectedCategories={settings.categories}
          availableAnnotations={annotationList}
          onSelectTerm={(t) =>
            dispatch({ type: "setAnnotations", value: [...settings.annotations, t] })
          }
          onUnselectTerm={(t) =>
            dispatch({
              type: "setAnnotations",
              value: settings.annotations.filter(
                (x) => (x.termUri ?? x.termName) !== (t.termUri ?? t.termName),
              ),
            })
          }
        />

        <div className="relative flex items-center gap-3 px-3 h-12 border-t border-gemma-grid bg-white">
          <Pager
            page={page}
            pageSize={pageSize}
            total={total}
            pageSizeOptions={[25, 50, 100]}
            onChangePage={setPage}
            onChangePageSize={(s) => {
              setPageSize(s);
              setPage(1);
            }}
          />
          <div className="flex-1" />
          <div className="relative">
            <button
              onClick={() => setShowSnippet(!showSnippet)}
              className="btn"
              title="Show API code for this query"
            >
              <Code2 className="h-4 w-4" />
              <span>Download code</span>
              <ChevronUp className={`h-3.5 w-3.5 transition-transform ${showSnippet ? "" : "rotate-180"}`} />
            </button>
            {showSnippet ? (
              <div className="absolute bottom-full right-0 mb-2 z-20">
                <CodeSnippet browsing={browsing} total={total} />
              </div>
            ) : null}
          </div>
          <DownloadButton
            total={total}
            browsing={browsing}
            filterDescription={filterDescription}
          />
        </div>
      </section>
    </div>
  );
}

// Re-export the empty-settings helper so the route stub can use it.
export { emptySearchSettings };
