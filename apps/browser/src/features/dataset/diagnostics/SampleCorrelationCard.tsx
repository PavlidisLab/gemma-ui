/**
 * Sample-correlation panel — browser-side wrapper. Fetches the matrix
 * via the browser's REST endpoint, normalises into the @gemma/heatmap
 * shape via the shared helpers, and renders. Public / read-only —
 * curator outlier-marking affordances live in the curation wrapper.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { HeatmapWidget } from "@gemma/heatmap";
import {
  PanelCard,
  PanelEmpty,
  PanelLoading,
  PanelError,
  buildSampleCorrelationHeatmapData,
  computeSampleCorrelationDomain,
  summariseOutliers,
  useContainerSize,
  HEATMAP_LEGEND_ZONE_PX,
} from "@gemma/diagnostics";
import { getDatasetSampleCorrelation } from "@/api/endpoints";
import { restUrl } from "@/api/base";

export function SampleCorrelationCard({ datasetId }: { datasetId: number }) {
  // 🛑 Measure the box rather than deriving it from the shared panel
  // constant. This app lays its diagnostics row out differently, so the
  // constant is not what this card actually gets — trusting it sized
  // the matrix past the card and ran it under the legend rail.
  const { ref: boxRef, height: boxH } = useContainerSize<HTMLDivElement>();
  const { data, isLoading, error } = useQuery({
    queryKey: ["sample-correlation", datasetId],
    queryFn: ({ signal }) => getDatasetSampleCorrelation(datasetId, signal),
    staleTime: 10 * 60_000,
  });

  const built = useMemo(
    () => buildSampleCorrelationHeatmapData(data ?? null),
    [data],
  );
  const seqDomain = useMemo(
    () => computeSampleCorrelationDomain(data?.values),
    [data],
  );
  // The box the canvas must fit in: the measured body, less the
  // widget's own vertical content padding.
  //
  // 🛑 That subtraction is not optional. The canvas is sized from
  // `matrixMaxHeight` but PLACED below the padding, so handing over the
  // full body put a 417×417 square past the bottom edge, where the
  // panel's `overflow-hidden` ate the last rows. The strips and marker
  // gutter come off inside the widget — don't take them again here.
  const matrixBoxPx = Math.max(
    40,
    (boxH > 0 ? boxH : 300) - HEATMAP_LEGEND_ZONE_PX,
  );
  // Size each square cell so the matrix fills that box regardless of
  // sample count — few-sample datasets otherwise leave it empty.
  const cellPx = Math.max(2, matrixBoxPx / (data?.bioAssayIds.length || 1));

  let body;
  if (isLoading) {
    body = <PanelLoading />;
  } else if (error) {
    body = <PanelError message={(error as Error).message} />;
  } else if (!data || !built) {
    body = (
      <PanelEmpty reason="No sample-correlation matrix available. Either this dataset hasn't been preprocessed or /datasets/{id}/sample-correlation isn't deployed on the current Gemma build." />
    );
  } else {
    body = (
      <div ref={boxRef} className="w-full h-full min-h-0">
        <HeatmapWidget
        data={built}
        chrome={false}
        showControls={false}
        showLegend={true}
        // Side rail, as in curation's card. It was on TOP while this
        // card was ~275px wide — a rail needs ~52px of that, and a
        // square matrix sized to the remainder overran it and put the
        // scale's numbers on the cells. The diagnostics row now gives
        // this card its own ~520px column, so the rail fits.
        //
        // 🛑 The placement is also what makes `matrixMaxHeight` below
        // correct. The widget subtracts its own padding from that
        // number but knows nothing about a legend stacked above the
        // canvas, so with the legend on top the ceiling was ~75px too
        // generous and the square matrix ran under the card footer.
        legendPlacement="side"
        showTooltip={true}
        showDownload={false}
        defaultPalette="blackbody"
        defaultClip={1}
        defaultDomain={seqDomain}
        defaultRowScale={false}
        defaultSquareCells={true}
        defaultShowRowLabels={false}
        defaultShowColLabels={false}
        defaultMaxHeight={cellPx}
        defaultMaxWidth={cellPx}
        // The real constraint: how tall the matrix may be. A cell cap
        // cannot say this, because a square matrix takes its size from
        // the width and grows past the box.
          matrixMaxHeight={matrixBoxPx}
          defaultFitMode="squeeze"
        />
      </div>
    );
  }

  const outliers = data
    ? summariseOutliers(
        data.actualOutlierBioAssayIds ?? [],
        data.predictedOutlierBioAssayIds ?? [],
      )
    : null;

  return (
    <PanelCard
      title="Sample correlation"
      footer={
        data ? (
          <>
            <span>
              {data.bioAssayIds.length} samples · {data.method ?? "pearson"}
            </span>
            {outliers ? (
              <span
                className={
                  outliers.unactedPredicted > 0
                    ? "text-amber-700 dark:text-amber-300"
                    : "text-slate-600 dark:text-slate-300"
                }
                title={
                  outliers.unactedPredicted > 0
                    ? `${outliers.unactedPredicted} predicted outlier(s) not yet flagged by the curator`
                    : undefined
                }
              >
                {outliers.text}
              </span>
            ) : null}
            <span className="ml-auto">
              <a
                href={restUrl(`/datasets/${datasetId}/sample-correlation?format=tsv`)}
                className="text-blue-700 dark:text-blue-300 hover:underline"
                download
                title="raw matrix as TSV"
              >
                download matrix ↓
              </a>
            </span>
          </>
        ) : null
      }
    >
      {body}
    </PanelCard>
  );
}
