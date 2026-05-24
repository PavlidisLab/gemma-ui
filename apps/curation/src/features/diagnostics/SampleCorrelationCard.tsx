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

  // Auto-range the sequential-palette domain. Sample correlations
  // typically sit in [0.85, 1.0]; mapping the full [-1,1] would
  // collapse contrast. Floor observed min to the next 0.1 below
  // (with a 0.05 cushion) and always pin max at 1.0.
  const seqDomain = useMemo<[number, number] | undefined>(() => {
    if (!data?.values?.length) return undefined;
    let lo = 1;
    for (let i = 0; i < data.values.length; i++) {
      const row = data.values[i];
      for (let j = 0; j < row.length; j++) {
        if (i === j) continue;
        const v = row[j];
        if (typeof v === "number" && !Number.isNaN(v) && v < lo) lo = v;
      }
    }
    const floored = Math.floor((lo - 0.05) * 10) / 10;
    return [Math.max(-1, floored), 1.0];
  }, [data]);

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
        defaultPalette="blackbody"
        defaultClip={1}
        defaultDomain={seqDomain}
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
              {data.bio_assay_ids.length} samples ·{" "}
              {data.method ?? "pearson"}
            </span>
            <OutlierCaption
              actual={data.actual_outlier_bio_assay_ids ?? []}
              predicted={data.predicted_outlier_bio_assay_ids ?? []}
            />
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

/** Mirrors the legacy Gemma footer line ("No outliers removed nor
 *  detected" / "N removed, M detected"). Quiet slate when none;
 *  amber when the detector predicted something the curator
 *  hasn't acted on yet (predicted ⊄ actual). */
function OutlierCaption({
  actual,
  predicted,
}: {
  actual: number[];
  predicted: number[];
}) {
  const nActual = actual.length;
  const nPredicted = predicted.length;
  const actualSet = new Set(actual);
  const unactedPredicted = predicted.filter((id) => !actualSet.has(id)).length;
  if (nActual === 0 && nPredicted === 0) {
    return (
      <span className="text-slate-500 dark:text-slate-400">
        no outliers removed nor detected
      </span>
    );
  }
  return (
    <span
      className={
        unactedPredicted > 0
          ? "text-amber-700 dark:text-amber-300"
          : "text-slate-600 dark:text-slate-300"
      }
      title={
        unactedPredicted > 0
          ? `${unactedPredicted} predicted outlier${unactedPredicted === 1 ? "" : "s"} not yet flagged by the curator`
          : undefined
      }
    >
      {nActual} removed · {nPredicted} detected
      {unactedPredicted > 0 ? ` (${unactedPredicted} unflagged)` : ""}
    </span>
  );
}

/** Reshape the {bio_assay_ids, values[][]} wire payload into the
 *  HeatmapData shape the widget expects. Diagonal cells are
 *  NaN-masked so the palette doesn't saturate on r=1. */
function buildHeatmapFromMatrix(
  data: ReturnType<typeof useSampleCorrelation>["data"],
): HeatmapData | null {
  if (!data || data.values.length === 0) return null;
  const labels = data.bio_assay_short_names.map((s, i) =>
    s || String(data.bio_assay_ids[i] ?? i),
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
