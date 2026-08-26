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
  getDatasetPlatforms,
} from "@/api/endpoints";
import { ProbeRowTooltip } from "@/features/dataset/ProbeRowTooltip";
import { restUrl } from "@/api/base";

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
  // Probe links need a platform. One ⇒ unambiguous; several ⇒ a row's
  // design element could be on any of them, so no probe link.
  const platformsQ = useQuery({
    queryKey: ["datasetPlatforms", datasetId],
    queryFn: ({ signal }) => getDatasetPlatforms(datasetId, signal),
    staleTime: 30 * 60_000,
  });
  const platformShortName =
    platformsQ.data?.length === 1
      ? (platformsQ.data[0].shortName ?? undefined)
      : undefined;

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
                  return (
                    <ProbeRowTooltip
                      designElementName={
                        r.designElementName ?? `probe ${r.designElementId ?? "?"}`
                      }
                      designElementId={r.designElementId}
                      genes={r.genes ?? []}
                      platformShortName={platformShortName}
                    />
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
