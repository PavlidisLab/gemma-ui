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

import { useMemo, useState } from "react";
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

/** A matrix this small says nothing — below it the hide is refused
 *  rather than offered and left to draw a 1x1 square. */
const MIN_SAMPLES_AFTER_HIDE = 3;

export function SampleCorrelationCard({
  experimentId,
}: {
  experimentId: number | string;
}) {
  const { data: result, isLoading, error } = useSampleCorrelation(experimentId);
  const data = result?.matrix ?? null;

  // Gemma serves this matrix UNMASKED on purpose — `1fa3c4cd68`
  // stopped masking at compute time because the matrix is what a
  // curator reviews an outlier call AGAINST, and a masked one makes
  // every correlation involving a flagged sample NaN, so the evidence
  // for the call cannot be recovered. Hiding is therefore a view, not
  // a fetch: the unmasked matrix stays in hand and the toggle costs
  // nothing but a re-slice.
  const [hidden, setHidden] = useState(false);

  const outlierIds = useMemo(
    () =>
      new Set([
        ...(data?.actual_outlier_bio_assay_ids ?? []),
        ...(data?.predicted_outlier_bio_assay_ids ?? []),
      ]),
    [data],
  );
  const hideable = data
    ? data.bio_assay_ids.filter((id) => outlierIds.has(id)).length
    : 0;
  const remaining = data ? data.bio_assay_ids.length - hideable : 0;
  const canHide = hideable > 0 && remaining >= MIN_SAMPLES_AFTER_HIDE;
  // A toggle left on while its subject disappears (another experiment,
  // a refetch that cleared the flags) would silently show a filtered
  // matrix labelled as whole.
  const hiding = hidden && canHide;

  // Adapt curation's snake_case wire to the camelCase shape the shared
  // helpers consume, dropping the hidden samples from BOTH axes. The
  // fields carry the same semantics.
  const adapted = useMemo(() => {
    if (!data) return null;
    const whole = {
      bioAssayIds: data.bio_assay_ids,
      bioAssayShortNames: data.bio_assay_short_names,
      values: data.values,
    };
    if (!hiding) return whole;
    const keep = data.bio_assay_ids.flatMap((id, i) =>
      outlierIds.has(id) ? [] : [i],
    );
    return {
      bioAssayIds: keep.map((i) => data.bio_assay_ids[i]),
      bioAssayShortNames: keep.map((i) => data.bio_assay_short_names[i]),
      // Row AND column: the matrix is symmetric, so dropping a sample
      // from one axis alone would leave its correlations on the other.
      values: keep.map((i) => keep.map((j) => data.values[i][j])),
    };
  }, [data, hiding, outlierIds]);

  const built = useMemo(
    () => buildSampleCorrelationHeatmapData(adapted),
    [adapted],
  );
  // 🛑 Computed from the VISIBLE values, not the whole matrix. The
  // lower bound hugs the observed off-diagonal minimum, and an outlier
  // is usually what sets that minimum — so reusing the unfiltered
  // domain would leave the scale stretched to accommodate a sample no
  // longer drawn, and the remaining cells would stay exactly as flat
  // as before. The hide would look like it had done nothing.
  const seqDomain = useMemo(
    () => computeSampleCorrelationDomain(adapted?.values),
    [adapted],
  );
  // Size each square cell so the matrix fills the panel body regardless
  // of sample count — few-sample datasets otherwise leave the box empty.
  const cellPx = sampleCorrelationCellPx(adapted?.bioAssayIds.length);

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
              {hiding
                ? `${adapted?.bioAssayIds.length} of ${data.bio_assay_ids.length} samples`
                : `${data.bio_assay_ids.length} samples`}{" "}
              · {data.method ?? "pearson"}
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
            {hideable > 0 ? (
              <button
                type="button"
                onClick={() => setHidden((h) => !h)}
                disabled={!canHide}
                className={
                  "underline decoration-dotted underline-offset-2 " +
                  (canHide
                    ? "text-blue-700 dark:text-blue-300 hover:no-underline"
                    : "text-slate-400 dark:text-slate-500 cursor-not-allowed")
                }
                title={
                  canHide
                    ? "Hide the flagged and predicted outliers and rescale the colour range to what is left"
                    : `Hiding ${hideable} of ${data.bio_assay_ids.length} samples would leave fewer than ${MIN_SAMPLES_AFTER_HIDE}`
                }
              >
                {hiding ? "show all samples" : `hide ${hideable} outlier(s)`}
              </button>
            ) : null}
            {/* Curator-only affordance — wire a "Mark / Unmark
                outlier" button cluster here. Gemma serves
                POST /datasets/{id}/samples/outliers (batch mark /
                unmark, GROUP_ADMIN) for exactly this, but the write
                is the agent's to make, not ours. The shared package
                stays affordance-free so the public browse wrapper
                isn't forced to pull in mutating UI. */}
            <span className="ml-auto">
              <a
                // 🛑 `format` is not a parameter of this route — it
                // takes `dataset` alone. Dropped rather than renamed:
                // there is nothing to rename it to. Since `5328441870`
                // an unknown parameter is a 400, so this would have
                // turned a working download into a failing one.
                //
                // Always the WHOLE matrix — the hide is a view, and a
                // download that silently dropped rows would be a
                // different file under the same name.
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
