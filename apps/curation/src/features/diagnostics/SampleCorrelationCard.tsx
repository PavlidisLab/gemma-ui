/**
 * Sample-correlation panel — curator-side wrapper. Heatmap rendering
 * + outlier caption + domain math live in @gemma/diagnostics; this
 * wrapper handles the snake_case-to-shared-shape adapter and the
 * curator-facing footer affordances.
 *
 * Curator-only tools (mark / unmark predicted outliers) land on the
 * footer strip — wire them in as the workflow lands; the shared
 * package stays affordance-free so the public browse wrapper isn't
 * forced to pull in mutating UI.
 */

import { useMemo } from "react";
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
} from "@gemma/diagnostics";
import { useSampleCorrelation } from "@/api/diagnostics";

export function SampleCorrelationCard({
  experimentId,
}: {
  experimentId: number | string;
}) {
  const { data: result, isLoading, error } = useSampleCorrelation(experimentId);
  const data = result?.matrix ?? null;

  // Adapt curation's snake_case wire to the camelCase shape the shared
  // helpers consume. The fields carry the same semantics.
  const adapted = useMemo(() => {
    if (!data) return null;
    return {
      bioAssayIds: data.bio_assay_ids,
      bioAssayShortNames: data.bio_assay_short_names,
      values: data.values,
    };
  }, [data]);

  const built = useMemo(
    () => buildSampleCorrelationHeatmapData(adapted),
    [adapted],
  );
  const seqDomain = useMemo(
    () => computeSampleCorrelationDomain(data?.values),
    [data],
  );
  // Size each square cell so the matrix fills the panel body regardless
  // of sample count — few-sample datasets otherwise leave the box empty.
  const cellPx = sampleCorrelationCellPx(data?.bio_assay_ids.length);

  let body;
  if (isLoading) {
    body = <PanelLoading />;
  } else if (error) {
    body = <PanelError message={(error as Error).message} />;
  } else if (!data || !built) {
    body = (
      <PanelEmpty
        reason={
          // Gemma's own sentence when it gave one — it distinguishes a
          // single-cell refusal from an uncomputed matrix, which the
          // fixed text below cannot.
          result?.reason ||
          "No sample-correlation matrix returned (HTTP 404). Either this dataset hasn't been preprocessed, or /datasets/{id}/sample-correlation isn't deployed on the current Gemma build."
        }
      />
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
        defaultSquareCells={true}
        defaultShowRowLabels={false}
        defaultShowColLabels={false}
        defaultMaxHeight={cellPx}
        defaultMaxWidth={cellPx}
        defaultFitMode="squeeze"
      />
    );
  }

  const outliers = data
    ? summariseOutliers(
        data.actual_outlier_bio_assay_ids ?? [],
        data.predicted_outlier_bio_assay_ids ?? [],
      )
    : null;

  return (
    <PanelCard
      title="Sample correlation"
      footer={
        data ? (
          <>
            <span>
              {data.bio_assay_ids.length} samples · {data.method ?? "pearson"}
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
            {/* Curator-only affordance — wire a "Mark / Unmark
                outlier" button cluster here when the
                /datasets/{id}/samples/{baId}/outlier PATCH endpoint
                lands. The shared package stays affordance-free so
                the public browse wrapper isn't forced to pull in
                mutating UI. */}
            <span className="ml-auto">
              <a
                // 🛑 `format` is not a parameter of this route — it
                // takes `dataset` alone. Dropped rather than renamed:
                // there is nothing to rename it to. Since `5328441870`
                // an unknown parameter is a 400, so this would have
                // turned a working download into a failing one.
                href={`/rest/v2/datasets/${experimentId}/sample-correlation`}
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
