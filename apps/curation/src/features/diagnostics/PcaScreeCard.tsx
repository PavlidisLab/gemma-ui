/**
 * PCA scree panel — curator-side wrapper. The scree bar chart lives
 * in @gemma/diagnostics's ScreeChart; the click-to-zoom PC-loadings
 * popup stays here because the data fetch + modal chrome are
 * app-specific (curation reads its snake_case wire via
 * @/api/diagnostics).
 */

import { useMemo, useState } from "react";
import { HeatmapWidget } from "@gemma/heatmap";
import type { HeatmapData } from "@gemma/heatmap";
import {
  PanelCard,
  PanelEmpty,
  PanelLoading,
  PanelError,
  ScreeChart,
  GeneRowsTable,
  type GeneRow,
} from "@gemma/diagnostics";
import { useDatasetSvd, usePcLoadings, type PcLoadings } from "@/api/diagnostics";

export function PcaScreeCard({
  experimentId,
}: {
  experimentId: number | string;
}) {
  const { data, isLoading, error } = useDatasetSvd(experimentId);
  const [openPc, setOpenPc] = useState<number | null>(null);

  let body;
  if (isLoading) {
    body = <PanelLoading />;
  } else if (error) {
    body = <PanelError message={(error as Error).message} />;
  } else if (!data || !data.variances || data.variances.length === 0) {
    body = (
      <PanelEmpty reason="No PCA available (HTTP 404 or empty variances). Either this dataset's SVDResult hasn't been computed, or the dataset has too few samples." />
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
              <span>click a bar → top-loaded genes on that PC</span>
              <span className="ml-auto">
                <a
                  href={`/rest/v2/datasets/${experimentId}/svd`}
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
          experimentId={experimentId}
          pc={openPc}
          onClose={() => setOpenPc(null)}
        />
      ) : null}
    </>
  );
}

/** Click-to-zoom popup. Cell = probe loading × sample score on PCN
 *  (rank-1 PC projection). Curation's wire uses snake_case fields;
 *  the wrapper normalises into the shared GeneRow shape and into
 *  HeatmapData. */
function PcLoadingsPopup({
  experimentId,
  pc,
  onClose,
}: {
  experimentId: number | string;
  pc: number;
  onClose: () => void;
}) {
  const { data, isLoading, error } = usePcLoadings(experimentId, pc, 50);

  const heatmap = useMemo<HeatmapData | null>(
    () => (data ? buildProjectionHeatmap(data) : null),
    [data],
  );

  const geneRows = useMemo<GeneRow[]>(() => {
    if (!data) return [];
    return data.rows.map((r, i) => ({
      index: i + 1,
      geneSymbol: r.gene_symbol,
      // Gene name / NCBI id pending backend enrichment of
      // /svd/loadings.
      geneOfficialName: null,
      geneNcbiId: null,
      geneId: null,
      designElementId: r.design_element_id,
      designElementName: r.design_element_name,
    }));
  }, [data]);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-800 rounded shadow-lg max-w-5xl w-full max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <span className="font-semibold text-slate-800 dark:text-slate-100">
            Top-loaded probes on PC{pc}
            {data ? (
              <span className="ml-2 text-[11px] font-normal text-slate-500 dark:text-slate-400">
                · cell = loading × sample score (rank-1 PC{pc} projection)
              </span>
            ) : null}
          </span>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
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
          ) : !data || !heatmap ? (
            <div className="text-xs text-slate-500 italic">
              No SVD loadings available for this experiment yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(0,360px)] gap-3 h-full">
              <div className="min-w-0">
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
                  defaultMaxHeight={14}
                  defaultMaxWidth={14}
                  defaultFitMode="squeeze"
                  downloadFilenameStem={`pc${pc}-loadings`}
                />
              </div>
              <GeneRowsTable
                rows={geneRows}
                caption={`${geneRows.length} probes · ordered by |loading| on PC${pc}`}
                maxHeightClass="max-h-[70vh]"
                // Curation talks to whichever Gemma instance is configured
                // for the session; the legacy gene page URL is universal.
                geneHref={(r) =>
                  r.geneNcbiId != null
                    ? `/gene/showGene.html?ncbiId=${r.geneNcbiId}`
                    : r.geneId != null
                      ? `/gene/showGene.html?id=${r.geneId}`
                      : null
                }
                probeHref={(r) =>
                  r.designElementId != null
                    ? `/arrays/compositeSequence/show.html?id=${r.designElementId}`
                    : null
                }
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Build the rank-1 projection matrix from PC loadings + sample
 *  scores. Cell[r][c] = rows[r].loading × bio_assay_scores[c]. */
function buildProjectionHeatmap(d: PcLoadings): HeatmapData {
  const sampleEntries = Object.entries(d.bio_assay_scores);
  const colLabels = sampleEntries.map(([id]) => id);
  const sampleScores = sampleEntries.map(([, score]) => score);
  const rowLabels = d.rows.map(
    (r, i) =>
      r.gene_symbol ||
      r.design_element_name ||
      (r.design_element_id != null
        ? `probe ${r.design_element_id}`
        : `row ${i + 1}`),
  );
  const values: (number | null)[][] = d.rows.map((r) =>
    sampleScores.map((s) => r.loading * s),
  );
  return { rowLabels, colLabels, values };
}
