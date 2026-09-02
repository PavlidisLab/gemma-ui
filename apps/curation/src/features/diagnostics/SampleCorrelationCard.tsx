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
import { HeatmapWidget, serializeHeatmapDataAsTsv } from "@gemma/heatmap";
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

/** Masking every sample leaves no scale to compute — below this many
 *  survivors the matrix arrives unmasked and the toggle is refused. */
const MIN_UNMASKED_SAMPLES = 3;

/** The whole served matrix as TSV, sample names on both axes.
 *
 *  🛑 This used to be an `<a href>` straight at
 *  `/rest/v2/datasets/{id}/sample-correlation` labelled "raw matrix as
 *  TSV". That route answers JSON, so the file was JSON under a name
 *  promising otherwise — and a curator opening it in a spreadsheet got
 *  a wall of braces. The route has no TSV form to point at (it takes
 *  `dataset` alone), so the table is built here from the payload the
 *  panel already holds, using the heatmap package's own serializer
 *  rather than a second one.
 *
 *  Deliberately the FULL matrix, not the masked view: the mask is a
 *  reading aid, and a file that silently dropped the samples under it
 *  would be a different file under the same name. The diagonal is
 *  included too — it is blanked for the palette's sake, which is a
 *  rendering concern the export does not share. A cell Gemma sent as
 *  NaN exports empty, matching R and pandas defaults. */
function downloadMatrixTsv(
  experimentId: number | string,
  data: {
    bio_assay_ids: number[];
    bio_assay_short_names: (string | null)[];
    values: number[][];
  },
): void {
  const labels = data.bio_assay_short_names.map(
    (s, i) => s || String(data.bio_assay_ids[i] ?? i),
  );
  const tsv = serializeHeatmapDataAsTsv({
    rowLabels: labels,
    colLabels: labels,
    values: data.values.map((row) =>
      row.map((v) => {
        const n = typeof v === "number" ? v : Number(v);
        return Number.isFinite(n) ? n : null;
      }),
    ),
  });
  const url = URL.createObjectURL(
    new Blob([tsv], { type: "text/tab-separated-values" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `sample-correlation-${experimentId}.tsv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Same delay the heatmap widget uses — revoking synchronously can
  // beat the browser to the file on Safari.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SampleCorrelationCard({
  experimentId,
}: {
  experimentId: number | string;
}) {
  const { data: result, isLoading, error } = useSampleCorrelation(experimentId);
  const data = result?.matrix ?? null;

  // Gemma serves this matrix unmasked and names the outliers separately
  // — `1fa3c4cd68` stopped masking at compute time because the matrix is
  // what a curator reviews an outlier call AGAINST. Masking is therefore
  // OURS to apply, and it is a view: the real values stay in hand and
  // the toggle costs nothing but a recompute.
  //
  // Masked is the default because an outlier's correlations are the low
  // ones, and leaving them in stretches the domain down to meet them —
  // every other cell then sits in the top sliver of the palette and the
  // matrix reads as one flat colour. Unmasking is how you see what those
  // numbers actually are, with the scale opened up to fit them.
  const [unmasked, setUnmasked] = useState(false);

  const outlierIds = useMemo(
    () =>
      new Set([
        ...(data?.actual_outlier_bio_assay_ids ?? []),
        ...(data?.predicted_outlier_bio_assay_ids ?? []),
      ]),
    [data],
  );
  const maskable = data
    ? data.bio_assay_ids.filter((id) => outlierIds.has(id)).length
    : 0;
  const remaining = data ? data.bio_assay_ids.length - maskable : 0;
  const canMask = maskable > 0 && remaining >= MIN_UNMASKED_SAMPLES;
  // A toggle left set while its subject disappears (another experiment,
  // a refetch that cleared the flags) would label the matrix wrongly.
  const masking = canMask && !unmasked;

  // Adapt curation's snake_case wire to the camelCase shape the shared
  // helpers consume, blanking the masked samples' cells. The fields
  // carry the same semantics.
  //
  // 🛑 Masked, not removed: every sample keeps its row and column, so
  // the two states are the same grid with the same cells in the same
  // places and the curator can read one against the other. Dropping the
  // rows would reflow the matrix and make the comparison a puzzle.
  const adapted = useMemo(() => {
    if (!data) return null;
    const whole = {
      bioAssayIds: data.bio_assay_ids,
      bioAssayShortNames: data.bio_assay_short_names,
      values: data.values,
    };
    if (!masking) return whole;
    const out = data.bio_assay_ids.map((id) => outlierIds.has(id));
    return {
      ...whole,
      // Row AND column: the matrix is symmetric, so blanking one axis
      // alone would leave the sample's correlations on the other. NaN
      // rather than a sentinel — both shared helpers already skip
      // non-finite cells, so it masks the colour AND the domain.
      values: data.values.map((row, i) =>
        row.map((v, j) => (out[i] || out[j] ? NaN : v)),
      ),
    };
  }, [data, masking, outlierIds]);

  const built = useMemo(
    () => buildSampleCorrelationHeatmapData(adapted),
    [adapted],
  );
  // 🛑 Computed from the VISIBLE values, so the scale follows the
  // toggle. The lower bound hugs the observed off-diagonal minimum and
  // an outlier is usually what sets that minimum, so this is the whole
  // point of the control: masked, the palette spends its range on the
  // samples that agree; unmasked, it opens up to reach the outlier and
  // you can see how far out it actually sits.
  const seqDomain = useMemo(
    () => computeSampleCorrelationDomain(adapted?.values),
    [adapted],
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
            {maskable > 0 ? (
              <button
                type="button"
                onClick={() => setUnmasked((u) => !u)}
                disabled={!canMask}
                className={
                  "underline decoration-dotted underline-offset-2 " +
                  (canMask
                    ? "text-blue-700 dark:text-blue-300 hover:no-underline"
                    : "text-slate-400 dark:text-slate-500 cursor-not-allowed")
                }
                title={
                  canMask
                    ? masking
                      ? `Draw the ${maskable} outlier(s)' real correlations and open the colour range to fit them`
                      : "Blank the outliers again and rescale to the remaining samples"
                    : `Masking ${maskable} of ${data.bio_assay_ids.length} samples would leave fewer than ${MIN_UNMASKED_SAMPLES}`
                }
              >
                {masking
                  ? `show ${maskable} outlier(s)`
                  : `mask ${maskable} outlier(s)`}
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
              <button
                type="button"
                onClick={() => downloadMatrixTsv(experimentId, data)}
                className="text-blue-700 dark:text-blue-300 hover:underline"
                title="The full matrix as TSV — every sample, masked or not, and the diagonal included"
              >
                download matrix ↓
              </button>
            </span>
          </>
        ) : null
      }
    >
      {body}
    </PanelCard>
  );
}
