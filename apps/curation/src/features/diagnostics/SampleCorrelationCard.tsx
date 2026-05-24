/**
 * Sample-correlation panel — N×N symmetric matrix of pairwise
 * Pearson r between samples. Renders via the shared
 * `@gemma/heatmap` widget in its chromeless / synthetic-data mode
 * (no factor strips, no payload shape — just the raw matrix).
 *
 * The diagonal is masked out (always r=1, would saturate the
 * palette). The legacy Gemma ExtJS panel did the same with grey
 * diagonal cells; we get the same effect by NaN-out + the widget
 * rendering NaN as the FAINT palette colour.
 */

import { useMemo } from "react";
import { HeatmapWidget } from "@gemma/heatmap";
import type { HeatmapData } from "@gemma/heatmap";
import { PanelCard, PanelEmpty, PanelLoading, PanelError } from "./PanelCard";
import { useSampleCorrelation } from "@/api/diagnostics";

export function SampleCorrelationCard({
  experimentId,
}: {
  experimentId: number;
}) {
  const { data, isLoading, error } = useSampleCorrelation(experimentId);

  const built = useMemo(() => buildHeatmapFromMatrix(data), [data]);

  let body;
  if (isLoading) {
    body = <PanelLoading />;
  } else if (error) {
    body = <PanelError message={(error as Error).message} />;
  } else if (!data || !built) {
    body = (
      <PanelEmpty reason="No sample-correlation matrix returned (HTTP 404). Either this dataset hasn't been preprocessed, or /datasets/{id}/sample-correlation isn't deployed on the current Gemma build." />
    );
  } else {
    body = (
      <HeatmapWidget
        data={built}
        chrome={false}
        showControls={false}
        showLegend={true}
        showTooltip={true}
        showDownload={false}
        defaultPalette="ambsky"
        defaultClip={1}
        defaultRowScale={false}
        defaultMaxHeight={16}
        defaultMaxWidth={16}
        defaultFitMode="squeeze"
      />
    );
  }

  return (
    <PanelCard
      title="Sample correlation"
      footer={
        data ? (
          <>
            <span>
              {data.bioAssayIds.length} samples · {data.method ?? "pearson"}
            </span>
            <span className="ml-auto">
              <a
                href={`/rest/v2/datasets/${experimentId}/sample-correlation?format=tsv`}
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

/** Reshape the {bioAssayIds, values[][]} wire payload into the
 *  HeatmapData shape the widget expects. Diagonal cells are
 *  NaN-masked so the palette doesn't saturate on r=1. */
function buildHeatmapFromMatrix(
  data: ReturnType<typeof useSampleCorrelation>["data"],
): HeatmapData | null {
  if (!data || data.values.length === 0) return null;
  const labels = data.bioAssayShortNames.map((s, i) =>
    s || String(data.bioAssayIds[i] ?? i),
  );
  const values: (number | null)[][] = data.values.map((row, i) =>
    row.map((v, j) => (i === j ? null : v)),
  );
  return {
    rowLabels: labels,
    colLabels: labels,
    values,
  } satisfies HeatmapData;
}
