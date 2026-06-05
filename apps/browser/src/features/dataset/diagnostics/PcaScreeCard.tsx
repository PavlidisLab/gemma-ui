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
import { HeatmapWidget } from "@gemma/heatmap";
import type { HeatmapData } from "@gemma/heatmap";
import {
  PanelCard,
  PanelEmpty,
  PanelLoading,
  PanelError,
  ScreeChart,
} from "@gemma/diagnostics";
import { getDatasetSvd, getPcLoadings } from "@/api/endpoints";
import { geneUrl, compositeSequenceUrl } from "@/lib/gemmaConfig";

export function PcaScreeCard({ datasetId }: { datasetId: number }) {
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
    body = <ScreeChart variances={data.variances} onBarClick={setOpenPc} />;
  }

  return (
    <>
      <PanelCard
        title="PCA scree"
        footer={
          data?.variances ? (
            <>
              <span>click a bar → top-loaded probes on that PC</span>
              <span className="ml-auto">
                <a
                  href={`/rest/v2/datasets/${datasetId}/svd`}
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
          onClose={() => setOpenPc(null)}
        />
      ) : null}
    </>
  );
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
  onClose,
}: {
  datasetId: number;
  pc: number;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["pc-loadings", datasetId, pc],
    queryFn: ({ signal }) => getPcLoadings(datasetId, pc, { top: 50, signal }),
    staleTime: 5 * 60_000,
  });

  const heatmap = useMemo<HeatmapData | null>(() => {
    if (!data || !data.rows.length) return null;
    const sampleEntries = Object.entries(data.bioAssayScores ?? {});
    if (sampleEntries.length === 0) return null;
    const colLabels = sampleEntries.map(([id]) => id);
    const sampleScores = sampleEntries.map(([, s]) => s);
    // Inline label columns: [gene symbol, gene official name].
    // Probe id is intentionally NOT inline — only the tooltip
    // surfaces it (along with NCBI / Gemma links). When the gene
    // isn't mapped, the symbol column falls back to the probe name
    // so the row still has a visible identifier.
    const rowLabelColumns = data.rows.map((r, i) => [
      r.geneSymbol ||
        r.designElementName ||
        (r.designElementId != null ? `probe ${r.designElementId}` : `row ${i + 1}`),
      r.geneOfficialName ?? "",
    ]);
    const rowLabels = rowLabelColumns.map((cols) =>
      cols.filter(Boolean).join(" · "),
    );
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
                  const gHref =
                    r.geneNcbiId != null || r.geneId != null
                      ? geneUrl({ ncbiId: r.geneNcbiId, geneId: r.geneId })
                      : null;
                  const pHref =
                    r.designElementId != null
                      ? compositeSequenceUrl(r.designElementId)
                      : null;
                  return (
                    <div className="space-y-1">
                      {r.geneSymbol ? (
                        <div className="font-semibold text-slate-800">
                          {r.geneSymbol}
                        </div>
                      ) : null}
                      {r.geneOfficialName ? (
                        <div className="text-slate-600">{r.geneOfficialName}</div>
                      ) : null}
                      <div className="text-[10px] text-slate-500 font-mono">
                        {r.designElementName ?? `probe ${r.designElementId ?? "?"}`}
                      </div>
                      <div className="flex gap-3 pt-1 text-[11px]">
                        {gHref ? (
                          <a
                            href={gHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sky-700 hover:underline"
                          >
                            NCBI Gene ↗
                          </a>
                        ) : null}
                        {pHref ? (
                          <a
                            href={pHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sky-700 hover:underline"
                          >
                            Gemma probe ↗
                          </a>
                        ) : null}
                      </div>
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
