/**
 * PCA scree panel — curator-side wrapper. The scree bar chart lives
 * in @gemma/diagnostics's ScreeChart; the click-to-zoom PC-loadings
 * popup stays here because the data fetch + modal chrome are
 * app-specific (curation reads its snake_case wire via
 * @/api/diagnostics).
 */

import { useMemo, useState } from "react";
import { HeatmapWidget } from "@gemma/heatmap";
import {
  PanelCard,
  PanelEmpty,
  PanelLoading,
  PanelError,
  ScreeChart,
  MAX_LOADED_PC,
} from "@gemma/diagnostics";
import { useDatasetSvd } from "@/api/diagnostics";
import { usePcaHeatmapData, withPcScoreStrip } from "@/api/heatmapData";
import { useQcMetrics } from "@/api/qcMetrics";
import { withQcMetricStrips } from "./heatmapPayload";
import { useEscapeKey } from "@gemma/ui";

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
    // Only the first MAX_LOADED_PC bars open a popup — Gemma persists
    // loadings for those components alone, and `/svd/loadings?pc=6`
    // answers 200 with an empty row list rather than an error, so the
    // popup opened onto "No SVD loadings available for this experiment
    // yet." That named the wrong cause: the experiment has loadings,
    // just not for that component.
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
                click a bar (PC1–{MAX_LOADED_PC}) → top-loaded genes on that PC
              </span>
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
  // 🛑 The DATA for these genes, not a projection of them. This used to
  // fetch /svd/loadings and draw `loading × sample score` — the outer
  // product of two vectors, so every column was a scaled copy of one
  // pattern by construction. `heatmap-data?pcaComponent=N` returns the
  // top-loaded probes' actual expression, plus the sample columns and
  // the factors for the strips, in one request. Same endpoint the
  // browser's Visualize tab uses (Paul, 2026-09-02).
  const { data: raw, isLoading, error } = usePcaHeatmapData(
    experimentId,
    pc,
    50,
  );
  // The component's own sample scores, drawn as a continuous strip
  // above the design ones — same columns, same order, so the reader can
  // line up "what the PC saw" against "what the genes did".
  const { data: svd } = useDatasetSvd(experimentId);
  const scores = useMemo(() => {
    if (!svd?.bio_assay_ids || !svd?.vmatrix || pc == null) return null;
    const out: Record<number, number> = {};
    for (let i = 0; i < svd.bio_assay_ids.length; i++) {
      const v = svd.vmatrix[i]?.[pc - 1];
      if (typeof v === "number") out[svd.bio_assay_ids[i]] = v;
    }
    return out;
  }, [svd, pc]);
  // The sequencing QC strips ride here too — Paul, 2026-09-02: *"show
  // these qc metrics in the pc plot too."* Same columns, same order, so
  // "what the component saw" can be read against "how well the sample
  // sequenced" without leaving the popup.
  const { data: qc } = useQcMetrics(experimentId);
  const payload = useMemo(
    () => withQcMetricStrips(withPcScoreStrip(raw ?? null, pc, scores), qc),
    [raw, pc, scores, qc],
  );
  const [groupBy, setGroupBy] = useState<number | null>(null);
  useEscapeKey(true, onClose);

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
            {payload ? (
              <span className="ml-2 text-[11px] font-normal text-slate-500 dark:text-slate-400">
                · expression, row-scaled · {payload.rows.length} probes ordered
                by loading on PC{pc}
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
          ) : !payload ? (
            <div className="text-xs text-slate-500 italic">
              No expression data available for this experiment yet.
            </div>
          ) : (
            // One column now. The probe list used to sit beside the
            // matrix repeating what the row gutter says; with real gene
            // labels in the gutter it was the same 50 names twice, and
            // the half-width it cost was coming out of the matrix.
            <div className="h-full">
              <div className="min-w-0">
                <HeatmapWidget
                  payload={payload}
                  chrome={false}
                  showControls
                  showLegend
                  showTooltip
                  showDownload
                  defaultPalette="ambsky"
                  // Row-scaled: raw expression across 50 genes spans
                  // orders of magnitude, and the pattern the component
                  // picked up is what the reader is here for. The
                  // widget's own toggle is available in this popup.
                  defaultRowScale
                  defaultClip={3}
                  // Cells big enough to read beside a gene gutter,
                  // matching the browser's copy of this popup. At 14px
                  // with no labels this was 50 anonymous stripes.
                  defaultMaxHeight={22}
                  defaultMaxWidth={18}
                  rowLabelGutterWidth={260}
                  // Every cell exists, so a blank gutter between design
                  // groups would read as missing data. Same call as the
                  // correlation matrix.
                  showGroupGaps={false}
                  // Strip stacking is deterministic
                  // (`orderFactorsForDisplay`), so the two panels agree
                  // on the order for free; the SELECTION is state, and
                  // this popup owns its own — there is no sibling view
                  // of the same matrix to drift from.
                  defaultMainGroupingFactorId={groupBy}
                  onMainGroupingFactorChange={setGroupBy}
                  defaultFitMode="squeeze"
                  downloadFilenameStem={`pc${pc}-expression`}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
