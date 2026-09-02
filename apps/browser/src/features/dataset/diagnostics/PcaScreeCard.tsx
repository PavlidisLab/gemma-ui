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
  getHeatmapData,
  getDatasetPlatforms,
} from "@/api/endpoints";
import { ProbeRowTooltip } from "@/features/dataset/ProbeRowTooltip";
import { restUrl } from "@/api/base";
import { useEscapeKey } from "@gemma/ui";
import { adaptHeatmapWire } from "../VisualizeTab";

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
 * Click-to-zoom popup: the EXPRESSION of the probes that load highest
 * on PCN, not a projection of them.
 *
 * 🛑 It used to draw `loading × sample score` — the outer product of
 * two vectors, so every column was a scaled copy of one pattern by
 * construction. That shows the shape of the component, never the data
 * of the genes driving it (Paul, 2026-09-02).
 * `heatmap-data?pcaComponent=N` returns those probes' real expression
 * plus the sample columns and the design factors, in one request; the
 * component's own sample scores ride above as a continuous strip.
 * Mirrors the curation app's copy — same endpoint, caption and layout.
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
  // The popup is only mounted while open, so the listener is too.
  useEscapeKey(true, onClose);
  const { data: wire, isLoading, error } = useQuery({
    queryKey: ["heatmap-data", "pca", datasetId, pc],
    queryFn: ({ signal }) =>
      getHeatmapData(datasetId, { pcaComponent: pc, pcaCount: 50 }, signal),
    staleTime: 5 * 60_000,
  });
  // The component's own sample scores, drawn as a continuous strip
  // above the design ones — same columns, same order.
  const svdQ = useQuery({
    queryKey: ["datasetSvd", datasetId],
    queryFn: ({ signal }) => getDatasetSvd(datasetId, signal),
    staleTime: 10 * 60_000,
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

  const payload = useMemo(() => {
    if (!wire) return null;
    const base = adaptHeatmapWire(wire);
    const svd = svdQ.data;
    if (!svd?.bioAssayIds || !svd?.vmatrix) return base;
    const measurements: Record<number, number> = {};
    for (const c of base.columns) {
      const i = svd.bioAssayIds.indexOf(c.bioAssayId);
      const v = i >= 0 ? svd.vmatrix[i]?.[pc - 1] : undefined;
      if (typeof v === "number" && Number.isFinite(v)) {
        measurements[c.bioAssayId] = v;
      }
    }
    if (Object.keys(measurements).length === 0) return base;
    return {
      ...base,
      factors: [
        ...base.factors,
        {
          // Negative id so it cannot collide with a real
          // ExperimentalFactor — the widget keys strip identity and
          // grouping off it. Continuous, so it draws as a gradient and
          // reads as a different kind of thing from the design strips.
          id: -pc,
          name: `PC${pc} score`,
          description: `sample score on principal component ${pc}`,
          type: "continuous" as const,
          category: { label: `PC${pc} score`, uri: null },
          factor_values: [],
          continuousMeasurements: measurements,
        },
      ],
    };
  }, [wire, svdQ.data, pc]);

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
            {payload ? (
              <span className="ml-2 text-[11px] font-normal text-slate-500">
                · expression, row-scaled · {payload.rows.length} probes ordered
                by loading on PC{pc}
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
          ) : !payload ? (
            <div className="text-xs text-slate-500 italic">
              No expression data available for this dataset yet.
            </div>
          ) : (
            <div className="h-full min-w-0">
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
                // picked up is what the reader is here for.
                defaultRowScale
                defaultClip={3}
                defaultMaxHeight={22}
                defaultMaxWidth={18}
                rowLabelGutterWidth={260}
                defaultFitMode="squeeze"
                showGroupGaps={false}
                downloadFilenameStem={`pc${pc}-expression`}
                rowLabelTooltip={(i) => {
                  const r = wire?.rows[i];
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
