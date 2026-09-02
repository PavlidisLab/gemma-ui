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
import {
  HeatmapWidget,
  computeColumnOrder,
  serializeHeatmapDataAsTsv,
} from "@gemma/heatmap";
import {
  PanelCard,
  PanelEmpty,
  PanelLoading,
  PanelError,
  buildSampleCorrelationHeatmapData,
  computeSampleCorrelationDomain,
  summariseOutliers,
  sampleCorrelationMatrixPx,
  useContainerSize,
} from "@gemma/diagnostics";
import { useSampleCorrelation } from "@/api/diagnostics";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import { buildDesignHeatmapPayload } from "./heatmapPayload";
import { useEscapeKey } from "@gemma/ui";

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
  // Design-data panels read the DRAFT, not the saved server design —
  // the strips must show what the curator is looking at, including
  // uncommitted edits (feedback_design_panels_must_read_draft).
  const { draft } = useDesignDraft();

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

  const [zoomed, setZoomed] = useState(false);
  // 🛑 One selection, two widgets. The tile and the popped-out view
  // render the same matrix, and the grouping factor is widget state —
  // so without lifting it they auto-pick independently, can disagree
  // about which strip the columns are ordered by, and a change made in
  // the popup is lost when it closes. `null` means "let the widget
  // auto-pick", and the first pick it reports back becomes the shared
  // value, so both stay on it.
  const [groupBy, setGroupBy] = useState<number | null>(null);
  // 🛑 MEASURE the box, do not assume it. The panel body has a fixed
  // height in its own stylesheet, but the four tiles sit in a grid row
  // that stretches to the tallest of them, so the space actually
  // available here is whatever this dataset's neighbours made it. Every
  // constant I derived from DIAGNOSTICS_PANEL_BODY_PX was wrong in one
  // direction or the other: too big and the matrix was clipped, too
  // small and it sat in a quarter of the panel.
  const { ref: boxRef, height: boxH } = useContainerSize<HTMLDivElement>();
  // Only while the zoom is open, so the key is free the rest of the time.
  useEscapeKey(zoomed, () => setZoomed(false));

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

  // The payload path is what gives the matrix its annotation strips,
  // its design-ordered columns and the gaps between groups — the
  // widget draws all three, but only when it is handed factors. Falls
  // back to the bare matrix when the design cannot place the columns.
  const payload = useMemo(() => {
    if (!built || !adapted) return null;
    const p = buildDesignHeatmapPayload({
      design: draft,
      bioAssayIds: adapted.bioAssayIds,
      values: built.values,
      colLabels: built.colLabels ?? [],
      // Rows are SAMPLES here, and the same ones as the columns. Named
      // explicitly because a payload row defaults to a probe, and this
      // matrix has none.
      rows: (built.rowLabels ?? []).map((l) => ({ symbol: l, name: "" })),
      datasetId: Number(experimentId) || 0,
    });
    if (!p) return null;

    // 🛑 A correlation matrix is SYMMETRIC and the widget orders only
    // COLUMNS, so the rows have to be permuted to match or cell (i, j)
    // stops being sample i against sample j and the r=1 diagonal
    // scatters into speckle. The diagonal is how a reader checks the
    // two axes agree, so losing it loses the thing that says the matrix
    // is being read correctly at all.
    //
    // 🛑 ROWS ONLY. The first attempt permuted both and handed over an
    // already-grouped payload, assuming the widget would then find the
    // columns in order and do nothing — it does not; it applies its
    // ordering to whatever it is given, so the columns moved TWICE
    // against rows that moved once, and the diagonal scattered exactly
    // as before. Leave the columns alone, let the widget order them,
    // and apply the same permutation to the rows here so the two
    // compose to the identity.
    const { columnOrder } = computeColumnOrder(p, groupBy);
    if (columnOrder.every((c, i) => c === i)) return p;
    return {
      ...p,
      // The row LABELS travel with the rows they name, or the gutter
      // would read the original order against reordered data.
      rows: columnOrder.map((r) => p.rows[r]),
      matrix: {
        ...p.matrix,
        values: columnOrder.map((r) => p.matrix.values[r]),
      },
    };
  }, [built, adapted, draft, experimentId, groupBy]);
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
  // One strip per factor the payload carries — that is what the widget
  // will draw above the matrix, and it comes out of the same box.
  // What the matrix may occupy: the measured box, less the widget's own
  // padding and the strips above it. Falls back to the fixed-panel
  // figure until the first measurement lands.
  const stripCount = payload ? payload.factors.length : 0;
  // 🛑 Subtract NOTHING but the strips. The observer is on the box the
  // widget is given, and the widget's own padding is inside that box —
  // taking it off again double-counted, which is why the matrix came
  // out ~100px short of the space it had. The strips are the one thing
  // above the canvas that is not already accounted for.
  const matrixBoxPx =
    boxH > 0
      ? Math.max(40, boxH - (stripCount > 0 ? stripCount * 14 + 4 : 0))
      : sampleCorrelationMatrixPx(stripCount);
  const cellPx = Math.max(2, matrixBoxPx / (data?.bio_assay_ids.length || 1));


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
      <div ref={boxRef} className="w-full h-full min-h-0">
        <HeatmapWidget
        {...(payload ? { payload } : { data: built })}
        // 🛑 No group gutters here. Every cell of a correlation matrix
        // exists — it is sample x sample — so a blank column reads as
        // "no value" when it only means "a group ends here". The
        // grouping is still legible from the strips above.
        showGroupGaps={false}
        defaultMainGroupingFactorId={groupBy}
        onMainGroupingFactorChange={setGroupBy}
        chrome={false}
        // 🛑 Controls OFF at tile size, and the header goes with them.
        // Turning them on added a whole header row — "Options" and the
        // 60x60 dimension caption — INSIDE the panel's fixed 308px
        // body, so the matrix started that much lower and the same
        // amount of it fell off the bottom, which is overflow:hidden.
        // The picker was never worth a band of chrome above the plot.
        //
        // Switching the grouping still works here: clicking an
        // annotation strip groups by it, and the ▶ marker shows which
        // one is active. That only became reachable once the tile
        // stopped being wrapped in a button that ate the click. The
        // popped-out view keeps the full Options popover.
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
        // Just wide enough for a factor name. Row labels stay off, so
        // this holds only the strip names — which are what you click to
        // change the ordering.
        rowLabelGutterWidth={104}
        // The hover tooltip says everything the pinned panels would,
        // and the panels were swallowing the click that switches the
        // grouping.
        showDetailPanel={false}
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
            <span className="ml-auto flex items-center gap-3">
              <button
                type="button"
                onClick={() => setZoomed(true)}
                className="text-blue-700 dark:text-blue-300 hover:underline"
                title="Open a larger view"
              >
                enlarge ⤢
              </button>
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
      {zoomed && built ? (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-6"
          onClick={() => setZoomed(false)}
        >
          <div
            className="bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded shadow-lg max-w-[95vw] max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <span className="font-semibold text-slate-800 dark:text-slate-100">
                Sample correlation
                <span className="ml-2 text-[11px] font-normal text-slate-500 dark:text-slate-400">
                  · {data?.bio_assay_ids.length} samples ·{" "}
                  {payload
                    ? "grouped by design — change it under Options"
                    : "no design grouping available"}
                </span>
              </span>
              <button
                type="button"
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                onClick={() => setZoomed(false)}
                aria-label="close"
              >
                ×
              </button>
            </div>
            <div className="flex-1 min-h-[400px] overflow-auto p-3">
              <HeatmapWidget
                {...(payload ? { payload } : { data: built })}
                chrome={false}
                // Controls ON here, off on the tile. The Options
                // popover is where the grouping factor is chosen, and a
                // 300px tile has no room for it — but the question
                // "which factor is this ordered by, and can I change
                // it" only comes up once the matrix is big enough to
                // read.
                showControls
                showLegend
                showTooltip
                showDownload
                showGroupGaps={false}
                defaultMainGroupingFactorId={groupBy}
                onMainGroupingFactorChange={setGroupBy}
                defaultPalette="blackbody"
                defaultClip={1}
                defaultDomain={seqDomain}
                defaultRowScale={false}
                defaultSquareCells
                defaultShowRowLabels
                defaultShowColLabels
                defaultFitMode="squeeze"
                downloadFilenameStem={`sample-correlation-${experimentId}`}
              />
            </div>
          </div>
        </div>
      ) : null}
    </PanelCard>
  );
}
