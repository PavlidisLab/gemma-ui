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
  sampleCorrelationCellPx,
  sampleCorrelationMatrixPx,
} from "@gemma/diagnostics";
import { getDatasetSampleCorrelation } from "@/api/endpoints";
import { restUrl } from "@/api/base";

export function SampleCorrelationCard({ datasetId }: { datasetId: number }) {
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
  // Size each square cell so the matrix fills the panel body regardless
  // of sample count — few-sample datasets otherwise leave the box empty.
  // 🛑 No annotation strips on this wrapper — the public browse page
  // has no design draft to build a payload from — so the strip
  // allowance is zero here, unlike curation's.
  const cellPx = sampleCorrelationCellPx(data?.bioAssayIds.length, 0);

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
      <HeatmapWidget
        data={built}
        chrome={false}
        showControls={false}
        showLegend={true}
        // Side rail, matching curation's: a horizontal bar plus its
        // caption costs ~50px of height on a short tile, and height is
        // the axis a square matrix is starved of.
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
        matrixMaxHeight={sampleCorrelationMatrixPx(0)}
        defaultFitMode="squeeze"
      />
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
