/**
 * PCA scree panel — curator-side wrapper. The scree bar chart lives
 * in @gemma/diagnostics's ScreeChart; the click-to-zoom PC-loadings
 * popup stays here because the data fetch + modal chrome are
 * app-specific (curation reads its snake_case wire via
 * @/api/diagnostics).
 */

import { useMemo, useState } from "react";
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
import { useDatasetSvd, usePcLoadings, type PcLoadings } from "@/api/diagnostics";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import { buildDesignHeatmapPayload } from "./heatmapPayload";
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
  const { data, isLoading, error } = usePcLoadings(experimentId, pc, 50);
  // Same source of truth as every other design-data panel: the draft,
  // so the strips show what the curator is looking at.
  const { draft } = useDesignDraft();
  const [groupBy, setGroupBy] = useState<number | null>(null);
  // The popup is only mounted while open, so the listener is too.
  useEscapeKey(true, onClose);

  const heatmap = useMemo<HeatmapData | null>(
    () => (data ? buildProjectionHeatmap(data) : null),
    [data],
  );

  // Columns here are bioAssays, exactly as on the correlation matrix,
  // so the same builder annotates them. Rows are probes and are ordered
  // by |loading| — that ordering is the point of the panel and the
  // widget never touches rows, so unlike the correlation matrix there
  // is no second axis to keep in step.
  const payload = useMemo(() => {
    if (!heatmap || !data) return null;
    return buildDesignHeatmapPayload({
      design: draft,
      bioAssayIds: Object.keys(data.bio_assay_scores),
      values: heatmap.values,
      colLabels: heatmap.colLabels ?? [],
      // The gutter has to travel INSIDE the payload: the widget builds
      // its matrix from a payload and ignores the sibling `data`, so
      // labels passed only on `data` disappear as soon as strips are on.
      rows: (heatmap.rowLabelColumns ?? []).map((c, i) => ({
        symbol: c[0] ?? "",
        name: c[1] ?? "",
        designElementId: data.rows[i]?.design_element_id ?? null,
      })),
      datasetId: Number(experimentId) || 0,
    });
  }, [heatmap, data, draft, experimentId]);


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
            // One column now. The probe list used to sit beside the
            // matrix repeating what the row gutter says; with real gene
            // labels in the gutter it was the same 50 names twice, and
            // the half-width it cost was coming out of the matrix.
            <div className="h-full">
              <div className="min-w-0">
                <HeatmapWidget
                  {...(payload ? { payload } : { data: heatmap })}
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
                  // Cells big enough to read beside a gene gutter,
                  // matching the browser's copy of this popup. At 14px
                  // with no labels this was 50 anonymous stripes.
                  defaultMaxHeight={22}
                  defaultMaxWidth={18}
                  rowLabelGutterWidth={260}
                  // Every cell of a rank-1 projection exists, so a
                  // blank gutter between design groups would read as
                  // missing data. Same call as the correlation matrix.
                  showGroupGaps={false}
                  // Strip stacking is deterministic
                  // (`orderFactorsForDisplay`), so the two panels agree
                  // on the order for free; the SELECTION is state, and
                  // this popup owns its own — there is no sibling view
                  // of the same matrix to drift from.
                  defaultMainGroupingFactorId={groupBy}
                  onMainGroupingFactorChange={setGroupBy}
                  defaultFitMode="squeeze"
                  downloadFilenameStem={`pc${pc}-loadings`}
                />
              </div>
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
  // `probeRowLabel` is the shared resolver the browser's copy of this
  // popup and the expression heatmap both use — one place decides how a
  // probe is named, so the same probe cannot read three ways in three
  // panels. It wants the camel shape and `client.ts` snakeifies the
  // response, so the genes are mapped across rather than a second
  // labelling rule being written beside it.
  const labels = d.rows.map((r) =>
    probeRowLabel({
      genes: (r.genes ?? []).map((g) => ({
        id: g.id ?? 0,
        officialSymbol: g.official_symbol ?? null,
        name: g.name ?? null,
        ncbiId: g.ncbi_id ?? null,
      })),
      designElementName: r.design_element_name ?? null,
      designElementId: r.design_element_id ?? null,
    }),
  );
  const rowLabels = labels.map((l) => l.symbol);
  const rowLabelColumns = labels.map((l) => [l.symbol, l.name]);
  const values: (number | null)[][] = d.rows.map((r) =>
    sampleScores.map((s) => r.loading * s),
  );
  return { rowLabels, rowLabelColumns, colLabels, values };
}
