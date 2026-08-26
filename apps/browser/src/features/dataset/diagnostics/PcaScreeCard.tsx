/**
 * PCA scree panel — browser-side wrapper. The scree bar chart lives
 * in @gemma/diagnostics; the click-to-zoom popup (HeatmapWidget fed
 * by /svd/loadings) stays here because the data source + modal
 * chrome are app-specific. The dedicated GeneRowsTable side panel
 * was retired 2026-05-27; its info (symbol / official name / probe
 * id) is now baked into the heatmap row labels directly.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { HeatmapWidget, probeRowLabel } from "@gemma/heatmap";
import type { HeatmapData } from "@gemma/heatmap";
import {
  PanelCard,
  PanelEmpty,
  PanelLoading,
  PanelError,
  ScreeChart,
  MAX_LOADED_PC,
} from "@gemma/diagnostics";
import {
  getDatasetSvd,
  getPcLoadings,
  getTaxonGenesBySymbols,
  type PcLoadings,
} from "@/api/endpoints";
import { compositeSequenceUrl } from "@/lib/gemmaConfig";
import { restUrl } from "@/api/base";

export function PcaScreeCard({
  datasetId,
  taxon,
}: {
  datasetId: number;
  /** Dataset's organism as a REST param. Needed to turn the loadings'
   *  Gemma-internal gene ids into the NCBI ids the gene page is keyed
   *  by — see ``useNcbiIdsByGeneId``. Without it the row tooltip still
   *  names every gene, just without links. */
  taxon?: string;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["datasetSvd", datasetId],
    queryFn: ({ signal }) => getDatasetSvd(datasetId, signal),
    staleTime: 10 * 60_000,
  });
  const [openPc, setOpenPc] = useState<number | null>(null);

  let body;
  if (isLoading) {
    body = <PanelLoading />;
  } else if (error) {
    body = <PanelError message={(error as Error).message} />;
  } else if (!data || !data.variances || data.variances.length === 0) {
    body = (
      <PanelEmpty reason="No PCA available. Either this dataset's SVDResult hasn't been computed, or the dataset has too few samples." />
    );
  } else {
    // Only the first MAX_LOADED_PC bars open a popup. Gemma persists
    // loadings for those components alone, and `/svd/loadings?pc=6`
    // answers 200 with `rows: []` rather than an error — so the popup
    // opened onto "No SVD loadings available for this dataset yet.",
    // which named the wrong cause: the dataset has loadings, just not
    // for that component.
    body = (
      <ScreeChart
        variances={data.variances}
        onBarClick={setOpenPc}
        maxClickablePc={MAX_LOADED_PC}
      />
    );
  }

  return (
    <>
      <PanelCard
        title="PCA scree"
        footer={
          data?.variances ? (
            <>
              <span>
                click a bar (PC1–{MAX_LOADED_PC}) → top-loaded probes on that PC
              </span>
              <span className="ml-auto">
                <a
                  href={restUrl(`/datasets/${datasetId}/svd`)}
                  className="text-blue-700 dark:text-blue-300 hover:underline"
                  download
                  title="raw SVD JSON (eigenvalues + per-PC scores)"
                >
                  download eigengenes ↓
                </a>
              </span>
            </>
          ) : null
        }
      >
        {body}
      </PanelCard>
      {openPc !== null ? (
        <PcLoadingsPopup
          datasetId={datasetId}
          pc={openPc}
          taxon={taxon}
          onClose={() => setOpenPc(null)}
        />
      ) : null}
    </>
  );
}

/**
 * Gemma-internal gene id → NCBI gene id, for every gene the popup's
 * rows mention.
 *
 * The in-app gene page is keyed by NCBI id (symbols collide across
 * taxa), but ``/svd/loadings`` rows carry only Gemma's internal id,
 * and ``/genes/{internalId}`` doesn't answer for it. The taxon-scoped
 * symbol lookup returns both ids, so one batched call over the
 * popup's distinct symbols bridges the gap — 50 rows, one request,
 * cached for the session.
 *
 * Returns an empty map while in flight, with no taxon to scope by, or
 * on failure: the tooltip then names every gene and simply omits the
 * links, which beats linking somewhere plausible and wrong.
 */
function useNcbiIdsByGeneId(
  data: PcLoadings | null | undefined,
  taxon: string | undefined,
): Map<number, number> {
  const symbols = useMemo(() => {
    const out = new Set<string>();
    for (const r of data?.rows ?? []) {
      for (const g of r.genes ?? []) if (g.officialSymbol) out.add(g.officialSymbol);
    }
    return Array.from(out).sort();
  }, [data]);

  const q = useQuery({
    queryKey: ["taxon-genes-by-symbol", taxon ?? "", symbols.join(",")],
    queryFn: ({ signal }) => getTaxonGenesBySymbols(taxon!, symbols, signal),
    enabled: !!taxon && symbols.length > 0,
    staleTime: 30 * 60_000,
  });

  return useMemo(() => {
    const m = new Map<number, number>();
    // Key on the internal id the lookup echoes back, not on the symbol
    // we sent — exact, and immune to case / alias mismatches.
    for (const g of q.data ?? []) {
      if (g.ncbiId != null) m.set(g.id, g.ncbiId);
    }
    return m;
  }, [q.data]);
}

/**
 * Click-to-zoom popup. Cell = probe loading × sample score on PCN
 * (rank-1 PC projection) — what PC-N "sees" as the signal. Sign and
 * magnitude both matter, so the widget gets a diverging palette. Row
 * labels bake in gene symbol / official name / probe id per row —
 * previously surfaced via a side GeneRowsTable (retired 2026-05-27).
 */
function PcLoadingsPopup({
  datasetId,
  pc,
  taxon,
  onClose,
}: {
  datasetId: number;
  pc: number;
  taxon?: string;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["pc-loadings", datasetId, pc],
    queryFn: ({ signal }) => getPcLoadings(datasetId, pc, { top: 50, signal }),
    staleTime: 5 * 60_000,
  });
  const ncbiIdByGeneId = useNcbiIdsByGeneId(data, taxon);

  const heatmap = useMemo<HeatmapData | null>(() => {
    if (!data || !data.rows.length) return null;
    const sampleEntries = Object.entries(data.bioAssayScores ?? {});
    if (sampleEntries.length === 0) return null;
    const colLabels = sampleEntries.map(([id]) => id);
    const sampleScores = sampleEntries.map(([, s]) => s);
    // Inline label columns: [gene symbol(s), gene official name(s)].
    // Probe id is intentionally NOT inline — only the tooltip
    // surfaces it (along with the gene links).
    //
    // ``probeRowLabel`` is the same function the expression heatmap
    // labels its gutter with, so a probe reads identically on both:
    // all matched genes named (``A;B``) rather than just the first,
    // and the same fallback to the probe's own name when it maps to
    // nothing. No search drives this view — it's the top loadings on a
    // PC, not a gene query — so the default empty ``queried`` set is
    // right: every mapped gene is named, no row marked non-specific.
    const labels = data.rows.map((r) => probeRowLabel(r));
    const rowLabelColumns = labels.map((l) => [l.symbol, l.name]);
    // Symbol alone, matching the expression heatmap — this is what the
    // TSV export and the cell-hover title use, and the two heatmaps
    // shouldn't format the same probe two different ways.
    const rowLabels = labels.map((l) => l.symbol);
    const values: (number | null)[][] = data.rows.map((r) =>
      sampleScores.map((s) => r.loading * s),
    );
    return { rowLabels, rowLabelColumns, colLabels, values };
  }, [data]);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-white rounded shadow-lg max-w-[95vw] max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
          <span className="font-semibold text-slate-800">
            Top-loaded probes on PC{pc}
            {heatmap ? (
              <span className="ml-2 text-[11px] font-normal text-slate-500">
                · cell = loading × sample score (rank-1 PC{pc} projection)
              </span>
            ) : null}
          </span>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-700"
            onClick={onClose}
            aria-label="close"
          >
            ×
          </button>
        </div>
        <div className="flex-1 min-h-[400px] overflow-auto p-3">
          {isLoading ? (
            <div className="text-xs text-slate-500 italic">loading…</div>
          ) : error ? (
            <div className="text-xs text-rose-700">{(error as Error).message}</div>
          ) : !heatmap ? (
            <div className="text-xs text-slate-500 italic">
              No SVD loadings available for this dataset yet.
            </div>
          ) : (
            <div className="h-full min-w-0">
              <HeatmapWidget
                data={heatmap}
                chrome={false}
                showControls
                showLegend
                showTooltip
                showDownload
                defaultPalette="ambsky"
                defaultClip={
                  Math.max(...heatmap.values.flat().map((v) => Math.abs(v ?? 0))) || 1
                }
                defaultRowScale={false}
                defaultMaxHeight={22}
                defaultMaxWidth={18}
                rowLabelGutterWidth={260}
                defaultFitMode="squeeze"
                downloadFilenameStem={`pc${pc}-loadings`}
                rowLabelTooltip={(i) => {
                  const r = data?.rows[i];
                  if (!r) return null;
                  const rowGenes = r.genes ?? [];
                  const pHref =
                    r.designElementId != null
                      ? compositeSequenceUrl(r.designElementId)
                      : null;
                  return (
                    <div className="space-y-1">
                      {/* One block per mapped gene — a probe can span
                          several, and collapsing them to the first hid
                          exactly the ambiguity worth seeing here. */}
                      {rowGenes.map((g) => {
                        // In-app gene page, keyed by NCBI id. The
                        // loadings rows carry only Gemma-internal ids,
                        // so the link waits on the resolve below — and
                        // is simply absent for a gene it can't map,
                        // rather than pointing somewhere wrong.
                        const ncbiId = ncbiIdByGeneId.get(g.id);
                        return (
                          <div key={g.id}>
                            <span className="font-semibold text-slate-800">
                              {g.officialSymbol || `gene ${g.id}`}
                            </span>
                            {ncbiId != null ? (
                              <Link
                                to="/gene/ncbi/$ncbiId"
                                params={{ ncbiId: String(ncbiId) }}
                                className="ml-2 text-[11px] text-sky-700 hover:underline"
                              >
                                gene page →
                              </Link>
                            ) : null}
                            {g.name ? (
                              <div className="text-slate-600">{g.name}</div>
                            ) : null}
                          </div>
                        );
                      })}
                      {rowGenes.length === 0 ? (
                        <div className="text-slate-500 italic">
                          probe maps to no gene
                        </div>
                      ) : null}
                      <div className="text-[10px] text-slate-500 font-mono">
                        {r.designElementName ?? `probe ${r.designElementId ?? "?"}`}
                      </div>
                      {pHref ? (
                        <div className="pt-1 text-[11px]">
                          <a
                            href={pHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sky-700 hover:underline"
                          >
                            Gemma probe ↗
                          </a>
                        </div>
                      ) : null}
                    </div>
                  );
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
