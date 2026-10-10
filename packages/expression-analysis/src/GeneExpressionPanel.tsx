/**
 * Gene-expression browse: build a small custom gene set (by symbol or by
 * GO term) and render the resulting expression heatmap against one
 * dataset/experiment. The gene set is held on the client only — URL
 * hash for shareability, localStorage as session-restore — never
 * server-side.
 *
 * Extracted from apps/browser's `VisualizeTab` (2026-09-30) so
 * apps/curation can offer the same feature without a second
 * implementation. Presentation + orchestration only: the host app
 * supplies every data-fetching function via `api` (see
 * `GeneExpressionApi` in `types.ts`) and — for row tooltips, which link
 * into routes this package cannot know about — an optional
 * `renderProbeTooltip`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useQueries,
  useQuery,
  useQueryClient,
  keepPreviousData,
  type QueryClient,
} from "@tanstack/react-query";
import {
  HeatmapWidget,
  NONSPECIFIC_MARK,
  type HeatmapPayloadRow,
  type HeatmapRowGene,
} from "@gemma/heatmap";
import { useDebounced, toGoCurie, shortenGoUri, curieToUrl } from "./util";
import type {
  Gene,
  GoTermMatch,
  GeneOrigin,
  GeneExpressionApi,
  QuantitationTypeLite,
} from "./types";

const GENES_HASH_KEY = "genes";
const GO_HASH_KEY = "go";
const LS_PREFIX = "gemma-gene-expression-genes:";
const GO_LS_PREFIX = "gemma-gene-expression-go:";
const PICKER_MODE_LS_KEY = "gemma-gene-expression-picker-mode";
const RECENT_SYMBOL_QUERIES_LS_KEY = "gemma-gene-expression-recent-symbol-queries";
const RECENT_GO_TERMS_LS_KEY = "gemma-gene-expression-recent-go-terms";
const RECENT_CAP = 8;
const RANDOM_SAMPLE_SIZE = 20;
const GO_TERM_GENE_CAP = 100;

type PickerMode = "symbol" | "go";
type GoPick = { curie: string; label: string };
type RecentGoTerm = { valueUri: string | null; value: string };

export interface ProbeTooltipInput {
  designElementName: string;
  designElementId?: number | null;
  genes: HeatmapRowGene[];
  platformShortName?: string;
  queried: ReadonlySet<number>;
}

export interface GeneExpressionPanelProps {
  api: GeneExpressionApi;
  /** Gemma dataset id (curation calls this by experiment id — same
   *  underlying Gemma id). */
  entityId: number;
  /** Taxon path param the host has already resolved (e.g. "mouse") —
   *  this package never needs the full Taxon object. */
  taxon?: string;
  /** Shows the admin-only quantitation-type / outlier-mask controls.
   *  No-op when `api.getQuantitationTypes` is not supplied. */
  isAdmin?: boolean;
  /** Row-label tooltip. Omit for a plain, link-free fallback — see the
   *  file header for why this can't have a package-wide default. */
  renderProbeTooltip?: (input: ProbeTooltipInput) => React.ReactNode;
  /** Renders one gene symbol in a row's gutter label, given the row it
   *  sits on — how a host links each symbol to its gene page. Omit for
   *  a plain-text gutter; like `renderProbeTooltip`, the routes are the
   *  host's, not this package's. */
  renderRowLabelGene?: (row: HeatmapPayloadRow, symbol: string) => React.ReactNode;
}

const ORIGIN_PALETTE = [
  "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#f43f5e", "#14b8a6",
  "#6366f1", "#84cc16", "#ec4899", "#06b6d4", "#d946ef", "#f97316",
];

function colorForGoUri(uri: string): string {
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

export function GeneExpressionPanel({
  api,
  entityId,
  taxon,
  isAdmin = false,
  renderProbeTooltip,
  renderRowLabelGene,
}: GeneExpressionPanelProps) {
  const [selectedQt, setSelectedQt] = useState<number | null>(null);
  const [maskOutliers, setMaskOutliers] = useState(true);

  const [selected, setSelected, selectionHydrated] = useGeneSelection(api, entityId);
  const [goPicks, setGoPicks, goHydrated] = useGoSelection(api, entityId);
  const { genes: termGenes, origins, loading: termGenesLoading } =
    useTermGenes(api, goPicks, taxon);
  const effectiveGenes = useMemo(() => {
    if (termGenes.length === 0) return selected;
    const out = [...selected];
    const have = new Set(selected.map((g) => g.id));
    for (const g of termGenes) if (!have.has(g.id)) out.push(g);
    return out;
  }, [selected, termGenes]);
  const hydrated = selectionHydrated && goHydrated && !termGenesLoading;
  const [mode, setModeState] = useState<PickerMode>(readStickyPickerMode);
  const [query, setQuery] = useState("");
  const setMode = (m: PickerMode) => {
    setModeState(m);
    writeStickyPickerMode(m);
  };
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
      cur.some((p) => p.curie === curie) ? cur : [...cur, { curie, label: t.value }],
    );
  };

  return (
    <div className="lg:flex lg:items-start lg:gap-4 space-y-4 lg:space-y-0">
      <section className="bg-white border border-slate-200 rounded lg:w-1/3 lg:shrink-0">
        <header className="px-4 py-2 border-b border-slate-200">
          <h2 className="text-sm font-semibold tracking-wide">Gene expression</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Build a custom gene set and render the heatmap. Selection is
            held in the URL — share the link to share the view.
          </p>
        </header>
        <div className="px-4 py-3">
          {mode === "symbol" ? (
            <GenePickerBySymbol
              api={api}
              taxon={taxon}
              alreadySelected={selected.map((g) => g.id)}
              modeToggle={modeToggle}
              query={query}
              setQuery={setQuery}
              recentQueries={recentSymbolQueries}
              onClearRecent={clearRecentSymbolQueries}
              onAdd={(gene) => {
                if (query.trim()) pushRecentSymbolQuery(query.trim());
                setSelected((cur) => (cur.some((g) => g.id === gene.id) ? cur : [...cur, gene]));
              }}
              onAddMany={(g) => {
                if (query.trim()) pushRecentSymbolQuery(query.trim());
                addMany(g);
              }}
            />
          ) : (
            <GenePickerByGo
              api={api}
              taxon={taxon}
              alreadySelected={effectiveGenes.map((g) => g.id)}
              modeToggle={modeToggle}
              query={query}
              setQuery={setQuery}
              recentTerms={recentGoTerms}
              onPickTerm={(t) => pushRecentGoTerm({ valueUri: t.valueUri, value: t.value })}
              onClearRecent={clearRecentGoTerms}
              onAdd={(gene) =>
                setSelected((cur) => (cur.some((g) => g.id === gene.id) ? cur : [...cur, gene]))
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
          onRemove={(id) => setSelected((cur) => cur.filter((g) => g.id !== id))}
          onRemoveTerm={(curie) => setGoPicks((cur) => cur.filter((p) => p.curie !== curie))}
          onClear={() => {
            setSelected(() => []);
            setGoPicks(() => []);
          }}
        />
      </section>

      <div className="lg:flex-1 lg:min-w-0 space-y-2">
        {isAdmin && api.getQuantitationTypes ? (
          <QuantitationTypePicker
            api={api}
            entityId={entityId}
            selectedQt={selectedQt}
            onChange={setSelectedQt}
            maskOutliers={maskOutliers}
            onMaskOutliersChange={setMaskOutliers}
          />
        ) : null}
        <HeatmapPanel
          api={api}
          entityId={entityId}
          genes={effectiveGenes}
          origins={origins}
          selectionHydrated={hydrated}
          quantitationType={selectedQt}
          maskOutliers={maskOutliers}
          renderProbeTooltip={renderProbeTooltip}
          renderRowLabelGene={renderRowLabelGene}
        />
      </div>
    </div>
  );
}

// ─── Picker mode tabs ───────────────────────────────────────────────────────

function PickerModeTabs({ mode, onChange }: { mode: PickerMode; onChange: (m: PickerMode) => void }) {
  return (
    <div className="inline-flex border border-slate-300 rounded overflow-hidden text-xs">
      <ModeButton active={mode === "symbol"} onClick={() => onChange("symbol")}>By symbol</ModeButton>
      <ModeButton active={mode === "go"} onClick={() => onChange("go")}>By GO term</ModeButton>
    </div>
  );
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={"px-2.5 py-1 transition-colors " + (active ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-100")}
    >
      {children}
    </button>
  );
}

// ─── Symbol picker ──────────────────────────────────────────────────────────

function GenePickerBySymbol({
  api, taxon, alreadySelected, modeToggle, query, setQuery,
  recentQueries, onClearRecent, onAdd, onAddMany,
}: {
  api: GeneExpressionApi;
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
    queryKey: ["gene-expression:gene-search", trimmed, taxon ?? ""],
    queryFn: ({ signal }) => api.searchGenes(trimmed, { taxon, limit: 20, signal }),
    enabled: trimmed.length >= 2,
    staleTime: 5 * 60_000,
  });

  const already = useMemo(() => new Set(alreadySelected), [alreadySelected]);
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
            {taxon ? <span className="ml-1.5 text-slate-400">— {taxon} only</span> : null}
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
        <RecentRow label="recent" onClear={onClearRecent}>
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
              <div className="px-3 py-2 text-xs text-slate-500 italic">searching…</div>
            ) : candidates.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-500 italic">no matches</div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {candidates.map((g) => (
                  <li key={g.id} className="px-2.5 py-1 flex items-baseline justify-between gap-2 hover:bg-slate-50">
                    <span className="min-w-0 truncate">
                      <span className="font-mono font-semibold text-xs text-slate-900">
                        {g.officialSymbol ?? `#${g.id}`}
                      </span>
                      {g.officialName ? (
                        <span className="ml-2 text-[11px] text-slate-500">{g.officialName}</span>
                      ) : null}
                      {g.taxon?.commonName ? (
                        <span className="ml-2 text-[10px] text-slate-400">{g.taxon.commonName}</span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      onClick={() => onAdd(g)}
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

// ─── GO-term picker ─────────────────────────────────────────────────────────

function GenePickerByGo({
  api, taxon, alreadySelected, modeToggle, query, setQuery,
  recentTerms, onPickTerm, onClearRecent, onAdd, onAddTerm, pickedTermCuries,
}: {
  api: GeneExpressionApi;
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
  pickedTermCuries: string[];
}) {
  const termQuery = query;
  const setTermQuery = setQuery;
  const [pickedTerm, setPickedTerm] = useState<GoTermMatch | null>(null);
  const debouncedTermQuery = useDebounced(termQuery, 150);
  const trimmedTermQuery = debouncedTermQuery.trim();

  const termsQ = useQuery({
    queryKey: ["gene-expression:go-term-search", trimmedTermQuery],
    queryFn: ({ signal }) => api.searchGoTerms(trimmedTermQuery, { limit: 15, signal }),
    enabled: !pickedTerm && trimmedTermQuery.length >= 2,
    staleTime: 5 * 60_000,
  });

  const genesQ = useQuery({
    queryKey: ["gene-expression:go-term-genes", pickedTerm?.valueUri ?? "", taxon ?? ""],
    queryFn: ({ signal }) =>
      pickedTerm?.valueUri
        ? api.getGoTermGenes(pickedTerm.valueUri, { taxon, limit: 100, signal })
        : Promise.resolve(null),
    enabled: !!pickedTerm?.valueUri,
    staleTime: 5 * 60_000,
  });

  const already = useMemo(() => new Set(alreadySelected), [alreadySelected]);

  if (!pickedTerm) {
    const matches = termsQ.data ?? [];
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-end gap-2">
          <label className="block flex-1 min-w-0">
            <span className="block text-[11px] text-slate-500 mb-1">
              Search a GO term
              {taxon ? <span className="ml-1.5 text-slate-400">— genes scoped to {taxon}</span> : null}
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
                  setPickedTerm({ value: t.value, valueUri: t.valueUri, category: null, categoryUri: null });
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
              <div className="px-3 py-2 text-xs text-slate-500 italic">searching GO terms…</div>
            ) : termsQ.isError ? (
              <div className="px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                {api.formatSearchError?.(termsQ.error, trimmedTermQuery) ?? "Search failed."}
              </div>
            ) : matches.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-500 italic">no GO terms match</div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {matches.map((t) => (
                  <li key={t.valueUri ?? t.value} className="px-2.5 py-1 hover:bg-slate-50">
                    <button
                      type="button"
                      onClick={() => {
                        setPickedTerm(t);
                        onPickTerm({ valueUri: t.valueUri, value: t.value });
                      }}
                      className="w-full flex items-baseline justify-between gap-2 text-left"
                    >
                      <span className="min-w-0 truncate">
                        <span className="font-medium text-xs text-slate-900">{t.value}</span>
                        {t.valueUri ? (
                          <span className="ml-2 text-[10px] font-mono text-slate-400">{shortenGoUri(t.valueUri)}</span>
                        ) : null}
                      </span>
                      <span className="text-[11px] text-blue-700 shrink-0 whitespace-nowrap">browse →</span>
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

  const page = genesQ.data;
  const total = page?.totalElements ?? 0;
  const shown = page?.data ?? [];
  const overCap = total > GO_TERM_GENE_CAP;
  const alreadyPicked = !!pickedTerm.valueUri && pickedTermCuries.includes(toGoCurie(pickedTerm.valueUri));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">GO term</div>
          <div className="text-sm font-medium text-slate-900 truncate">{pickedTerm.value}</div>
          {pickedTerm.valueUri ? (
            <a
              href={curieToUrl(pickedTerm.valueUri) ?? pickedTerm.valueUri}
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
            onClick={() => { setPickedTerm(null); setTermQuery(""); }}
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
          has no genes annotated here, or the GO ontology isn't loaded on
          this Gemma instance.
        </div>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <p className="text-[11px] text-slate-500 leading-snug min-w-0">
              <strong className="text-slate-700">{total.toLocaleString()}</strong>{" "}
              {total === 1 ? "gene" : "genes"} annotated{taxon ? ` in ${taxon}` : ""}.
              {overCap ? (
                <> Over the {GO_TERM_GENE_CAP}-gene limit for one term — pick a
                  more specific term, or add genes individually from the
                  first {shown.length} below.</>
              ) : null}
            </p>
            {alreadyPicked ? (
              <span className="text-[11px] px-2 py-0.5 border border-sky-300 bg-sky-50 text-sky-800 rounded whitespace-nowrap shrink-0">
                term added
              </span>
            ) : overCap ? null : (
              <button
                type="button"
                onClick={() => onAddTerm({ valueUri: pickedTerm.valueUri, value: pickedTerm.value })}
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
                  <li key={g.id} className="px-2.5 py-1 flex items-baseline justify-between gap-2 hover:bg-slate-50">
                    <span className="min-w-0 truncate">
                      <span className="font-mono font-semibold text-xs text-slate-900">
                        {g.officialSymbol ?? `#${g.id}`}
                      </span>
                      {g.officialName ? (
                        <span className="ml-2 text-[11px] text-slate-500">{g.officialName}</span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      disabled={isSelected}
                      onClick={() => onAdd(g)}
                      className={"text-[11px] px-2 py-0.5 border rounded whitespace-nowrap shrink-0 " +
                        (isSelected ? "border-slate-200 text-slate-400 cursor-default" : "border-slate-300 hover:bg-slate-900 hover:text-white hover:border-slate-900")}
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

// ─── Selected gene chips ────────────────────────────────────────────────────

function SelectedGenesStrip({
  genes, terms, termGenes, origins, onRemove, onRemoveTerm, onClear,
}: {
  genes: Gene[];
  terms: GoPick[];
  termGenes: Gene[];
  origins: Record<number, GeneOrigin>;
  onRemove: (id: number) => void;
  onRemoveTerm: (curie: string) => void;
  onClear: () => void;
}) {
  const COLLAPSE_THRESHOLD = 15;
  const [expanded, setExpanded] = useState(false);
  const [openTerm, setOpenTerm] = useState<string | null>(null);
  if (genes.length === 0 && terms.length === 0) return null;
  const genesOfTerm = (curie: string) => termGenes.filter((g) => origins[g.id]?.goUri === curie);
  const total = genes.length + termGenes.length;
  const visible = expanded || genes.length <= COLLAPSE_THRESHOLD ? genes : genes.slice(0, COLLAPSE_THRESHOLD);
  const hiddenCount = genes.length - visible.length;
  return (
    <div className="border-t border-slate-200 px-4 py-2 flex items-center gap-2 flex-wrap">
      <span className="text-[10px] uppercase tracking-wide text-slate-500 mr-1">
        {total} {total === 1 ? "gene" : "genes"}
      </span>
      {terms.map((t) => {
        const members = genesOfTerm(t.curie);
        const isOpen = openTerm === t.curie;
        return (
          <span key={t.curie} className="inline-flex flex-col">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-sky-50 border border-sky-300 rounded" title={t.curie}>
              <span aria-hidden className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: colorForGoUri(t.curie) }} />
              <span className="font-semibold text-slate-900">{t.label || t.curie}</span>
              <span className="text-slate-500">· {members.length} {members.length === 1 ? "gene" : "genes"}</span>
              <button type="button" onClick={() => setOpenTerm(isOpen ? null : t.curie)} aria-label={`${isOpen ? "hide" : "show"} genes in ${t.label || t.curie}`} className="text-slate-400 hover:text-slate-900">
                {isOpen ? "▴" : "▾"}
              </button>
              <button type="button" onClick={() => onRemoveTerm(t.curie)} aria-label={`remove ${t.label || t.curie}`} className="text-slate-400 hover:text-rose-600">×</button>
            </span>
            {isOpen ? (
              <span className="mt-1 max-w-[22rem] max-h-32 overflow-y-auto rounded border border-slate-200 bg-white px-2 py-1 text-[11px] leading-relaxed text-slate-600">
                {members.length === 0 ? "no genes for this term in this taxon" : members.map((g) => g.officialSymbol ?? `#${g.id}`).join(", ")}
              </span>
            ) : null}
          </span>
        );
      })}
      {visible.map((g) => (
        <span key={g.id} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-slate-100 border border-slate-300 rounded">
          <span className="font-mono font-semibold text-slate-900">{g.officialSymbol ?? `#${g.id}`}</span>
          <button type="button" onClick={() => onRemove(g.id)} aria-label={`remove ${g.officialSymbol ?? g.id}`} className="text-slate-400 hover:text-rose-600">×</button>
        </span>
      ))}
      {hiddenCount > 0 ? (
        <button type="button" onClick={() => setExpanded(true)} className="px-2 py-0.5 text-[11px] text-slate-600 border border-slate-300 rounded hover:bg-slate-100">
          +{hiddenCount} more
        </button>
      ) : null}
      {expanded && genes.length > COLLAPSE_THRESHOLD ? (
        <button type="button" onClick={() => setExpanded(false)} className="px-2 py-0.5 text-[11px] text-slate-600 border border-slate-300 rounded hover:bg-slate-100">
          collapse
        </button>
      ) : null}
      <button type="button" onClick={onClear} className="ml-2 text-[11px] text-slate-500 hover:text-slate-900 hover:underline">
        Clear all
      </button>
    </div>
  );
}

// ─── Heatmap panel ──────────────────────────────────────────────────────────

function HeatmapPanel({
  api, entityId, genes, origins, selectionHydrated,
  quantitationType = null, maskOutliers = true, renderProbeTooltip,
  renderRowLabelGene,
}: {
  api: GeneExpressionApi;
  entityId: number;
  genes: Gene[];
  origins: Record<number, GeneOrigin>;
  selectionHydrated: boolean;
  quantitationType?: number | null;
  maskOutliers?: boolean;
  renderProbeTooltip?: (input: ProbeTooltipInput) => React.ReactNode;
  renderRowLabelGene?: (row: HeatmapPayloadRow, symbol: string) => React.ReactNode;
}) {
  const geneIds = useMemo(() => genes.map((g) => g.id), [genes]);
  const queried = useMemo(() => new Set(geneIds), [geneIds]);
  const isSample = geneIds.length === 0;
  const [sampleRoll, setSampleRoll] = useState(0);

  const decoration = useMemo(() => ({ origins, queried }), [origins, queried]);

  const wireQuery = useQuery({
    queryKey: isSample
      ? ["gene-expression:heatmap-sample", entityId, RANDOM_SAMPLE_SIZE, quantitationType ?? "default", maskOutliers, sampleRoll]
      : ["gene-expression:heatmap", entityId, geneIds.join(","), quantitationType ?? "default", maskOutliers],
    queryFn: ({ signal }) =>
      api.getHeatmapData(
        entityId,
        {
          ...(isSample ? { sampleSize: RANDOM_SAMPLE_SIZE } : { genes: geneIds }),
          ...(quantitationType != null ? { quantitationType } : {}),
          ...(maskOutliers ? {} : { maskOutliers: false }),
        },
        decoration,
        signal,
      ),
    enabled: selectionHydrated,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const platformsQ = useQuery({
    queryKey: ["gene-expression:platforms", entityId],
    queryFn: ({ signal }) => (api.getPlatforms ? api.getPlatforms(entityId, signal) : Promise.resolve([])),
    enabled: !!api.getPlatforms,
    staleTime: 30 * 60_000,
  });
  const platformShortName =
    platformsQ.data?.length === 1 ? (platformsQ.data[0].shortName ?? undefined) : undefined;

  if (!selectionHydrated || wireQuery.isLoading || wireQuery.isPending) {
    return (
      <div className="bg-white border border-slate-200 rounded px-6 py-10 text-center text-sm text-slate-500">
        loading expression matrix…
      </div>
    );
  }
  const payload = wireQuery.data;
  if (!payload || !payload.rows || payload.rows.length === 0) {
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

  const rowLabelTooltip = (i: number) => {
    const r = payload.rows[i];
    if (!r) return null;
    const rowGenes: HeatmapRowGene[] = r.geneIds.map((id, gi) => ({
      id,
      officialSymbol: r.geneSymbols?.[gi] ?? null,
      name: r.geneNames?.[gi] ?? null,
      ncbiId: r.geneNcbiIds?.[gi] ?? null,
    }));
    const input: ProbeTooltipInput = {
      designElementName: r.designElementName,
      designElementId: r.designElementId,
      genes: rowGenes,
      platformShortName,
      queried,
    };
    if (renderProbeTooltip) return renderProbeTooltip(input);
    return <DefaultProbeRowTooltip {...input} />;
  };
  const anyMarked = payload.rows.some((r) => r.labelSymbol?.endsWith(NONSPECIFIC_MARK));
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
            Showing a random sample of {payload.rows.length}{" "}
            {payload.rows.length === 1 ? "gene" : "genes"} from this dataset.
            Search and add genes on the left to build your own set.
          </span>
        </p>
      ) : null}
      <div className="bg-slate-50 border border-slate-200 rounded p-2">
        <HeatmapWidget
          payload={payload}
          rowLabelGutterWidth={260}
          rowLabelTooltip={rowLabelTooltip}
          renderRowLabelGene={
            renderRowLabelGene
              ? (i, sym) => {
                  const r = payload.rows[i];
                  return r ? renderRowLabelGene(r, sym) : null;
                }
              : undefined
          }
          defaultRowOrder="cluster"
        />
      </div>
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
            <>A row naming several genes (<span className="font-mono">A;B</span>)
              matched more than one of your genes on a single probe.{" "}</>
          ) : null}
          Hover a row label for the full probe→gene mapping.
        </p>
      ) : null}
    </div>
  );
}

/** Link-free fallback row tooltip, used when the host doesn't supply
 *  `renderProbeTooltip` (it links into app-local routes this package
 *  can't know about). */
function DefaultProbeRowTooltip({ designElementName, genes, queried }: ProbeTooltipInput) {
  const named = genes.filter((g) => g.officialSymbol || g.name);
  if (named.length === 0) {
    return (
      <div className="text-xs text-slate-500">
        <div className="italic">maps to no gene</div>
        <div className="text-[10px] text-slate-500 font-mono">probe:{designElementName}</div>
      </div>
    );
  }
  return (
    <div className="text-xs text-slate-800">
      <div className="space-y-1">
        {named.map((g) => (
          <div key={g.id}>
            <span className="font-mono font-semibold">{g.officialSymbol || `gene ${g.id}`}</span>
            {g.name ? <span className="ml-2 text-slate-600">{g.name}</span> : null}
            {queried.size > 0 && !queried.has(g.id) ? (
              <span className="ml-2 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-px align-middle">
                not searched
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <div className="text-[10px] text-slate-500 font-mono mt-1">probe:{designElementName}</div>
    </div>
  );
}

// ─── Quantitation-type picker (admin-only) ─────────────────────────────────

function qtOptionLabel(qt: QuantitationTypeLite): string {
  const bits = [qt.scale, qt.type].filter(Boolean).join(" · ");
  const pref = qt.isPreferred || qt.isMaskedPreferred ? " ★" : "";
  const name = qt.name ?? `QT ${qt.id}`;
  return bits ? `${name} — ${bits}${pref}` : `${name}${pref}`;
}

function QuantitationTypePicker({
  api, entityId, selectedQt, onChange, maskOutliers, onMaskOutliersChange,
}: {
  api: GeneExpressionApi;
  entityId: number;
  selectedQt: number | null;
  onChange: (qtId: number | null) => void;
  maskOutliers: boolean;
  onMaskOutliersChange: (mask: boolean) => void;
}) {
  const q = useQuery({
    queryKey: ["gene-expression:quantitation-types", entityId],
    queryFn: ({ signal }) => api.getQuantitationTypes!(entityId, signal),
    enabled: !!api.getQuantitationTypes,
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
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        >
          <option value="">Processed (default)</option>
          {qts.map((qt) => (
            <option key={qt.id} value={qt.id}>{qtOptionLabel(qt)}</option>
          ))}
        </select>
      </label>
      {q.isLoading ? (
        <span className="text-[11px] text-slate-400 italic">loading types…</span>
      ) : q.isError ? (
        <span className="text-[11px] text-rose-600">couldn’t load quantitation types</span>
      ) : selectedQt != null ? (
        <span className="text-[11px] text-slate-400">served from raw vectors</span>
      ) : null}
      <label
        className="flex items-center gap-1.5 text-xs text-slate-600 ml-auto shrink-0"
        title="When on (default), assay columns flagged as outliers are masked out. Turn off to render their stored expression values instead."
      >
        <input type="checkbox" className="accent-blue-600" checked={maskOutliers} onChange={(e) => onMaskOutliersChange(e.target.checked)} />
        <span>Mask outliers</span>
      </label>
    </div>
  );
}

// ─── Recent-list helper ─────────────────────────────────────────────────────

function useRecentList<T>(lsKey: string): [T[], (item: T) => void, () => void] {
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

function RecentRow({ label, onClear, children }: { label: string; onClear: () => void; children: React.ReactNode }) {
  return (
    <div className="flex items-center flex-wrap gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-slate-400 mr-1">{label}</span>
      {children}
      <button type="button" onClick={onClear} className="ml-1 text-[10px] text-slate-400 hover:text-slate-700 hover:underline" title="clear recent">
        clear
      </button>
    </div>
  );
}

// ─── Gene-selection state — URL hash + localStorage ────────────────────────

function shareIdOf(g: Gene): number {
  return g.ncbiId ?? g.id;
}

export function splitFragment(raw: string): { route: string; params: string } {
  const frag = raw.replace(/^#/, "");
  if (!frag.startsWith("/")) return { route: "", params: frag };
  const i = frag.indexOf("#");
  return i === -1 ? { route: frag, params: "" } : { route: frag.slice(0, i), params: frag.slice(i + 1) };
}

function readGeneIdsFromHash(): number[] | null {
  if (typeof window === "undefined") return null;
  const { params } = splitFragment(window.location.hash);
  if (!params) return null;
  const raw = new URLSearchParams(params).get(GENES_HASH_KEY);
  if (!raw) return null;
  return raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
}

export function setFragmentParam(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  const { route, params } = splitFragment(window.location.hash);
  const p = new URLSearchParams(params);
  if (value === null || value === "") p.delete(key);
  else p.set(key, value);
  const next = p.toString();
  const frag = route ? (next ? `#${route}#${next}` : `#${route}`) : (next ? `#${next}` : "");
  window.history.replaceState({}, "", window.location.pathname + window.location.search + frag);
}

function writeGeneIdsToHash(ids: number[]): void {
  setFragmentParam(GENES_HASH_KEY, ids.length === 0 ? null : ids.join(","));
}

function readGoCuriesFromHash(): string[] | null {
  if (typeof window === "undefined") return null;
  const { params } = splitFragment(window.location.hash);
  if (!params) return null;
  const raw = new URLSearchParams(params).get(GO_HASH_KEY);
  if (!raw) return null;
  return raw.split(",").map((s) => toGoCurie(s.trim())).filter(Boolean);
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
      .map((p) => ({ curie: toGoCurie(p.curie), label: typeof p.label === "string" ? p.label : "" }));
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

async function resolveGeneIds(
  api: GeneExpressionApi,
  shareIds: number[],
  qc: QueryClient,
): Promise<Gene[]> {
  const out: Gene[] = [];
  const cached = new Map<number, Gene>();
  const index = (g: Gene) => {
    cached.set(g.id, g);
    if (g.ncbiId != null) cached.set(g.ncbiId, g);
  };
  const cache = qc.getQueryCache();
  for (const entry of cache.findAll({ queryKey: ["gene-expression:gene-search"] })) {
    const data = entry.state.data as Gene[] | undefined;
    if (!data) continue;
    for (const g of data) index(g);
  }
  for (const entry of cache.findAll({ queryKey: ["gene-expression:go-term-genes"] })) {
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
    let resolved: Gene | null = null;
    try {
      resolved = (await api.resolveGene?.(shareId)) ?? null;
    } catch {
      /* network error — fall through to placeholder */
    }
    out.push(resolved ?? { id: shareId });
  }
  return out;
}

function useGeneSelection(
  api: GeneExpressionApi,
  entityId: number,
): [Gene[], (updater: (cur: Gene[]) => Gene[]) => void, boolean] {
  const qc = useQueryClient();
  const lsKey = `${LS_PREFIX}${entityId}`;
  const initRan = useRef(false);
  const [selected, setSelectedState] = useState<Gene[]>([]);
  const [hydrated, setHydrated] = useState(() => {
    const ids = readGeneIdsFromHash() ?? readGeneIdsFromStorage(lsKey);
    return !ids || ids.length === 0;
  });

  useEffect(() => {
    if (initRan.current) return;
    initRan.current = true;
    const ids = readGeneIdsFromHash() ?? readGeneIdsFromStorage(lsKey);
    if (!ids || ids.length === 0) {
      setHydrated(true);
      return;
    }
    void resolveGeneIds(api, ids, qc).then((genes) => {
      setSelectedState(genes);
      setHydrated(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lsKey, qc, entityId]);

  useEffect(() => {
    if (!hydrated) return;
    const shareIds = selected.map(shareIdOf);
    writeGeneIdsToHash(shareIds);
    writeGeneIdsToStorage(lsKey, shareIds);
  }, [selected, lsKey, hydrated]);

  const setSelected = (updater: (cur: Gene[]) => Gene[]) => setSelectedState((cur) => updater(cur));

  return [selected, setSelected, hydrated];
}

function useGoSelection(
  api: GeneExpressionApi,
  entityId: number,
): [GoPick[], (updater: (cur: GoPick[]) => GoPick[]) => void, boolean] {
  const lsKey = `${GO_LS_PREFIX}${entityId}`;
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
      const labelled = new Map(stored?.map((p) => [p.curie, p.label]));
      setPicksState(fromHash.map((curie) => ({ curie, label: labelled.get(curie) ?? "" })));
      setHydrated(true);
      return;
    }
    if (stored && stored.length > 0) setPicksState(stored);
    setHydrated(true);
  }, [lsKey]);

  const resolving = useRef(new Set<string>());
  useEffect(() => {
    if (!hydrated || !api.resolveGoTermLabel) return;
    for (const p of picks) {
      if (p.label || resolving.current.has(p.curie)) continue;
      resolving.current.add(p.curie);
      void api.resolveGoTermLabel(p.curie).then((t) => {
        if (!t) return;
        setPicksState((cur) => cur.map((x) => (x.curie === p.curie ? { ...x, label: t.label } : x)));
      });
    }
  }, [picks, hydrated, api]);

  useEffect(() => {
    if (!hydrated) return;
    writeGoCuriesToHash(picks.map((p) => p.curie));
    writeGoPicksToStorage(lsKey, picks);
  }, [picks, lsKey, hydrated]);

  const setPicks = (updater: (cur: GoPick[]) => GoPick[]) => setPicksState((cur) => updater(cur));

  return [picks, setPicks, hydrated];
}

function useTermGenes(
  api: GeneExpressionApi,
  picks: GoPick[],
  taxon: string | undefined,
): { genes: Gene[]; origins: Record<number, GeneOrigin>; loading: boolean } {
  return useQueries({
    queries: picks.map((p) => ({
      queryKey: ["gene-expression:go-term-genes-expand", p.curie, taxon ?? "any", GO_TERM_GENE_CAP],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api.getGoTermGenes(p.curie, { taxon, limit: GO_TERM_GENE_CAP, signal }),
      staleTime: 30 * 60_000,
    })),
    combine: (results) => {
      const genes: Gene[] = [];
      const origins: Record<number, GeneOrigin> = {};
      const seen = new Set<number>();
      picks.forEach((p, i) => {
        for (const g of results[i]?.data?.data ?? []) {
          if (seen.has(g.id)) continue;
          seen.add(g.id);
          genes.push(g);
          origins[g.id] = { goUri: p.curie, goLabel: p.label || p.curie };
        }
      });
      return { genes, origins, loading: results.some((r) => r.isLoading || r.isPending) };
    },
  });
}
