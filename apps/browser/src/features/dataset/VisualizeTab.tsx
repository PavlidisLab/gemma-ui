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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HeatmapWidget, type HeatmapPayload } from "@gemma/heatmap";
import {
  searchGenes,
  getHeatmapData,
  type Gene,
  type HeatmapWireResponse,
} from "@/api/endpoints";
import type { Dataset } from "@/lib/types";

const GENES_HASH_KEY = "genes";
const LS_PREFIX = "gemma-visualize-genes:";

type PickerMode = "symbol" | "go";

export function VisualizeTab({ dataset }: { dataset: Dataset }) {
  const datasetId = dataset.id;
  const taxon = dataset.taxon?.commonName?.toLowerCase() ?? undefined;

  // ── selected genes — client-only state, URL-hash + localStorage backed.
  const [selected, setSelected] = useGeneSelection(datasetId);
  const [mode, setMode] = useState<PickerMode>("symbol");

  return (
    <div className="space-y-4">
      {/* Picker header + mode tabs */}
      <section className="bg-white border border-slate-200 rounded">
        <header className="px-4 py-2 border-b border-slate-200 flex items-baseline justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold tracking-wide">
              Visualise expression
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Build a custom gene set and render the heatmap. Selection is
              held in the URL — share the link to share the view.
            </p>
          </div>
          <PickerModeTabs mode={mode} onChange={setMode} />
        </header>
        <div className="px-4 py-3">
          {mode === "symbol" ? (
            <GenePickerBySymbol
              taxon={taxon}
              alreadySelected={selected.map((g) => g.id)}
              onAdd={(gene) =>
                setSelected((cur) =>
                  cur.some((g) => g.id === gene.id) ? cur : [...cur, gene],
                )
              }
            />
          ) : (
            <GenePickerByGoComingSoon />
          )}
        </div>
        <SelectedGenesStrip
          genes={selected}
          onRemove={(id) =>
            setSelected((cur) => cur.filter((g) => g.id !== id))
          }
          onClear={() => setSelected(() => [])}
        />
      </section>

      {/* Heatmap render */}
      <HeatmapPanel
        datasetId={datasetId}
        genes={selected}
      />
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
  onAdd,
}: {
  taxon: string | undefined;
  alreadySelected: number[];
  onAdd: (gene: Gene) => void;
}) {
  const [query, setQuery] = useState("");
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

  const candidates = (results.data ?? []).filter((g) => !already.has(g.id));

  return (
    <div className="flex flex-col gap-2">
      <label className="block">
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
      {trimmed.length >= 2 ? (
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
                  className="px-3 py-1.5 flex items-baseline justify-between gap-3 hover:bg-slate-50"
                >
                  <span className="min-w-0">
                    <span className="font-mono font-semibold text-slate-900">
                      {g.officialSymbol ?? `#${g.id}`}
                    </span>
                    {g.officialName ? (
                      <span className="ml-2 text-xs text-slate-500 truncate inline-block max-w-[28ch] align-bottom">
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
                      onAdd(g);
                      setQuery("");
                    }}
                    className="text-xs px-2 py-0.5 border border-slate-300 rounded hover:bg-slate-900 hover:text-white hover:border-slate-900"
                  >
                    + add
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

// ─── GO-term picker — coming-soon placeholder ────────────────────────────────

function GenePickerByGoComingSoon() {
  return (
    <div className="text-xs text-slate-500 leading-relaxed border border-dashed border-slate-300 rounded p-3 bg-slate-50">
      <p className="mb-1.5 font-medium text-slate-700">
        GO-term picker — pending backend support
      </p>
      <p>
        Reverse GO→genes lookup ({" "}
        <code className="px-1 bg-slate-100 rounded">/go-terms/{"{uri}"}/genes</code>
        ) doesn't ship yet on the Gemma REST API. When it does, this tab
        will browse genes within a GO term and let you add individual
        ones — never the full list (a typical GO term covers hundreds of
        genes and the heatmap can't sensibly display that many at once).
      </p>
    </div>
  );
}

// ─── Selected gene chips ─────────────────────────────────────────────────────

function SelectedGenesStrip({
  genes,
  onRemove,
  onClear,
}: {
  genes: Gene[];
  onRemove: (id: number) => void;
  onClear: () => void;
}) {
  if (genes.length === 0) return null;
  return (
    <div className="border-t border-slate-200 px-4 py-2 flex items-center gap-2 flex-wrap">
      <span className="text-[10px] uppercase tracking-wide text-slate-500 mr-1">
        {genes.length} {genes.length === 1 ? "gene" : "genes"}
      </span>
      {genes.map((g) => (
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
}: {
  datasetId: number;
  genes: Gene[];
}) {
  const geneIds = useMemo(() => genes.map((g) => g.id), [genes]);
  const wireQuery = useQuery({
    queryKey: ["heatmap-data", datasetId, geneIds.join(",")],
    queryFn: ({ signal }) =>
      getHeatmapData(datasetId, { genes: geneIds }, signal),
    enabled: geneIds.length > 0,
    staleTime: 60_000,
  });

  if (genes.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded px-6 py-10 text-center text-sm text-slate-500">
        Search and add genes above to render the heatmap.
      </div>
    );
  }

  if (wireQuery.isLoading) {
    return (
      <div className="bg-white border border-slate-200 rounded px-6 py-10 text-center text-sm text-slate-500">
        loading expression matrix…
      </div>
    );
  }

  const wire = wireQuery.data;
  if (!wire || wire.rows.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded px-6 py-10 text-center text-sm text-slate-500">
        No expression data returned for the selected genes on this dataset.
        Either the platform doesn't carry probes for these genes, or the
        backend ACL is filtering them.
      </div>
    );
  }

  const payload = adaptHeatmapWire(wire);
  return (
    <div className="bg-white border border-slate-200 rounded p-2">
      <HeatmapWidget payload={payload} />
    </div>
  );
}

// ─── Wire-to-HeatmapPayload adapter ──────────────────────────────────────────

function adaptHeatmapWire(wire: HeatmapWireResponse): HeatmapPayload {
  return {
    datasetId: wire.datasetId,
    matrix: {
      values: wire.matrix.values,
      rows: wire.matrix.rowsCount,
      cols: wire.matrix.colsCount,
      quantitationType: {
        name: wire.matrix.quantitationType.name,
        isPreferred: wire.matrix.quantitationType.isPreferred,
        isRatio: wire.matrix.quantitationType.isRatio,
        scale: wire.matrix.quantitationType.scale,
      },
    },
    rows: wire.rows.map((r) => ({
      designElementId: r.designElementId,
      designElementName: r.designElementName,
      geneIds: (r.genes ?? []).map((g) => g.id),
      geneSymbols: (r.genes ?? []).map((g) => g.officialSymbol ?? ""),
    })),
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
 *     so the URL is shareable (refresh / copy-paste restores).
 *   - Mirrors to ``localStorage`` keyed by datasetId so a same-
 *     browser revisit restores the last selection even without
 *     the hash.
 *   - Rehydrates Gene metadata (symbol / name) from the cache
 *     populated by the search query; uncached ids fall back to
 *     a per-id fetch.
 */
function useGeneSelection(datasetId: number): [
  Gene[],
  (updater: (cur: Gene[]) => Gene[]) => void,
] {
  const qc = useQueryClient();
  const lsKey = `${LS_PREFIX}${datasetId}`;
  const initRan = useRef(false);
  const [selected, setSelectedState] = useState<Gene[]>([]);

  // First-paint hydrate: URL hash wins, then localStorage.
  useEffect(() => {
    if (initRan.current) return;
    initRan.current = true;
    const ids = readGeneIdsFromHash() ?? readGeneIdsFromStorage(lsKey);
    if (!ids || ids.length === 0) return;
    void resolveGeneIds(ids, qc).then((genes) => {
      setSelectedState(genes);
    });
  }, [lsKey, qc]);

  // Persist on change.
  useEffect(() => {
    if (!initRan.current) return;
    writeGeneIdsToHash(selected.map((g) => g.id));
    writeGeneIdsToStorage(lsKey, selected.map((g) => g.id));
  }, [selected, lsKey]);

  const setSelected = (updater: (cur: Gene[]) => Gene[]) => {
    setSelectedState((cur) => updater(cur));
  };

  return [selected, setSelected];
}

function readGeneIdsFromHash(): number[] | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const raw = params.get(GENES_HASH_KEY);
  if (!raw) return null;
  return raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function writeGeneIdsToHash(ids: number[]): void {
  if (typeof window === "undefined") return;
  const hash = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  if (ids.length === 0) {
    params.delete(GENES_HASH_KEY);
  } else {
    params.set(GENES_HASH_KEY, ids.join(","));
  }
  const next = params.toString();
  const newUrl =
    window.location.pathname +
    window.location.search +
    (next ? "#" + next : "");
  window.history.replaceState({}, "", newUrl);
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

/** Resolve a list of gene ids to full Gene records — checks the
 *  TanStack cache first (populated by typeahead queries), then
 *  falls back to a per-id fetch via /genes/{id}. */
async function resolveGeneIds(
  ids: number[],
  qc: ReturnType<typeof useQueryClient>,
): Promise<Gene[]> {
  const out: Gene[] = [];
  const cached = new Map<number, Gene>();
  // Sweep cached gene-search results for matches.
  const cache = qc.getQueryCache();
  for (const entry of cache.findAll({ queryKey: ["gene-search"] })) {
    const data = entry.state.data as Gene[] | undefined;
    if (!data) continue;
    for (const g of data) cached.set(g.id, g);
  }
  for (const id of ids) {
    const hit = cached.get(id);
    if (hit) {
      out.push(hit);
      continue;
    }
    // Fall back to a single-id fetch. Skip on error so we don't
    // block the whole restore on one missing gene.
    try {
      const r = await fetch(`/rest/v2/genes/${id}`).then((res) => res.json());
      const g: Gene | undefined = r?.data?.[0];
      if (g) out.push(g);
    } catch {
      /* ignore */
    }
  }
  return out;
}

// ─── Tiny local-only debounce hook ───────────────────────────────────────────

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}
