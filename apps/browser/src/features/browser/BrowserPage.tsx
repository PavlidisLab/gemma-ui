// The browser page — wires the side panel, results table, filter
// chips, paging, and the code-snippet / download actions.

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronUp, Code2 } from "lucide-react";
import { getMyself } from "@/api/endpoints";
import { HelpHint } from "@/features/shared/HelpHint";
import { fallbackTaxa } from "@/lib/gemmaConfig";
import { emptySearchSettings } from "@/lib/types";
import type { SearchSettings } from "@/lib/types";
import { generateFilter, generateFilterDescription, generateFilterSummary } from "@/lib/filter";
import {
  decodeSearchSettings,
  encodeSearchSettings,
  isEmptySettings,
} from "./shareLink";
import { SHOW_GEEQ } from "@/lib/geeq";
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
        categoryUri: url.categoryUri,
        categoryLabel: url.categoryLabel,
        annotationUri: url.annotationUri,
        annotationLabel: url.annotationLabel,
        shared: url.shared ? decodeSearchSettings(url.shared) ?? undefined : undefined,
      }),
  );

  const seededTaxonRef = useRef(false);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  // Seed sort from ``?sort=`` if present (e.g. the home page's
  // recent-activity "see all" lands with ``?sort=-lastUpdated``).
  // Default falls back
  // to the legacy "-id" so direct ``/browser`` navigation is
  // unchanged. Initial-only — user column-sorts don't write back.
  const [sort, setSort] = useState<string | undefined>(url.sort ?? "-id");
  // ``?updatedSince=YYYY-MM-DD`` (the home page's "N updated this
  // week" stat) ANDs one extra clause onto the generated filter. Held
  // in state, not read live off the URL, so the chip's × can drop it
  // without a navigation.
  const [updatedSince, setUpdatedSince] = useState(url.updatedSince);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [showSnippet, setShowSnippet] = useState(false);

  const me = useQuery({ queryKey: ["me"], queryFn: ({ signal }) => getMyself(signal) });
  const gid = me.data?.group;

  const filter = useMemo(() => {
    const f = generateFilter(settings);
    if (updatedSince) f.push([`lastUpdated > ${updatedSince}`]);
    return f;
  }, [settings, updatedSince]);

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
  // A selected category is never excluded from its own facet — see
  // CategoriesArgs.keepCategories. Sorted so the query key is stable
  // across re-orderings of the same selection.
  const keepCategories = useMemo(
    () =>
      settings.categories
        .map((c) => c.classUri)
        .filter((u): u is string => !!u)
        .sort(),
    [settings.categories],
  );

  const categories = useCategories({
    query: settings.query,
    filter,
    applyExclusions: !settings.ignoreExcludedTerms,
    keepCategories,
    gid,
  });

  // Fill in platforms that arrived as bare ids.
  //
  // A shared link and the platform page's "open in browser" both encode
  // platforms as ids only — `decodeSearchSettings` returns `[{id: 1}]`
  // and the selectors are supposed to match on id and supply the label.
  // They match, but nothing supplied the label: the filter chip read
  // "#1" and the side panel could not tell which technology group the
  // platform belonged to, so it couldn't open it either. Swap in the
  // full record once the facet list arrives.
  //
  // An id with no match is LEFT ALONE, not dropped — it is still a live
  // filter clause, and silently discarding it would change the results
  // the visitor was linked to.
  useEffect(() => {
    const list = platforms.data?.data;
    if (!list?.length) return;
    if (settings.platforms.length === 0) return;
    if (settings.platforms.every((p) => p.shortName || p.name)) return;
    const byId = new Map(list.map((p) => [p.id, p]));
    const hydrated = settings.platforms.map((p) =>
      p.shortName || p.name ? p : (byId.get(p.id) ?? p),
    );
    if (hydrated.some((p, i) => p !== settings.platforms[i])) {
      dispatch({ type: "setPlatforms", value: hydrated });
    }
  }, [platforms.data, settings.platforms]);

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
        categoryUri: url.categoryUri,
        categoryLabel: url.categoryLabel,
        annotationUri: url.annotationUri,
        annotationLabel: url.annotationLabel,
        shared: url.shared ? decodeSearchSettings(url.shared) ?? undefined : undefined,
      });
      dispatch({ type: "load", value: seeded });
      seededTaxonRef.current = true;
    }
  }, [
    url.query,
    url.initialTaxon,
    url.preset,
    url.categoryUri,
    url.categoryLabel,
    url.annotationUri,
    url.annotationLabel,
    taxa.data?.data,
  ]);

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
    // ``flex-1 min-h-0`` fills ``main``'s flex column (see
    // ``AppShell``) so the results table + pager occupy the full
    // viewport. ``h-full`` here was the previous shape; it relied on
    // ``main``'s height being explicit, which it wasn't, so the page
    // collapsed to content height and left empty space above the
    // footer. Per design review 2026-05-27.
    <div className="flex flex-1 min-h-0">
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
                (SHOW_GEEQ
                  ? "\nThe colored dot is the GEEQ quality score (green / amber / red)."
                  : "")
              }
            />
          </h2>
          {filterSummary ? (
            <div className="text-xs text-gemma-subtle truncate" title={filterDescription}>
              {filterSummary}
            </div>
          ) : null}
          {updatedSince ? (
            <span className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded border border-gemma-grid bg-surface-sunk text-gemma-ink shrink-0">
              Updated since {updatedSince}
              <button
                type="button"
                onClick={() => setUpdatedSince(undefined)}
                aria-label="Clear the updated-since filter"
                className="text-gemma-subtle hover:text-gemma-ink leading-none"
              >
                ×
              </button>
            </span>
          ) : null}
          <div className="flex-1" />
          <CopyLinkButton settings={settings} sort={sort} />
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

/**
 * "Copy link" — writes a URL that reproduces the current search and
 * filters.
 *
 * There isn't one to copy from the address bar: the Browser keeps
 * SearchSettings out of the URL on purpose, so that typing doesn't
 * navigate. This serialises the state on demand instead (see
 * shareLink.ts) and hands back a link that seeds it on arrival.
 *
 * `sort` rides along as its own param because it lives in page state
 * rather than in SearchSettings, and `?sort=` was already understood.
 */
function CopyLinkButton({
  settings,
  sort,
}: {
  settings: SearchSettings;
  sort?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const t = window.setTimeout(() => setState("idle"), 1800);
    return () => window.clearTimeout(t);
  }, [state]);

  async function copy() {
    const search: Record<string, string> = {};
    if (!isEmptySettings(settings)) search.s = encodeSearchSettings(settings);
    if (sort) search.sort = sort;
    // Build through the router, not by hand. `publicHref` carries the
    // basepath and `history.createHref` applies the active history's
    // shape — which under hash routing means /gemmaui/#/browser?s=…
    // A hand-rolled `origin + "/browser"` misses both: it was already
    // dropping the /gemmaui mount point before hash routing, so every
    // copied link 404'd.
    const built = router.buildLocation({ to: "/browser", search });
    const url = new URL(
      router.history.createHref(built.publicHref),
      window.location.origin,
    ).toString();
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      // Clipboard access can be refused (permissions, insecure origin).
      // Say so rather than pretending it worked.
      setState("failed");
    }
  }

  return (
    <button
      onClick={copy}
      className="btn btn-ghost text-xs"
      title="Copy a link that reproduces this search and its filters"
    >
      {state === "copied"
        ? "Link copied"
        : state === "failed"
          ? "Copy failed"
          : "Copy link"}
    </button>
  );
}

// Re-export the empty-settings helper so the route stub can use it.
export { emptySearchSettings };
