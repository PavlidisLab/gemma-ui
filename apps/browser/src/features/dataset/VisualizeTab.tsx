/**
 * Visualize-expression tab on the dataset detail page.
 *
 * Lets a visitor build a small custom gene set and render the
 * resulting expression heatmap, against THIS dataset. The gene set
 * is held on the client only — URL hash for shareability,
 * localStorage as session-restore — never on the server.
 *
 * v1 scope:
 *   • Pick genes by symbol (typeahead against /genes/search,
 *     scoped to the dataset's taxon).
 *   • Selected-genes chip strip with per-chip remove + Clear all.
 *   • Heatmap render via @gemma/heatmap fed by
 *     /datasets/{id}/heatmap-data?genes=… (wire shape adapted to
 *     the widget's HeatmapPayload shape).
 *   • GO-term mode is scaffolded but disabled — backend reverse
 *     lookup not yet shipped (filed in
 *     DATASET_VISUALIZE_GO_GENES_2026_05_25.md).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useQueries,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import {
  HeatmapWidget,
  buildGeneRowLabel,
  NONSPECIFIC_MARK,
  type HeatmapPayload,
} from "@gemma/heatmap";
import {
  searchGenes,
  searchGoTerms,
  annotationSearchMessage,
  getGoTermGenes,
  getOntologyTerm,
  toGoCurie,
  getHeatmapData,
  getDatasetQuantitationTypes,
  getDatasetPlatforms,
  type Gene,
  type HeatmapWireResponse,
} from "@/api/endpoints";
import type { AnnotationSearchResult } from "@/lib/types";
import type { Dataset, QuantitationType } from "@/lib/types";
import { useDebounced } from "@/lib/useDebounced";
import { taxonPathParam } from "@/lib/gemmaConfig";
import { ProbeRowTooltip } from "./ProbeRowTooltip";
import { restUrl } from "@/api/base";

const GENES_HASH_KEY = "genes";
const GO_HASH_KEY = "go";
const LS_PREFIX = "gemma-visualize-genes:";
const GO_LS_PREFIX = "gemma-visualize-go:";
const PICKER_MODE_LS_KEY = "gemma-visualize-picker-mode";
// Recent-query history is shared across datasets (it's the visitor's
// vocabulary, not dataset-bound). No per-dataset namespacing.
const RECENT_SYMBOL_QUERIES_LS_KEY = "gemma-visualize-recent-symbol-queries";
const RECENT_GO_TERMS_LS_KEY = "gemma-visualize-recent-go-terms";
const RECENT_CAP = 8;
// Row count for the preview when nothing is selected.
const RANDOM_SAMPLE_SIZE = 20;
/** Most genes one GO term may contribute.
 *
 *  A top-level GO node carries thousands, which is neither readable as
 *  heatmap rows nor a fetch worth making. This is also the page size
 *  ``/goTerms/{uri}/genes`` returns, so the cap costs nothing extra —
 *  it just says out loud what the endpoint was already doing, and the
 *  picker tells you when a term is over it so you can narrow. */
const GO_TERM_GENE_CAP = 100;

type PickerMode = "symbol" | "go";

/** Per-gene origin record — the GO term a gene is in the set BECAUSE
 *  of. Derived from the picked terms on every render, never stored:
 *  a term now carries its own genes, so persisting the same fact per
 *  gene would be a second copy to keep in step. */
type GeneOrigin = { goUri: string; goLabel: string };

/** A GO term held as a unit of the selection.
 *
 *  ``curie`` (``GO:0005840``) is the identity — short enough for the
 *  URL and the form ``/goTerms/{uri}/genes`` wants. ``label`` is for
 *  display only and may start empty: a shared link carries the curie
 *  alone, and the label is resolved from ``/annotations/term`` after
 *  the fact. */
type GoPick = { curie: string; label: string };
type RecentGoTerm = { valueUri: string | null; value: string };

/** Tailwind 500-shade qualitative ramp, mirrors the one used by the
 *  heatmap's categorical strips so origin discs read as members of
 *  the same colour family. */
const ORIGIN_PALETTE = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#f43f5e", // rose
  "#14b8a6", // teal
  "#6366f1", // indigo
  "#84cc16", // lime
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#d946ef", // fuchsia
  "#f97316", // orange
];

function colorForGoUri(uri: string): string {
  // FNV-1a 32-bit; deterministic + tiny.
  let h = 0x811c9dc5;
  for (let i = 0; i < uri.length; i++) {
    h ^= uri.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ORIGIN_PALETTE[(h >>> 0) % ORIGIN_PALETTE.length];
}

function readStickyPickerMode(): PickerMode {
  if (typeof window === "undefined") return "symbol";
  try {
    const raw = window.localStorage.getItem(PICKER_MODE_LS_KEY);
    return raw === "go" || raw === "symbol" ? raw : "symbol";
  } catch {
    return "symbol";
  }
}

function writeStickyPickerMode(mode: PickerMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PICKER_MODE_LS_KEY, mode);
  } catch {
    /* sandboxed env */
  }
}

export function VisualizeTab({
  dataset,
  isAdmin = false,
}: {
  dataset: Dataset;
  isAdmin?: boolean;
}) {
  const datasetId = dataset.id;
  // Admin-only: pick an alternate quantitation type to render instead
  // of the dataset's processed default. ``null`` = the processed QT
  // (param omitted). Kept in component state only — it's an admin
  // exploration knob, not part of the shareable ``#genes=…`` view.
  const [selectedQt, setSelectedQt] = useState<number | null>(null);
  // Admin-only: whether outlier-flagged assay columns are masked to NaN
  // (server default) or shown with their stored values. Most meaningful
  // paired with a non-processed QT above — for the processed QT the
  // server masks at creation time so the flag is usually a no-op.
  const [maskOutliers, setMaskOutliers] = useState(true);
  // Hard-scope all gene queries to this experiment's taxon.
  const taxon = taxonPathParam(dataset.taxon);

  // ── selected genes — client-only state, URL-hash + localStorage backed.
  // ``selectionHydrated`` flips true once the first-paint restore from
  // hash/localStorage has settled — the heatmap waits for it before
  // deciding whether to fall back to a random-gene preview, so a
  // direct visit to ``#genes=…`` doesn't flash a random heatmap first.
  const [selected, setSelected, selectionHydrated] = useGeneSelection(datasetId);
  // GO terms are held as terms and expanded here, so the heatmap's gene
  // list is the union of the loose picks above and every picked term's
  // members. Removing a term drops its genes in one click.
  const [goPicks, setGoPicks, goHydrated] = useGoSelection(datasetId);
  const { genes: termGenes, origins, loading: termGenesLoading } =
    useTermGenes(goPicks, taxon);
  const effectiveGenes = useMemo(() => {
    if (termGenes.length === 0) return selected;
    const out = [...selected];
    const have = new Set(selected.map((g) => g.id));
    for (const g of termGenes) if (!have.has(g.id)) out.push(g);
    return out;
  }, [selected, termGenes]);
  // The heatmap falls back to a random preview when it sees an empty
  // gene list, so it must not look until BOTH restores have settled and
  // any term expansion has landed — otherwise a shared ``#go=`` link
  // flashes 20 random genes first.
  const hydrated = selectionHydrated && goHydrated && !termGenesLoading;
  const [mode, setModeState] = useState<PickerMode>(readStickyPickerMode);
  // Search query shared across modes so toggling symbol↔GO doesn't
  // wipe what the visitor typed.
  const [query, setQuery] = useState("");
  const setMode = (m: PickerMode) => {
    setModeState(m);
    writeStickyPickerMode(m);
  };
  // Recent histories — global to the session, not dataset-bound.
  const [recentSymbolQueries, pushRecentSymbolQuery, clearRecentSymbolQueries] =
    useRecentList<string>(RECENT_SYMBOL_QUERIES_LS_KEY);
  const [recentGoTerms, pushRecentGoTerm, clearRecentGoTerms] =
    useRecentList<RecentGoTerm>(RECENT_GO_TERMS_LS_KEY);

  const modeToggle = <PickerModeTabs mode={mode} onChange={setMode} />;

  const addMany = (genes: Gene[]) =>
    setSelected((cur) => {
      const have = new Set(cur.map((g) => g.id));
      const next = [...cur];
      for (const g of genes) if (!have.has(g.id)) next.push(g);
      return next;
    });

  const addTerm = (t: { valueUri: string | null; value: string }) => {
    if (!t.valueUri) return;
    const curie = toGoCurie(t.valueUri);
    setGoPicks((cur) =>
      cur.some((p) => p.curie === curie)
        ? cur
        : [...cur, { curie, label: t.value }],
    );
  };

  return (
    <div className="lg:flex lg:items-start lg:gap-4 space-y-4 lg:space-y-0">
      {/* Picker — 1/3 width on lg+, full width on small. Heatmap renders
          alongside on the right. */}
      <section className="bg-white border border-slate-200 rounded lg:w-1/3 lg:shrink-0">
        <header className="px-4 py-2 border-b border-slate-200">
          <h2 className="text-sm font-semibold tracking-wide">
            Visualise expression
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Build a custom gene set and render the heatmap. Selection is
            held in the URL — share the link to share the view.
          </p>
        </header>
        <div className="px-4 py-3">
          {mode === "symbol" ? (
            <GenePickerBySymbol
              taxon={taxon}
              alreadySelected={selected.map((g) => g.id)}
              modeToggle={modeToggle}
              query={query}
              setQuery={setQuery}
              recentQueries={recentSymbolQueries}
              onClearRecent={clearRecentSymbolQueries}
              onAdd={(gene) => {
                if (query.trim()) pushRecentSymbolQuery(query.trim());
                setSelected((cur) =>
                  cur.some((g) => g.id === gene.id) ? cur : [...cur, gene],
                );
              }}
              onAddMany={(g) => {
                if (query.trim()) pushRecentSymbolQuery(query.trim());
                addMany(g);
              }}
            />
          ) : (
            <GenePickerByGo
              taxon={taxon}
              alreadySelected={effectiveGenes.map((g) => g.id)}
              modeToggle={modeToggle}
              query={query}
              setQuery={setQuery}
              recentTerms={recentGoTerms}
              onPickTerm={(t) =>
                pushRecentGoTerm({ valueUri: t.valueUri, value: t.value })
              }
              onClearRecent={clearRecentGoTerms}
              onAdd={(gene) =>
                setSelected((cur) =>
                  cur.some((g) => g.id === gene.id) ? cur : [...cur, gene],
                )
              }
              onAddTerm={addTerm}
              pickedTermCuries={goPicks.map((p) => p.curie)}
            />
          )}
        </div>
        <SelectedGenesStrip
          genes={selected}
          terms={goPicks}
          termGenes={termGenes}
          origins={origins}
          onRemove={(id) =>
            setSelected((cur) => cur.filter((g) => g.id !== id))
          }
          onRemoveTerm={(curie) =>
            setGoPicks((cur) => cur.filter((p) => p.curie !== curie))
          }
          onClear={() => {
            setSelected(() => []);
            setGoPicks(() => []);
          }}
        />
      </section>

      {/* Heatmap render — right of the form on lg+, below on small. */}
      <div className="lg:flex-1 lg:min-w-0 space-y-2">
        {isAdmin ? (
          <QuantitationTypePicker
            datasetId={datasetId}
            selectedQt={selectedQt}
            onChange={setSelectedQt}
            maskOutliers={maskOutliers}
            onMaskOutliersChange={setMaskOutliers}
          />
        ) : null}
        <HeatmapPanel
          datasetId={datasetId}
          genes={effectiveGenes}
          origins={origins}
          selectionHydrated={hydrated}
          quantitationType={selectedQt}
          maskOutliers={maskOutliers}
        />
      </div>
    </div>
  );
}

// ─── Picker mode tabs ─────────────────────────────────────────────────────────

function PickerModeTabs({
  mode,
  onChange,
}: {
  mode: PickerMode;
  onChange: (m: PickerMode) => void;
}) {
  return (
    <div className="inline-flex border border-slate-300 rounded overflow-hidden text-xs">
      <ModeButton active={mode === "symbol"} onClick={() => onChange("symbol")}>
        By symbol
      </ModeButton>
      <ModeButton active={mode === "go"} onClick={() => onChange("go")}>
        By GO term
      </ModeButton>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "px-2.5 py-1 transition-colors " +
        (active
          ? "bg-slate-900 text-white"
          : "bg-white text-slate-700 hover:bg-slate-100")
      }
    >
      {children}
    </button>
  );
}

// ─── Symbol picker — typeahead /genes/search ─────────────────────────────────

function GenePickerBySymbol({
  taxon,
  alreadySelected,
  modeToggle,
  query,
  setQuery,
  recentQueries,
  onClearRecent,
  onAdd,
  onAddMany,
}: {
  taxon: string | undefined;
  alreadySelected: number[];
  modeToggle: React.ReactNode;
  query: string;
  setQuery: (q: string) => void;
  recentQueries: string[];
  onClearRecent: () => void;
  onAdd: (gene: Gene) => void;
  onAddMany: (genes: Gene[]) => void;
}) {
  const debounced = useDebounced(query, 150);
  const trimmed = debounced.trim();

  const results = useQuery({
    queryKey: ["gene-search", trimmed, taxon ?? ""],
    queryFn: ({ signal }) =>
      searchGenes(trimmed, { taxon, limit: 20, signal }),
    enabled: trimmed.length >= 2,
    staleTime: 5 * 60_000,
  });

  const already = useMemo(
    () => new Set(alreadySelected),
    [alreadySelected],
  );

  // Hard-filter to the dataset's taxon client-side. The server takes
  // a ``taxon`` query param but currently mixes in other-organism hits
  // anyway; without this guard, the picker offers e.g. human + rat
  // genes on a mouse dataset, and selecting one of them crashes the
  // heatmap fetch downstream (the dataset has no probes for them).
  const taxonNeedle = taxon?.toLowerCase() ?? null;
  const candidates = (results.data ?? []).filter((g) => {
    if (already.has(g.id)) return false;
    if (!taxonNeedle) return true;
    const c = g.taxon?.commonName?.toLowerCase() ?? null;
    const s = g.taxon?.scientificName?.toLowerCase() ?? null;
    return c === taxonNeedle || s === taxonNeedle;
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <label className="block flex-1 min-w-0">
          <span className="block text-[11px] text-slate-500 mb-1">
            Search by gene symbol or alias
            {taxon ? (
              <span className="ml-1.5 text-slate-400">— {taxon} only</span>
            ) : null}
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="BRCA1, TP53, MYC…"
            className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
        </label>
        {modeToggle}
      </div>
      {trimmed.length < 2 && recentQueries.length > 0 ? (
        <RecentRow
          label="recent"
          onClear={onClearRecent}
        >
          {recentQueries.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setQuery(q)}
              className="text-[11px] px-2 py-0.5 border border-slate-200 bg-slate-50 rounded hover:bg-slate-900 hover:text-white hover:border-slate-900"
            >
              {q}
            </button>
          ))}
        </RecentRow>
      ) : null}
      {trimmed.length >= 2 ? (
        <>
          {candidates.length > 1 ? (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => onAddMany(candidates)}
                className="text-[11px] px-2 py-0.5 border border-slate-300 rounded whitespace-nowrap hover:bg-slate-900 hover:text-white hover:border-slate-900"
              >
                + add all {candidates.length}
              </button>
            </div>
          ) : null}
          <div className="border border-slate-200 rounded max-h-64 overflow-y-auto">
          {results.isFetching ? (
            <div className="px-3 py-2 text-xs text-slate-500 italic">
              searching…
            </div>
          ) : candidates.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-500 italic">
              no matches
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {candidates.map((g) => (
                <li
                  key={g.id}
                  className="px-2.5 py-1 flex items-baseline justify-between gap-2 hover:bg-slate-50"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-mono font-semibold text-xs text-slate-900">
                      {g.officialSymbol ?? `#${g.id}`}
                    </span>
                    {g.officialName ? (
                      <span className="ml-2 text-[11px] text-slate-500">
                        {g.officialName}
                      </span>
                    ) : null}
                    {g.taxon?.commonName ? (
                      <span className="ml-2 text-[10px] text-slate-400">
                        {g.taxon.commonName}
                      </span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      // Don't clear the query — keep the dropdown open
                      // so the visitor can add more matches from the
                      // same search.
                      onAdd(g);
                    }}
                    className="text-[11px] px-2 py-0.5 border border-slate-300 rounded whitespace-nowrap shrink-0 hover:bg-slate-900 hover:text-white hover:border-slate-900"
                  >
                    + add
                  </button>
                </li>
              ))}
            </ul>
          )}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ─── GO-term picker — typeahead → browse genes → individual add ─────────────

/**
 * Two-stage picker:
 *   1. Type a fragment of a GO term name. Typeahead against
 *      ``/annotations/search?prefixes=GO_`` returns ranked GO
 *      matches.
 *   2. Pick a GO term. The picker fetches its annotated genes from
 *      ``/goTerms/{uri}/genes`` (taxon-scoped to the dataset, capped
 *      at {@link GO_TERM_GENE_CAP}) and shows them as a scrollable
 *      browsable list.
 *
 * Two ways out of that list, and they mean different things:
 *   - **Add the term** — the whole term joins the selection as ONE
 *     unit. It is what the URL carries and what a single × removes.
 *   - **+add on a gene** — that gene alone joins, loose, with no tie
 *     back to the term. Use it to borrow a few members without
 *     taking the set.
 *
 * A term over the cap is not addable; the picker says how many it has
 * and asks for a more specific term, because neither the fetch nor the
 * heatmap does anything useful with four thousand rows.
 */
function GenePickerByGo({
  taxon,
  alreadySelected,
  modeToggle,
  query,
  setQuery,
  recentTerms,
  onPickTerm,
  onClearRecent,
  onAdd,
  onAddTerm,
  pickedTermCuries,
}: {
  taxon: string | undefined;
  alreadySelected: number[];
  modeToggle: React.ReactNode;
  query: string;
  setQuery: (q: string) => void;
  recentTerms: RecentGoTerm[];
  onPickTerm: (t: { valueUri: string | null; value: string }) => void;
  onClearRecent: () => void;
  onAdd: (gene: Gene) => void;
  onAddTerm: (t: { valueUri: string | null; value: string }) => void;
  /** Curies already in the selection — the add-term button becomes a
   *  standing "added" marker rather than offering the same term twice. */
  pickedTermCuries: string[];
}) {
  const termQuery = query;
  const setTermQuery = setQuery;
  const [pickedTerm, setPickedTerm] = useState<AnnotationSearchResult | null>(
    null,
  );
  const debouncedTermQuery = useDebounced(termQuery, 150);
  const trimmedTermQuery = debouncedTermQuery.trim();

  // Phase 1: GO-term typeahead.
  const termsQ = useQuery({
    queryKey: ["go-term-search", trimmedTermQuery],
    queryFn: ({ signal }) =>
      searchGoTerms(trimmedTermQuery, { limit: 15, signal }),
    enabled: !pickedTerm && trimmedTermQuery.length >= 2,
    staleTime: 5 * 60_000,
  });

  // Phase 2: genes under the picked term.
  const genesQ = useQuery({
    queryKey: [
      "go-term-genes",
      pickedTerm?.valueUri ?? "",
      taxon ?? "",
    ],
    queryFn: ({ signal }) =>
      pickedTerm?.valueUri
        ? getGoTermGenes(pickedTerm.valueUri, {
            taxon,
            limit: 100,
            signal,
          })
        : Promise.resolve(null),
    enabled: !!pickedTerm?.valueUri,
    staleTime: 5 * 60_000,
  });

  const already = useMemo(() => new Set(alreadySelected), [alreadySelected]);

  // ── Phase 1 UI: term not yet picked.
  if (!pickedTerm) {
    const matches = termsQ.data ?? [];
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-end gap-2">
          <label className="block flex-1 min-w-0">
            <span className="block text-[11px] text-slate-500 mb-1">
              Search a GO term
              {taxon ? (
                <span className="ml-1.5 text-slate-400">
                  — genes scoped to {taxon}
                </span>
              ) : null}
            </span>
            <input
              type="search"
              value={termQuery}
              onChange={(e) => setTermQuery(e.target.value)}
              placeholder="apoptosis, cell cycle, immune response…"
              className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            />
          </label>
          {modeToggle}
        </div>
        {trimmedTermQuery.length < 2 && recentTerms.length > 0 ? (
          <RecentRow label="recent terms" onClear={onClearRecent}>
            {recentTerms.map((t) => (
              <button
                key={t.valueUri ?? t.value}
                type="button"
                onClick={() => {
                  // Synthesize an AnnotationSearchResult-shaped object
                  // — the picker only consumes value / valueUri so the
                  // other fields stay undefined.
                  setPickedTerm({
                    value: t.value,
                    valueUri: t.valueUri,
                  } as AnnotationSearchResult);
                  onPickTerm(t);
                }}
                className="text-[11px] px-2 py-0.5 border border-slate-200 bg-slate-50 rounded hover:bg-slate-900 hover:text-white hover:border-slate-900"
                title={t.valueUri ?? undefined}
              >
                {t.value}
              </button>
            ))}
          </RecentRow>
        ) : null}
        {trimmedTermQuery.length >= 2 ? (
          <div className="border border-slate-200 rounded max-h-64 overflow-y-auto">
            {termsQ.isFetching ? (
              <div className="px-3 py-2 text-xs text-slate-500 italic">
                searching GO terms…
              </div>
            ) : termsQ.isError ? (
              /* Ahead of "no GO terms match": a search that failed has
                 not established that the term is absent. */
              <div className="px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                {annotationSearchMessage(termsQ.error, trimmedTermQuery)}
              </div>
            ) : matches.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-500 italic">
                no GO terms match
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {matches.map((t) => (
                  <li
                    key={t.valueUri ?? t.value}
                    className="px-2.5 py-1 hover:bg-slate-50"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setPickedTerm(t);
                        onPickTerm({
                          valueUri: t.valueUri,
                          value: t.value,
                        });
                      }}
                      className="w-full flex items-baseline justify-between gap-2 text-left"
                    >
                      <span className="min-w-0 truncate">
                        <span className="font-medium text-xs text-slate-900">
                          {t.value}
                        </span>
                        {t.valueUri ? (
                          <span className="ml-2 text-[10px] font-mono text-slate-400">
                            {shortenGoUri(t.valueUri)}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-[11px] text-blue-700 shrink-0 whitespace-nowrap">
                        browse →
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  // ── Phase 2 UI: term picked, browsing genes.
  const page = genesQ.data;
  const total = page?.totalElements ?? 0;
  const shown = page?.data ?? [];
  // Cap on the TERM's own size, not on what came back in this page —
  // a term with 4,000 genes is over the limit even though the endpoint
  // hands us 100 of them.
  const overCap = total > GO_TERM_GENE_CAP;
  const alreadyPicked =
    !!pickedTerm.valueUri &&
    pickedTermCuries.includes(toGoCurie(pickedTerm.valueUri));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">
            GO term
          </div>
          <div className="text-sm font-medium text-slate-900 truncate">
            {pickedTerm.value}
          </div>
          {pickedTerm.valueUri ? (
            <a
              href={pickedTerm.valueUri}
              target="_blank"
              rel="noreferrer"
              className="text-[10px] font-mono text-slate-400 hover:text-blue-700 hover:underline"
            >
              {shortenGoUri(pickedTerm.valueUri)} ↗
            </a>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {modeToggle}
          <button
            type="button"
            onClick={() => {
              setPickedTerm(null);
              setTermQuery("");
            }}
            className="text-xs text-slate-500 hover:text-slate-900 hover:underline"
          >
            ← pick a different term
          </button>
        </div>
      </div>
      {genesQ.isLoading ? (
        <div className="border border-slate-200 rounded px-3 py-3 text-xs text-slate-500 italic">
          loading genes for this term…
        </div>
      ) : !page ? (
        <div className="border border-slate-200 rounded px-3 py-3 text-xs text-slate-500 italic">
          No gene-list returned for this term. Either the dataset's taxon
          has no genes annotated here, or the GO ontology isn't loaded
          on this Gemma instance.
        </div>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <p className="text-[11px] text-slate-500 leading-snug min-w-0">
              <strong className="text-slate-700">
                {total.toLocaleString()}
              </strong>{" "}
              {total === 1 ? "gene" : "genes"} annotated{taxon ? ` in ${taxon}` : ""}.
              {overCap ? (
                <>
                  {" "}
                  Over the {GO_TERM_GENE_CAP}-gene limit for one term —
                  pick a more specific term, or add genes individually
                  from the first {shown.length} below.
                </>
              ) : null}
            </p>
            {alreadyPicked ? (
              <span className="text-[11px] px-2 py-0.5 border border-sky-300 bg-sky-50 text-sky-800 rounded whitespace-nowrap shrink-0">
                term added
              </span>
            ) : overCap ? null : (
              <button
                type="button"
                onClick={() =>
                  onAddTerm({
                    valueUri: pickedTerm.valueUri,
                    value: pickedTerm.value,
                  })
                }
                className="text-[11px] px-2 py-0.5 border border-slate-300 rounded whitespace-nowrap hover:bg-slate-900 hover:text-white hover:border-slate-900 shrink-0"
                title="Add this term as one unit — one chip, one click to remove"
              >
                + add term ({total.toLocaleString()})
              </button>
            )}
          </div>
          <div className="border border-slate-200 rounded max-h-72 overflow-y-auto">
            <ul className="divide-y divide-slate-100">
              {shown.map((g) => {
                const isSelected = already.has(g.id);
                return (
                  <li
                    key={g.id}
                    className="px-2.5 py-1 flex items-baseline justify-between gap-2 hover:bg-slate-50"
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-mono font-semibold text-xs text-slate-900">
                        {g.officialSymbol ?? `#${g.id}`}
                      </span>
                      {g.officialName ? (
                        <span className="ml-2 text-[11px] text-slate-500">
                          {g.officialName}
                        </span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      disabled={isSelected}
                      // Loose, not tied to the term: taking one member
                      // is not taking the set, and the set is now its
                      // own chip.
                      onClick={() => onAdd(g)}
                      className={
                        "text-[11px] px-2 py-0.5 border rounded whitespace-nowrap shrink-0 " +
                        (isSelected
                          ? "border-slate-200 text-slate-400 cursor-default"
                          : "border-slate-300 hover:bg-slate-900 hover:text-white hover:border-slate-900")
                      }
                    >
                      {isSelected ? "✓ added" : "+ add"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

/** Render ``http://purl.obolibrary.org/obo/GO_0006915`` as
 *  ``GO:0006915`` for compact display. */
function shortenGoUri(uri: string): string {
  const m = uri.match(/GO_(\d+)/);
  return m ? `GO:${m[1]}` : uri;
}

// ─── Selected gene chips ─────────────────────────────────────────────────────

function SelectedGenesStrip({
  genes,
  terms,
  termGenes,
  origins,
  onRemove,
  onRemoveTerm,
  onClear,
}: {
  genes: Gene[];
  /** GO terms held as units — one chip each, removable in one click. */
  terms: GoPick[];
  /** Every gene the picked terms expanded to, for the per-term count
   *  and the ▾ list. Keyed back to its term through `origins`. */
  termGenes: Gene[];
  origins: Record<number, GeneOrigin>;
  onRemove: (id: number) => void;
  onRemoveTerm: (curie: string) => void;
  onClear: () => void;
}) {
  // When the strip would render more chips than this, collapse to
  // a "+N more" affordance and let the visitor expand on click.
  // Beyond ~50 the strip dominates the viewport and the heatmap
  // becomes the source of truth for gene identity anyway.
  const COLLAPSE_THRESHOLD = 15;
  const [expanded, setExpanded] = useState(false);
  // Which term chip has its gene list open. One at a time — two open
  // lists push the heatmap off the screen on a laptop.
  const [openTerm, setOpenTerm] = useState<string | null>(null);
  if (genes.length === 0 && terms.length === 0) return null;
  const genesOfTerm = (curie: string) =>
    termGenes.filter((g) => origins[g.id]?.goUri === curie);
  const total = genes.length + termGenes.length;
  const visible =
    expanded || genes.length <= COLLAPSE_THRESHOLD
      ? genes
      : genes.slice(0, COLLAPSE_THRESHOLD);
  const hiddenCount = genes.length - visible.length;
  return (
    <div className="border-t border-slate-200 px-4 py-2 flex items-center gap-2 flex-wrap">
      <span className="text-[10px] uppercase tracking-wide text-slate-500 mr-1">
        {total} {total === 1 ? "gene" : "genes"}
      </span>
      {/* Term chips lead: they are the bigger unit, and a reader
          scanning the strip should see "the ribosome set plus two
          genes", not hunt for the term among its own members. */}
      {terms.map((t) => {
        const members = genesOfTerm(t.curie);
        const isOpen = openTerm === t.curie;
        return (
          <span key={t.curie} className="inline-flex flex-col">
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-sky-50 border border-sky-300 rounded"
              title={t.curie}
            >
              <span
                aria-hidden
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: colorForGoUri(t.curie) }}
              />
              <span className="font-semibold text-slate-900">
                {t.label || t.curie}
              </span>
              <span className="text-slate-500">
                · {members.length} {members.length === 1 ? "gene" : "genes"}
              </span>
              <button
                type="button"
                onClick={() => setOpenTerm(isOpen ? null : t.curie)}
                aria-label={`${isOpen ? "hide" : "show"} genes in ${t.label || t.curie}`}
                className="text-slate-400 hover:text-slate-900"
              >
                {isOpen ? "▴" : "▾"}
              </button>
              <button
                type="button"
                onClick={() => onRemoveTerm(t.curie)}
                aria-label={`remove ${t.label || t.curie}`}
                className="text-slate-400 hover:text-rose-600"
              >
                ×
              </button>
            </span>
            {isOpen ? (
              <span className="mt-1 max-w-[22rem] max-h-32 overflow-y-auto rounded border border-slate-200 bg-white px-2 py-1 text-[11px] leading-relaxed text-slate-600">
                {members.length === 0
                  ? "no genes for this term in this taxon"
                  : members
                      .map((g) => g.officialSymbol ?? `#${g.id}`)
                      .join(", ")}
              </span>
            ) : null}
          </span>
        );
      })}
      {visible.map((g) => (
        <span
          key={g.id}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-slate-100 border border-slate-300 rounded"
        >
          <span className="font-mono font-semibold text-slate-900">
            {g.officialSymbol ?? `#${g.id}`}
          </span>
          <button
            type="button"
            onClick={() => onRemove(g.id)}
            aria-label={`remove ${g.officialSymbol ?? g.id}`}
            className="text-slate-400 hover:text-rose-600"
          >
            ×
          </button>
        </span>
      ))}
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="px-2 py-0.5 text-[11px] text-slate-600 border border-slate-300 rounded hover:bg-slate-100"
        >
          +{hiddenCount} more
        </button>
      ) : null}
      {expanded && genes.length > COLLAPSE_THRESHOLD ? (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="px-2 py-0.5 text-[11px] text-slate-600 border border-slate-300 rounded hover:bg-slate-100"
        >
          collapse
        </button>
      ) : null}
      <button
        type="button"
        onClick={onClear}
        className="ml-2 text-[11px] text-slate-500 hover:text-slate-900 hover:underline"
      >
        Clear all
      </button>
    </div>
  );
}

// ─── Heatmap panel ───────────────────────────────────────────────────────────

function HeatmapPanel({
  datasetId,
  genes,
  origins,
  selectionHydrated,
  quantitationType = null,
  maskOutliers = true,
}: {
  datasetId: number;
  genes: Gene[];
  origins: Record<number, GeneOrigin>;
  selectionHydrated: boolean;
  /** Admin-selected alternate QT id; ``null`` ⇒ processed default
   *  (param omitted so the server picks the processed QT). */
  quantitationType?: number | null;
  /** Admin outlier-masking toggle; ``true`` (default) matches the
   *  server default so the param is omitted. */
  maskOutliers?: boolean;
}) {
  const geneIds = useMemo(() => genes.map((g) => g.id), [genes]);
  // The searched-for set, for telling a row's queried genes apart from
  // the ones its probe happens to co-hybridise with. Empty in sample
  // mode — there's no query to be specific to.
  const queried = useMemo(() => new Set(geneIds), [geneIds]);
  // if nothing is selected use random genes
  const isSample = geneIds.length === 0;
  // Reroll counter for the random preview. It is part of the query key
  // rather than a `refetch()` because the server draws a fresh sample
  // on every call — a new key is a new sample, and the previous roll
  // stays in cache if the reader steps back to it. Only reachable
  // while `isSample`; picking genes takes the control away with the
  // preview it belongs to.
  const [sampleRoll, setSampleRoll] = useState(0);
  const wireQuery = useQuery({
    // ``quantitationType ?? "default"`` in the key so switching QTs
    // (including back to the processed default) refetches rather than
    // serving a stale matrix from another QT.
    queryKey: isSample
      ? ["heatmap-data-sample", datasetId, RANDOM_SAMPLE_SIZE, quantitationType ?? "default", maskOutliers, sampleRoll]
      : ["heatmap-data", datasetId, geneIds.join(","), quantitationType ?? "default", maskOutliers],
    queryFn: ({ signal }) =>
      getHeatmapData(
        datasetId,
        {
          ...(isSample ? { sampleSize: RANDOM_SAMPLE_SIZE } : { genes: geneIds }),
          ...(quantitationType != null ? { quantitationType } : {}),
          ...(maskOutliers ? {} : { maskOutliers: false }),
        },
        signal,
      ),
    // Wait for the selection restore to settle before firing — avoids a
    // throwaway random-sample fetch on a direct ``#genes=…`` visit.
    enabled: selectionHydrated,
    staleTime: 60_000,
    // Hold the previous matrix on screen while the next one loads.
    // Without it every key change — a reroll, a gene added — drops
    // through the `isPending` branch below and replaces the heatmap
    // with the loading line, which for a reroll also takes away the
    // button that was just clicked.
    placeholderData: keepPreviousData,
  });

  // A probe is addressable only as platform + element. One platform ⇒
  // every row's design element is on it; several ⇒ the payload doesn't
  // say which, so the tooltip names the probe without linking it.
  const platformsQ = useQuery({
    queryKey: ["datasetPlatforms", datasetId],
    queryFn: ({ signal }) => getDatasetPlatforms(datasetId, signal),
    staleTime: 30 * 60_000,
  });
  const platformShortName =
    platformsQ.data?.length === 1
      ? (platformsQ.data[0].shortName ?? undefined)
      : undefined;

  if (!selectionHydrated || wireQuery.isLoading || wireQuery.isPending) {
    return (
      <div className="bg-white border border-slate-200 rounded px-6 py-10 text-center text-sm text-slate-500">
        loading expression matrix…
      </div>
    );
  }
  const wire = wireQuery.data;
  if (!wire || !wire.rows || wire.rows.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded px-6 py-10 text-center text-sm text-slate-500">
        {isSample
          ? "No expression data available to preview for this dataset."
          : `No expression data returned for the selected genes on this dataset.
             Either the platform doesn't carry probes for these genes, or the
             backend ACL is filtering them.`}
      </div>
    );
  }

  const payload = adaptHeatmapWire(wire, origins, queried);
  // Row-label pop-up — shared with the diagnostics heatmap so a probe
  // reads the same way on both. Genes come off the wire row rather
  // than the payload's parallel arrays: same order, but the tooltip
  // wants whole gene objects.
  const rowLabelTooltip = (i: number) => {
    const r = payload.rows[i];
    const wireRow = wire.rows[i];
    if (!r || !wireRow) return null;
    return (
      <ProbeRowTooltip
        designElementName={r.designElementName}
        designElementId={r.designElementId}
        genes={wireRow.genes ?? []}
        platformShortName={platformShortName}
        queried={queried}
      />
    );
  };
  // Drives the standing key below the heatmap.
  const anyMarked = payload.rows.some((r) =>
    r.labelSymbol?.endsWith(NONSPECIFIC_MARK),
  );
  const anyJoined = payload.rows.some((r) => r.labelSymbol?.includes(";"));
  return (
    <div className="space-y-2">
      {isSample ? (
        <p className="text-[11px] text-slate-500 px-1 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSampleRoll((n) => n + 1)}
            disabled={wireQuery.isFetching}
            className="text-sm leading-none text-slate-500 hover:text-slate-900 disabled:opacity-40 disabled:cursor-default cursor-pointer"
            title="Draw a different random sample of genes"
            aria-label="Draw a different random sample of genes"
          >
            ↻
          </button>
          <span>
            Showing a random sample of {wire.rows.length}{" "}
            {wire.rows.length === 1 ? "gene" : "genes"} from this dataset.
            Search and add genes on the left to build your own set.
          </span>
        </p>
      ) : null}
      <div className="bg-slate-50 border border-slate-200 rounded p-2">
        <HeatmapWidget
          payload={payload}
          rowLabelGutterWidth={260}
          rowLabelTooltip={rowLabelTooltip}
          // A gene set has no order of its own — a GO term's members
          // arrive alphabetically, a symbol search in the order it was
          // typed — so cluster by default and let co-expressed genes
          // land together. Switchable (including off) in Options.
          defaultRowOrder="cluster"
        />
      </div>
      {/* Standing key for the gutter's multi-gene notation, so it reads
          without a hover. Only rendered when some row actually uses it. */}
      {anyMarked || anyJoined ? (
        <p className="text-[11px] text-slate-500 px-1">
          {anyMarked ? (
            <>
              <span className="font-mono">{NONSPECIFIC_MARK}</span> = the probe
              also measures genes you didn’t search for, so the row isn’t
              specific to your selection.{" "}
            </>
          ) : null}
          {anyJoined ? (
            <>
              A row naming several genes (<span className="font-mono">A;B</span>)
              matched more than one of your genes on a single probe.{" "}
            </>
          ) : null}
          Hover a row label for the full probe→gene mapping.
        </p>
      ) : null}
    </div>
  );
}

// ─── Quantitation-type picker (admin-only) ───────────────────────────────────

/** Compact one-line descriptor for a QT option — scale / type plus the
 *  preferred marker, so the admin can tell raw from processed at a glance
 *  inside the flat ``<option>`` list. */
function qtOptionLabel(qt: QuantitationType): string {
  const bits = [qt.scale, qt.type].filter(Boolean).join(" · ");
  const pref = qt.isPreferred || qt.isMaskedPreferred ? " ★" : "";
  const name = qt.name ?? `QT ${qt.id}`;
  return bits ? `${name} — ${bits}${pref}` : `${name}${pref}`;
}

/**
 * Admin-only render controls for the heatmap: which quantitation type
 * to render, plus whether outlier assay columns are masked. The
 * dataset's processed QT is the default (``null`` → param omitted
 * server-side); every other QT on the dataset is served from its raw
 * vectors. Mirrors the QT list surfaced on the admin-only Quantitation
 * Types tab, reusing ``getDatasetQuantitationTypes``. The mask-outliers
 * checkbox pairs with the QT choice — it's always effective on a
 * non-processed QT and usually a no-op on the processed one.
 */
function QuantitationTypePicker({
  datasetId,
  selectedQt,
  onChange,
  maskOutliers,
  onMaskOutliersChange,
}: {
  datasetId: number;
  selectedQt: number | null;
  onChange: (qtId: number | null) => void;
  maskOutliers: boolean;
  onMaskOutliersChange: (mask: boolean) => void;
}) {
  const q = useQuery({
    queryKey: ["datasetQuantitationTypes", datasetId],
    queryFn: ({ signal }) => getDatasetQuantitationTypes(datasetId, signal),
    staleTime: 5 * 60_000,
  });
  const qts = q.data ?? [];

  return (
    <div className="bg-white border border-slate-200 rounded px-3 py-2 flex items-center gap-2 flex-wrap">
      <span className="text-[10px] uppercase tracking-wide font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
        admin
      </span>
      <label className="flex items-center gap-2 text-xs text-slate-600 min-w-0">
        <span className="shrink-0">Quantitation type</span>
        <select
          className="min-w-0 max-w-[22rem] px-2 py-1 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          value={selectedQt ?? ""}
          disabled={q.isLoading || q.isError}
          onChange={(e) =>
            onChange(e.target.value === "" ? null : Number(e.target.value))
          }
        >
          <option value="">Processed (default)</option>
          {qts.map((qt) => (
            <option key={qt.id} value={qt.id}>
              {qtOptionLabel(qt)}
            </option>
          ))}
        </select>
      </label>
      {q.isLoading ? (
        <span className="text-[11px] text-slate-400 italic">loading types…</span>
      ) : q.isError ? (
        <span className="text-[11px] text-rose-600">couldn’t load quantitation types</span>
      ) : selectedQt != null ? (
        <span className="text-[11px] text-slate-400">
          served from raw vectors
        </span>
      ) : null}
      <label
        className="flex items-center gap-1.5 text-xs text-slate-600 ml-auto shrink-0"
        title={
          "When on (default), assay columns flagged as outliers are masked out. " +
          "Turn off to render their stored expression values instead. Most " +
          "meaningful with a non-processed QT — the processed QT is already " +
          "masked at creation time."
        }
      >
        <input
          type="checkbox"
          className="accent-blue-600"
          checked={maskOutliers}
          onChange={(e) => onMaskOutliersChange(e.target.checked)}
        />
        <span>Mask outliers</span>
      </label>
    </div>
  );
}

// ─── Wire-to-HeatmapPayload adapter ──────────────────────────────────────────

/** Coerce one wire matrix cell to ``number | null``.
 *
 *  Gemma's REST serializer emits a missing/undefined expression cell
 *  as the JSON **string** ``"NaN"`` (Jackson writing ``Double.NaN`` as
 *  a quoted token), not as ``null`` and not as a bare NaN. The widget
 *  treats ``null`` as "missing" everywhere, but its guards are
 *  ``v == null || Number.isNaN(v)`` — and ``Number.isNaN("NaN")`` is
 *  false, so the string slips through and poisons row-standardization
 *  + renders as a NaN cell. Normalise it to ``null`` here, the single
 *  wire→widget seam. Null-check first: ``Number(null) === 0`` would
 *  otherwise turn genuinely-missing cells into zeros. */
function toCell(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function adaptHeatmapWire(
  wire: HeatmapWireResponse,
  origins: Record<number, GeneOrigin> = {},
  queried: Set<number> = new Set(),
): HeatmapPayload {
  return {
    datasetId: wire.datasetId,
    matrix: {
      values: wire.matrix.values.map((row) => row.map(toCell)),
      rows: wire.matrix.rowsCount,
      cols: wire.matrix.colsCount,
      quantitationType: {
        name: wire.matrix.quantitationType.name,
        isPreferred: wire.matrix.quantitationType.isPreferred,
        isRatio: wire.matrix.quantitationType.isRatio,
        scale: wire.matrix.quantitationType.scale,
      },
    },
    rows: wire.rows.map((r) => {
      const rowGenes = r.genes ?? [];
      const geneIds = rowGenes.map((g) => g.id);
      // First gene id that carries an origin wins — single disc per row.
      const originHit = geneIds
        .map((id) => origins[id])
        .find((o) => o && o.goUri);
      return {
        designElementId: r.designElementId,
        designElementName: r.designElementName,
        geneIds,
        geneSymbols: rowGenes.map((g) => g.officialSymbol ?? ""),
        // Pull the full gene name through so the heatmap row gutter
        // can render symbol + name inline (no link-out required).
        geneNames: rowGenes.map((g) => g.name ?? ""),
        // Gutter headline: the searched gene(s), marked when the probe
        // isn't specific to them. Falls back to the probe name inside
        // the widget when there's no symbol to show.
        ...buildGeneRowLabel(rowGenes, queried),
        originColor: originHit ? colorForGoUri(originHit.goUri) : null,
        originTitle: originHit ? originHit.goLabel : null,
      };
    }),
    columns: wire.columns.map((c) => {
      const ids: Record<number, number> = {};
      for (const [k, v] of Object.entries(c.factorValueIds ?? {})) {
        ids[Number(k)] = v;
      }
      return {
        bioAssayId: c.bioAssayId,
        bioMaterialId: c.bioMaterialId,
        name: c.name,
        outlier: c.outlier,
        factorValueIds: ids,
      };
    }),
    // Adapt the wire's nested ``{ factor: { … } }`` shape to the
    // widget's Factor / FactorValue snake_case + OntologyTerm
    // structure. Statements aren't on the wire response for the
    // heatmap path; FV-level subject/object renders blank for now
    // and the widget falls back to ``free_text_label``.
    factors: (wire.factors ?? []).map((wrap) => ({
      id: wrap.factor.id,
      name: wrap.factor.name,
      // What the strip gutter labels the factor with — "treatment"
      // names the category, the description says what the treatment
      // was.
      description: wrap.factor.description ?? undefined,
      category: {
        label: wrap.factor.category ?? wrap.factor.name,
        uri: wrap.factor.categoryUri ?? null,
      },
      type:
        wrap.factor.type === "continuous"
          ? ("continuous" as const)
          : ("categorical" as const),
      factor_values: (wrap.factor.values ?? []).map((fv) => ({
        id: fv.id,
        free_text_label: fv.summary ?? "",
        is_baseline: !!fv.isBaseline,
        statements: [],
      })),
    })),
  };
}

// ─── Gene-selection state — URL hash + localStorage ──────────────────────────

/**
 * Hold the selected gene list for this dataset's Visualize tab.
 *
 *   - Persists to ``window.location.hash`` as ``#genes=ID,ID,ID``
 *     (NCBI gene ids — see ``shareIdOf``) so the URL is shareable
 *     (refresh / copy-paste restores).
 *   - Mirrors to ``localStorage`` keyed by datasetId so a same-
 *     browser revisit restores the last selection even without
 *     the hash.
 *   - Rehydrates Gene metadata (symbol / name) from the cache
 *     populated by the search query; uncached ids fall back to
 *     a per-id fetch via ``resolveGeneIds`` (unresolvable ids are
 *     kept as placeholders, never dropped).
 */
function useGeneSelection(datasetId: number): [
  Gene[],
  (updater: (cur: Gene[]) => Gene[]) => void,
  boolean,
] {
  const qc = useQueryClient();
  const lsKey = `${LS_PREFIX}${datasetId}`;
  const initRan = useRef(false);
  const [selected, setSelectedState] = useState<Gene[]>([]);
  // ``hydrated`` = the first-paint restore has settled. Seed it true
  // when there's nothing to restore, so the common no-selection case
  // (fresh visit / tab click) renders the random preview immediately
  // without a "restoring" flash. When there ARE ids to restore it
  // starts false and the async resolve below flips it.
  const [hydrated, setHydrated] = useState(() => {
    const ids = readGeneIdsFromHash() ?? readGeneIdsFromStorage(lsKey);
    return !ids || ids.length === 0;
  });

  // First-paint hydrate: URL hash wins, then localStorage. With no
  // prior selection at all, seed a random sample of the dataset's genes
  // so the heatmap shows something on first open instead of an empty
  // prompt. The seeded set persists like any manual selection (hash +
  // localStorage), so a refresh restores it rather than re-rolling.
  useEffect(() => {
    if (initRan.current) return;
    initRan.current = true;
    const ids = readGeneIdsFromHash() ?? readGeneIdsFromStorage(lsKey);
    if (!ids || ids.length === 0) {
      setHydrated(true);
      return;
    }
    void resolveGeneIds(ids, qc).then((genes) => {
      setSelectedState(genes);
      setHydrated(true);
    });
  }, [lsKey, qc, datasetId]);

  // Persist on change — but only once hydration has settled. Gating on
  // ``hydrated`` (state), not ``initRan`` (ref): the init effect flips
  // the ref synchronously while ``selected`` is still empty and the
  // async restore is in flight, so a ref-gated persist would write an
  // empty list straight back over a ``#genes=…`` hash and clobber it.
  // ``hydrated`` only flips true after the restore completes.
  useEffect(() => {
    if (!hydrated) return;
    const shareIds = selected.map(shareIdOf);
    writeGeneIdsToHash(shareIds);
    writeGeneIdsToStorage(lsKey, shareIds);
  }, [selected, lsKey, hydrated]);

  const setSelected = (updater: (cur: Gene[]) => Gene[]) => {
    setSelectedState((cur) => updater(cur));
  };

  return [selected, setSelected, hydrated];
}

/**
 * Hold the GO terms picked for this dataset, as units.
 *
 * Mirrors {@link useGeneSelection}: URL hash wins over localStorage on
 * first paint, both are written on change. The hash carries curies
 * only (``#go=GO:0005840,GO:0006412``) — a term's LABEL is display
 * text, not identity, so it stays out of the link and is resolved
 * from ``/annotations/term`` when a shared link arrives without one.
 * localStorage keeps the labels so a return visit in the same browser
 * names the chips without a round trip.
 *
 * 🛑 Terms are held INSTEAD OF their genes, not alongside. Expanding
 * at pick time is what put 68 ids in the URL and left the strip a wall
 * of chips with no way to say "drop the ribosome set"; the expansion
 * is now {@link useTermGenes}, at render.
 */
function useGoSelection(datasetId: number): [
  GoPick[],
  (updater: (cur: GoPick[]) => GoPick[]) => void,
  boolean,
] {
  const lsKey = `${GO_LS_PREFIX}${datasetId}`;
  const initRan = useRef(false);
  const [picks, setPicksState] = useState<GoPick[]>([]);
  const [hydrated, setHydrated] = useState(() => {
    const fromHash = readGoCuriesFromHash();
    return !fromHash || fromHash.length === 0;
  });

  useEffect(() => {
    if (initRan.current) return;
    initRan.current = true;
    const stored = readGoPicksFromStorage(lsKey);
    const fromHash = readGoCuriesFromHash();
    if (fromHash && fromHash.length > 0) {
      // Hash wins on identity; borrow any label localStorage already
      // has for the same curie so the chip is named immediately.
      const labelled = new Map(stored?.map((p) => [p.curie, p.label]));
      setPicksState(
        fromHash.map((curie) => ({ curie, label: labelled.get(curie) ?? "" })),
      );
      setHydrated(true);
      return;
    }
    if (stored && stored.length > 0) setPicksState(stored);
    setHydrated(true);
  }, [lsKey]);

  // Name any term that arrived as a bare curie (shared link). One
  // request per unnamed term, once — a failed lookup leaves the curie
  // showing rather than retrying forever.
  const resolving = useRef(new Set<string>());
  useEffect(() => {
    if (!hydrated) return;
    for (const p of picks) {
      if (p.label || resolving.current.has(p.curie)) continue;
      resolving.current.add(p.curie);
      void getOntologyTerm(p.curie).then((t) => {
        if (!t) return;
        setPicksState((cur) =>
          cur.map((x) => (x.curie === p.curie ? { ...x, label: t.label } : x)),
        );
      });
    }
  }, [picks, hydrated]);

  // Persist once hydration has settled — same gate, and for the same
  // reason, as the gene selection's.
  useEffect(() => {
    if (!hydrated) return;
    writeGoCuriesToHash(picks.map((p) => p.curie));
    writeGoPicksToStorage(lsKey, picks);
  }, [picks, lsKey, hydrated]);

  const setPicks = (updater: (cur: GoPick[]) => GoPick[]) =>
    setPicksState((cur) => updater(cur));

  return [picks, setPicks, hydrated];
}

/**
 * Expand the picked GO terms into genes, one query per term.
 *
 * Per-term rather than one combined query so adding a second term
 * doesn't refetch the first, and so a term that fails leaves the
 * others standing. Capped at {@link GO_TERM_GENE_CAP} per term, which
 * is the endpoint's own page size.
 *
 * Returns the genes in pick order, the per-gene origin map the heatmap
 * colours its row discs from, and whether any expansion is still in
 * flight — the heatmap waits on that, or a shared ``#go=`` link
 * flashes the random preview before the real set lands.
 */
function useTermGenes(
  picks: GoPick[],
  taxon: string | undefined,
): { genes: Gene[]; origins: Record<number, GeneOrigin>; loading: boolean } {
  // 🛑 `combine`, not a `useMemo` over the results array. `useQueries`
  // hands back a fresh array every render, so a memo keyed on it never
  // hits — and the identity of `genes` / `origins` flowing out of here
  // feeds the heatmap payload, which would then rebuild on every
  // keystroke elsewhere in the tab. `combine` is memoized on the
  // underlying query results for us.
  return useQueries({
    queries: picks.map((p) => ({
      queryKey: ["go-term-genes", p.curie, taxon ?? "any", GO_TERM_GENE_CAP],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        getGoTermGenes(p.curie, { taxon, limit: GO_TERM_GENE_CAP, signal }),
      staleTime: 30 * 60_000,
    })),
    combine: (results) => {
      const genes: Gene[] = [];
      const origins: Record<number, GeneOrigin> = {};
      const seen = new Set<number>();
      picks.forEach((p, i) => {
        for (const g of results[i]?.data?.data ?? []) {
          // First term to claim a gene owns its disc — a gene in two
          // picked terms gets one colour, not a fight between two.
          if (seen.has(g.id)) continue;
          seen.add(g.id);
          genes.push(g);
          origins[g.id] = { goUri: p.curie, goLabel: p.label || p.curie };
        }
      });
      return {
        genes,
        origins,
        loading: results.some((r) => r.isLoading || r.isPending),
      };
    },
  });
}

/**
 * Generic LRU list persisted to localStorage. Used for recent search
 * queries (symbol mode) and recent picked GO terms (GO mode) so the
 * visitor can re-fire something they did before in one click.
 *
 * Equality is by JSON-stringified form, which is good enough for the
 * shallow records we store. Cap is module-level RECENT_CAP.
 */
function useRecentList<T>(
  lsKey: string,
): [T[], (item: T) => void, () => void] {
  const initRan = useRef(false);
  const [items, setItems] = useState<T[]>([]);

  useEffect(() => {
    if (initRan.current) return;
    initRan.current = true;
    try {
      const raw = window.localStorage.getItem(lsKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setItems(parsed.slice(0, RECENT_CAP));
    } catch {
      /* ignore */
    }
  }, [lsKey]);

  useEffect(() => {
    if (!initRan.current) return;
    try {
      if (items.length === 0) window.localStorage.removeItem(lsKey);
      else window.localStorage.setItem(lsKey, JSON.stringify(items));
    } catch {
      /* sandboxed env */
    }
  }, [items, lsKey]);

  const push = (item: T) => {
    setItems((cur) => {
      const k = JSON.stringify(item);
      const next = [item, ...cur.filter((x) => JSON.stringify(x) !== k)];
      return next.slice(0, RECENT_CAP);
    });
  };
  const clear = () => setItems([]);
  return [items, push, clear];
}

/** Small horizontal row of "recent" buttons + a clear control. */
function RecentRow({
  label,
  onClear,
  children,
}: {
  label: string;
  onClear: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center flex-wrap gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-slate-400 mr-1">
        {label}
      </span>
      {children}
      <button
        type="button"
        onClick={onClear}
        className="ml-1 text-[10px] text-slate-400 hover:text-slate-700 hover:underline"
        title="clear recent"
      >
        clear
      </button>
    </div>
  );
}

/** The identifier we persist to the URL hash / localStorage for a gene.
 *
 *  We store the **NCBI gene id**, not Gemma's internal gene id, because
 *  the two endpoints disagree on which they accept:
 *    - ``/genes/{id}`` (metadata rehydrate) resolves by NCBI id only —
 *      the internal id returns an empty list.
 *    - ``/datasets/{id}/heatmap-data?genes=…`` wants the internal id.
 *  Persisting the NCBI id is what makes a shared/cold-loaded link
 *  rehydrate: ``/genes/{ncbiId}`` returns the full Gene (carrying the
 *  internal ``id`` the heatmap then uses). It's also the more stable,
 *  cross-instance identifier for a shareable URL. Genes with no NCBI id
 *  fall back to the internal id — they won't cold-rehydrate metadata,
 *  but the heatmap still renders (the internal id round-trips), so the
 *  selection is never lost. */
function shareIdOf(g: Gene): number {
  return g.ncbiId ?? g.id;
}

/**
 * Split the fragment into the router's part and ours.
 *
 * The app runs on hash routing (see main.tsx), so the fragment already
 * carries the route: ``#/dataset/123``. TanStack's hash history
 * reserves everything after a *second* ``#`` for application use, so
 * the two coexist as ``#/dataset/123#genes=1,2``. Under plain browser
 * history (dev, and prod again if Apache ever grows a
 * `FallbackResource`) there is no route part and the whole fragment is
 * ours.
 *
 * Telling the cases apart: a route always starts with ``/``, and
 * ``genes=…`` never does. Getting this wrong is not cosmetic — the
 * previous version rebuilt the URL as ``pathname + search + "#genes=…"``,
 * which under hash routing drops the route on the floor and sends a
 * refresh to the home page.
 */
export function splitFragment(raw: string): { route: string; params: string } {
  const frag = raw.replace(/^#/, "");
  if (!frag.startsWith("/")) return { route: "", params: frag };
  const i = frag.indexOf("#");
  return i === -1
    ? { route: frag, params: "" }
    : { route: frag.slice(0, i), params: frag.slice(i + 1) };
}

function readGeneIdsFromHash(): number[] | null {
  if (typeof window === "undefined") return null;
  const { params } = splitFragment(window.location.hash);
  if (!params) return null;
  const raw = new URLSearchParams(params).get(GENES_HASH_KEY);
  if (!raw) return null;
  return raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * Set (or, with null, clear) one param in the fragment's second `#`,
 * leaving the route and every other param alone.
 *
 * 🛑 The single writer for all of them. The gene list and the GO term
 * list are persisted by separate effects that both fire on the same
 * render, and each rebuilds the fragment from `window.location.hash`
 * — so two copies of this logic race, and the second to run drops
 * whatever the first had just written. There is one copy, and it is
 * this one.
 *
 * `route` comes back from `splitFragment` WITHOUT its leading `#`;
 * rebuilding has to put it back, and has to keep `pathname` +
 * `search` (the app can be mounted under a sub-path). Getting either
 * wrong strips the app's own hash route and the router lands nowhere.
 *
 * `replaceState` rather than `router.navigate` deliberately: a gene
 * pick is not a navigation, and routing it through the router would
 * re-render this whole heatmap page on every checkbox.
 */
export function setFragmentParam(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  const { route, params } = splitFragment(window.location.hash);
  const p = new URLSearchParams(params);
  if (value === null || value === "") p.delete(key);
  else p.set(key, value);
  const next = p.toString();
  const frag = route
    ? next
      ? `#${route}#${next}`
      : `#${route}`
    : next
      ? `#${next}`
      : "";
  window.history.replaceState(
    {},
    "",
    window.location.pathname + window.location.search + frag,
  );
}

function writeGeneIdsToHash(ids: number[]): void {
  setFragmentParam(GENES_HASH_KEY, ids.length === 0 ? null : ids.join(","));
}

/** Picked GO curies from the fragment's ``go`` param, or null when the
 *  param is absent. Mirrors {@link readGeneIdsFromHash} — null means
 *  "the link says nothing", which is what lets localStorage answer
 *  instead; an empty array would mean "the link says none". */
function readGoCuriesFromHash(): string[] | null {
  if (typeof window === "undefined") return null;
  const { params } = splitFragment(window.location.hash);
  if (!params) return null;
  const raw = new URLSearchParams(params).get(GO_HASH_KEY);
  if (!raw) return null;
  return raw
    .split(",")
    .map((s) => toGoCurie(s.trim()))
    .filter(Boolean);
}

function writeGoCuriesToHash(curies: string[]): void {
  setFragmentParam(GO_HASH_KEY, curies.length === 0 ? null : curies.join(","));
}

function readGoPicksFromStorage(key: string): GoPick[] | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GoPick[];
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((p) => p && typeof p.curie === "string" && p.curie)
      .map((p) => ({
        curie: toGoCurie(p.curie),
        label: typeof p.label === "string" ? p.label : "",
      }));
  } catch {
    return null;
  }
}

function writeGoPicksToStorage(key: string, picks: GoPick[]): void {
  try {
    if (picks.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(picks));
  } catch {
    /* sandboxed env */
  }
}

function readGeneIdsFromStorage(key: string): number[] | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as number[];
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((n) => typeof n === "number" && n > 0);
  } catch {
    return null;
  }
}

function writeGeneIdsToStorage(key: string, ids: number[]): void {
  try {
    if (ids.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* sandboxed env */
  }
}

/** Resolve a list of persisted share-ids (see ``shareIdOf`` — NCBI ids,
 *  or internal ids for the rare gene lacking one) to full Gene records.
 *  Checks the TanStack cache first (populated by typeahead queries),
 *  then falls back to a per-id fetch via ``/genes/{ncbiId}``.
 *
 *  Crucially, an id that can't be resolved is NOT dropped — it's kept as
 *  a minimal ``{ id }`` placeholder. Dropping it would let the persist
 *  effect write the shrunken list straight back over the URL hash and
 *  silently lose the shared selection (and the placeholder's id still
 *  drives the heatmap fetch, which renders symbols from its own
 *  response). */
async function resolveGeneIds(
  shareIds: number[],
  qc: ReturnType<typeof useQueryClient>,
): Promise<Gene[]> {
  const out: Gene[] = [];
  // Key cached genes by BOTH internal id and ncbiId so a share-id (which
  // is normally the ncbiId) finds its cached Gene on a warm tab-switch.
  const cached = new Map<number, Gene>();
  const index = (g: Gene) => {
    cached.set(g.id, g);
    if (g.ncbiId != null) cached.set(g.ncbiId, g);
  };
  // Sweep cached gene-search AND go-term-genes results for matches —
  // GO-picked genes need to rehydrate too, not just symbol-picked ones.
  const cache = qc.getQueryCache();
  for (const entry of cache.findAll({ queryKey: ["gene-search"] })) {
    const data = entry.state.data as Gene[] | undefined;
    if (!data) continue;
    for (const g of data) index(g);
  }
  for (const entry of cache.findAll({ queryKey: ["go-term-genes"] })) {
    const data = entry.state.data as { data?: Gene[] } | undefined;
    const list = data?.data;
    if (!list) continue;
    for (const g of list) index(g);
  }
  for (const shareId of shareIds) {
    const hit = cached.get(shareId);
    if (hit) {
      out.push(hit);
      continue;
    }
    // Fall back to a single-id fetch (``/genes/{ncbiId}``). Keep a
    // placeholder on empty/error so the selection survives a cold load.
    let resolved: Gene | undefined;
    try {
      const r = await fetch(restUrl(`/genes/${shareId}`)).then((res) =>
        res.json(),
      );
      resolved = r?.data?.[0] as Gene | undefined;
    } catch {
      /* network error — fall through to placeholder */
    }
    out.push(resolved ?? { id: shareId });
  }
  return out;
}

