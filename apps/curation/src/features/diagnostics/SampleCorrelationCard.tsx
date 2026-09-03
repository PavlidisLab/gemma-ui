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

import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  useSampleCorrelation,
  type SampleCorrelationVariant,
} from "@/api/diagnostics";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import {
  buildDesignHeatmapPayload,
  withQcMetricStrips,
} from "./heatmapPayload";
import { useEscapeKey } from "@gemma/ui";
import { useBatchOutliers } from "@/api/workflow";
import { useQcMetrics } from "@/api/qcMetrics";
import { usePipelineStatus } from "@/api/workflow";

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
  /**
   * Which matrix Gemma builds. Non-regressed by default — Paul,
   * 2026-09-02: *"the matrix should be NON-regressed by default (it's
   * less confusing) but sometimes outliers aren't that obvious."*
   *
   * The regressed one takes the design's factor effects out, so
   * structure that is just the experiment stops dominating and a sample
   * that is genuinely odd stands out. It is also the matrix the outlier
   * DETECTOR reads, so a predicted call is only reproducible here.
   */
  const [variant, setVariant] = useState<SampleCorrelationVariant>("full");
  const { data: result, isLoading, error } = useSampleCorrelation(
    experimentId,
    variant,
  );
  const data = result?.matrix ?? null;
  /**
   * Gemma's sentence for why this dataset has no regressed matrix, once
   * it has said so. It only computes one when the design has factors
   * above the SVD importance threshold, so `?matrix=regressed` 404s on
   * datasets like GSE19853.
   *
   * 🛑 Discovered by asking — there is no field that says in advance.
   * So the first click is the discovery, and it must not cost the
   * curator the panel: the variant snaps back to `full` and the control
   * greys with the reason on it, rather than leaving an empty card and
   * no way out of the mode that emptied it.
   */
  const [noRegressed, setNoRegressed] = useState<string | null>(null);
  useEffect(() => {
    if (variant !== "regressed") return;
    if (result && result.matrix === null) {
      setNoRegressed(result.reason || "This dataset has no regressed matrix.");
      setVariant("full");
    }
  }, [variant, result]);
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
  /**
   * Outlier flags the curator has clicked but not yet sent. Two disjoint
   * sets, mirroring the endpoint's own `{mark, unmark}` delta — an id in
   * both is a 400 that mutates nothing, so `stageAssay` moves an id
   * between them rather than adding to either blindly.
   *
   * Staged, not sent, because flagging is not a label: it writes NaN
   * into the processed vectors and leaves every derived analysis stale.
   * One request per curator decision, not one per click.
   */
  const [pendingMark, setPendingMark] = useState<number[]>([]);
  const [pendingUnmark, setPendingUnmark] = useState<number[]>([]);
  const batchOutliers = useBatchOutliers(experimentId);
  const { data: pipeline } = usePipelineStatus(experimentId);
  // Sequencing QC rides above the matrix as extra strips — evidence
  // that owes nothing to expression similarity. Absent for microarray,
  // where the strips simply do not appear.
  const { data: qc } = useQcMetrics(experimentId);

  /** Clicking a sample toggles it toward the opposite of its CURRENT
   *  server state, and clicking again takes the staging back off. */
  const stageAssay = (assayId: number) => {
    const alreadyFlagged = (data?.actual_outlier_bio_assay_ids ?? []).includes(
      assayId,
    );
    if (alreadyFlagged) {
      setPendingMark((m) => m.filter((x) => x !== assayId));
      setPendingUnmark((u) =>
        u.includes(assayId) ? u.filter((x) => x !== assayId) : [...u, assayId],
      );
    } else {
      setPendingUnmark((u) => u.filter((x) => x !== assayId));
      setPendingMark((m) =>
        m.includes(assayId) ? m.filter((x) => x !== assayId) : [...m, assayId],
      );
    }
  };

  const assayLabel = (assayId: number) => {
    const i = data?.bio_assay_ids.indexOf(assayId) ?? -1;
    return (i >= 0 ? data?.bio_assay_short_names[i] : null) || `assay ${assayId}`;
  };

  /** The steps this write will knock out of date: whatever Gemma
   *  currently reports as `ok`. A step already `stale` or `not_run`
   *  loses nothing, so naming it would overstate the cost. */
  const willInvalidate = useMemo(() => {
    const a = pipeline?.analysis;
    if (!a) return [] as string[];
    const rows: Array<[string, { status: string } | undefined]> = [
      ["Preprocessing", a.preprocessing],
      ["Diagnostics (PCA / GEEQ)", a.diagnostics],
      ["Differential expression", a.dea],
    ];
    return rows.filter(([, st]) => st?.status === "ok").map(([label]) => label);
  }, [pipeline]);


  const [zoomed, setZoomed] = useState(false);
  /** Whether the in-flight click started on the zoom backdrop. See the
   *  handler for why a bare `onClick` was not enough. */
  const backdropArmed = useRef(false);
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
    // 🛑 Only SAVED flags are blanked. A staged one is veiled instead
    // (see `dimRowFlags`) — blanking says the sample is already out,
    // and a proposal has not done anything yet. A staged UNflag lifts
    // the blanking immediately, because that IS what saving will do.
    const hidden = new Set(
      [...outlierIds].filter((id) => !pendingUnmark.includes(id)),
    );
    if (!masking || hidden.size === 0) return whole;
    const out = data.bio_assay_ids.map((id) => hidden.has(id));
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
  }, [data, masking, outlierIds, pendingUnmark]);

  const built = useMemo(
    () => buildSampleCorrelationHeatmapData(adapted),
    [adapted],
  );

  // The payload path is what gives the matrix its annotation strips,
  // its design-ordered columns and the gaps between groups — the
  // widget draws all three, but only when it is handed factors. Falls
  // back to the bare matrix when the design cannot place the columns.
  //
  // Returns the row order's bioAssay ids alongside the payload. A click
  // on a row label names a RENDERED row, and the rows below are
  // permuted — resolving the id from the unpermuted list would flag a
  // different sample than the one the curator pointed at.
  const { payload, rowAssayIds } = useMemo<{
    payload: ReturnType<typeof buildDesignHeatmapPayload> | null;
    rowAssayIds: number[];
  }>(() => {
    if (!built || !adapted) return { payload: null, rowAssayIds: [] };
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
    if (!p) return { payload: null, rowAssayIds: adapted.bioAssayIds };
    // Before `computeColumnOrder`, so a QC strip is a groupable factor
    // like any other — clicking "% Aligned" sorts the samples by it.
    const withQc = withQcMetricStrips(p, qc);
    if (withQc) Object.assign(p, withQc);

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
    if (columnOrder.every((c, i) => c === i)) {
      return { payload: p, rowAssayIds: adapted.bioAssayIds };
    }
    const permuted = {
      ...p,
      // The row LABELS travel with the rows they name, or the gutter
      // would read the original order against reordered data.
      rows: columnOrder.map((r) => p.rows[r]),
      matrix: {
        ...p.matrix,
        values: columnOrder.map((r) => p.matrix.values[r]),
      },
    };
    return {
      payload: permuted,
      rowAssayIds: columnOrder.map((r) => adapted.bioAssayIds[r]),
    };
  }, [built, adapted, draft, experimentId, groupBy, qc]);

  /** Which rendered rows carry a proposed change, in the permuted order
   *  the widget draws. Both directions are veiled: a staged flag so you
   *  can see what you are about to remove, and a staged unflag so the
   *  row you just brought back is still marked as unsaved. */
  /** Which rendered rows are FLAGGED on the server — tinted amber
   *  whether or not they are masked, so unmasking to read an outlier's
   *  real correlations does not also erase the fact that it is one. A
   *  staged unflag drops out immediately: that is what saving will do. */
  const markRowFlags = useMemo(
    () =>
      rowAssayIds.map(
        (id) => outlierIds.has(id) && !pendingUnmark.includes(id),
      ),
    [rowAssayIds, outlierIds, pendingUnmark],
  );

  /**
   * Wide enough for the longest strip name, instead of a fixed 104px
   * that cut "organism part" to "organism…".
   *
   * The gutter is nearly free on this panel: the matrix is square and
   * bounded by the panel's HEIGHT, so widening the label column does
   * not shrink it — it only eats whitespace the matrix could not have
   * used. Capped anyway, because a factor can be named anything.
   *
   * ~6.4px per character at 12px Helvetica, plus room for the grouping
   * marker and the left padding.
   */
  const labelGutterPx = useMemo(() => {
    const names = (payload?.factors ?? []).map((f) => f.name ?? "");
    const longest = names.reduce((m, n) => Math.max(m, n.length), 0);
    return Math.round(Math.min(180, Math.max(104, longest * 6.4 + 28)));
  }, [payload]);

  const dimRowFlags = useMemo(
    () =>
      rowAssayIds.map(
        (id) => pendingMark.includes(id) || pendingUnmark.includes(id),
      ),
    [rowAssayIds, pendingMark, pendingUnmark],
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
        // 🛑 Not a user preference here. The palette is stored under ONE
        // global key shared by every heatmap in the app, so switching it
        // on any other heatmap switched it on this one — and a diverging
        // ramp on |r| in [0.96, 1.00] splits the scale at a midpoint that
        // means nothing.
        paletteLocked
        defaultClip={1}
        defaultDomain={seqDomain}
        defaultRowScale={false}
        defaultSquareCells={true}
        defaultShowRowLabels={false}
        // Just wide enough for a factor name. Row labels stay off, so
        // this holds only the strip names — which are what you click to
        // change the ordering.
        rowLabelGutterWidth={labelGutterPx}
        // The hover tooltip says everything the pinned panels would,
        // and the panels were swallowing the click that switches the
        // grouping.
        showDetailPanel={false}
        // Same fact on both surfaces: a flagged sample is marked here
        // too, so the tile does not quietly disagree with the view the
        // curator opens from it.
        markRows={markRowFlags}
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

  /**
   * Caption plus the two view controls, rendered in the tile footer AND
   * at the top of the big view — Paul, 2026-09-02: *"the zoomed view
   * should have the same controls (regressed, mask/show)."* They were
   * tile-only, so the surface a curator actually works in was the one
   * that could not change what it was showing.
   */
  /**
   * 🛑 Rendered whether or not a matrix came back.
   *
   * `?matrix=regressed` 404s on a dataset that has none — Gemma only
   * computes one when the design has factors above the SVD importance
   * threshold, and GSE19853 is such a dataset. The toggle used to live
   * inside a `data ? …` branch, so switching to regressed there emptied
   * the panel AND took away the control that switches back: the curator
   * was stuck in a mode with no exit but a reload.
   */
  const variantToggle = (
    // 🛑 The title lives on the WRAPPER. Chrome fires no hover events on
    // a disabled element, so a disabled button's own `title` never
    // appears — the control would grey out and refuse to say why, which
    // is the failure greying it was meant to avoid.
    <span title={noRegressed ?? undefined}>
    <button
      type="button"
      disabled={noRegressed != null}
      onClick={() => setVariant((v) => (v === "full" ? "regressed" : "full"))}
      className={
        "underline decoration-dotted underline-offset-2 " +
        (noRegressed != null
          ? "text-slate-400 dark:text-slate-500 cursor-not-allowed"
          : "text-blue-700 dark:text-blue-300 hover:no-underline")
      }
      title={
        noRegressed != null
          ? noRegressed
          : variant === "full"
            ? "Take the design's factor effects out, so structure that is just the experiment stops dominating and an odd sample stands out. This is also the matrix the outlier detector reads."
            : "Back to the plain correlation, with no model subtracted."
      }
    >
      {variant === "full" ? "regress out design" : "show unregressed"}
    </button>
    </span>
  );

  const matrixControls = data ? (
    <>
            <span>
              {data.bio_assay_ids.length} samples · {data.method ?? "pearson"}
              {/* What the server BUILT, not what we asked for — `best`
                  resolves to `regressed`, so the two are not the same
                  claim. Silent when it agrees with the default. */}
              {data.matrix && data.matrix !== "full" ? (
                <span className="ml-1.5 text-amber-700 dark:text-amber-300">
                  · {data.matrix}
                </span>
              ) : null}
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
            {/* 🛑 Greyed, not absent. Paul, 2026-09-02: *"if hide/show
                outliers isn't actually available for a data set, grey it
                out."* A control that disappears leaves the curator
                wondering whether the panel is broken or the dataset is
                different; one that greys says which. */}
            {true ? (
              <span
                title={
                  canMask
                    ? undefined
                    : maskable === 0
                      ? "No sample on this dataset is flagged or predicted as an outlier, so there is nothing to hide."
                      : `Masking ${maskable} of ${data.bio_assay_ids.length} samples would leave fewer than ${MIN_UNMASKED_SAMPLES}`
                }
              >
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
                  maskable === 0
                    ? "No sample on this dataset is flagged or predicted as an outlier, so there is nothing to hide."
                    : canMask
                      ? masking
                        ? `Draw the ${maskable} outlier(s)' real correlations and open the colour range to fit them`
                        : "Blank the outliers again and rescale to the remaining samples"
                      : `Masking ${maskable} of ${data.bio_assay_ids.length} samples would leave fewer than ${MIN_UNMASKED_SAMPLES}`
                }
              >
                {maskable === 0
                  ? "no outliers to hide"
                  : masking
                    ? `show ${maskable} outlier(s)`
                    : `mask ${maskable} outlier(s)`}
              </button>
              </span>
            ) : null}
            {variantToggle}
            {/* Curator-only affordance — wire a "Mark / Unmark
                outlier" button cluster here. Gemma serves
                POST /datasets/{id}/samples/outliers (batch mark /
                unmark, GROUP_ADMIN) for exactly this, but the write
                is the agent's to make, not ours. The shared package
                stays affordance-free so the public browse wrapper
                isn't forced to pull in mutating UI. */}
                </>
  ) : null;


  return (
    <PanelCard
      title="Sample correlation"
      footer={
        // 🛑 Not gated on `data`. A regressed matrix that does not exist
        // 404s, and the toggle that gets back out of that state cannot
        // live inside the branch that the 404 removes.
        result ? (
          <>
            {matrixControls}
            {data ? null : (
              <span className="flex items-center gap-3">{variantToggle}</span>
            )}
            <span className="ml-auto flex items-center gap-3">
              {data ? (
                <>
                  <button
                    type="button"
                    onClick={() => setZoomed(true)}
                    className="text-blue-700 dark:text-blue-300 hover:underline"
                    title="Open the big view, where samples can be flagged and unflagged as outliers"
                  >
                    curate outliers ⤢
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadMatrixTsv(experimentId, data)}
                    className="text-blue-700 dark:text-blue-300 hover:underline"
                    title="The full matrix as TSV — every sample, masked or not, and the diagonal included"
                  >
                    download matrix ↓
                  </button>
                </>
              ) : null}
            </span>
          </>
        ) : null
      }
    >
      {body}
      {zoomed && built ? (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-6"
          // 🛑 Close on a click that BEGAN on the backdrop, not on any
          // click that lands there. A resize drag starts on the panel's
          // corner handle and usually ends over the backdrop; `click`
          // then fires on the common ancestor — the backdrop — and the
          // dialog shut itself every time it was resized.
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) backdropArmed.current = true;
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && backdropArmed.current) {
              setZoomed(false);
            }
            backdropArmed.current = false;
          }}
        >
          {/* Resizable by the native corner handle: `resize` needs a
              non-visible `overflow` and a concrete starting size, so the
              panel opens at 1100x760 (clamped to the viewport) rather
              than sizing to its content. Dragging it larger gives the
              matrix more room, and the body below scrolls whenever the
              matrix is bigger than the panel — which at 224 samples it
              is, in both directions. */}
          <div
            className="bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded shadow-lg flex flex-col overflow-hidden"
            style={{
              resize: "both",
              width: "min(95vw, 1100px)",
              height: "min(90vh, 760px)",
              maxWidth: "95vw",
              maxHeight: "90vh",
              minWidth: 360,
              minHeight: 260,
            }}
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
            {/* 🛑 Above the matrix, not below it. Paul, 2026-09-02:
                *"the 'save' and stuff should probably be at the top."*
                The body scrolls, and at 224 samples a bar under it is
                past the fold — the curator stages a change and the
                control that commits it is somewhere off-screen. */}
            <div className="px-3 py-1.5 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3 flex-wrap text-xs text-slate-500 dark:text-slate-400">
              {matrixControls}
            </div>
            <OutlierCommitBar
              mark={pendingMark}
              unmark={pendingUnmark}
              label={assayLabel}
              willInvalidate={willInvalidate}
              busy={batchOutliers.isPending}
              error={batchOutliers.error as Error | null}
              onUnstage={stageAssay}
              onDiscard={() => {
                setPendingMark([]);
                setPendingUnmark([]);
              }}
              onCommit={() =>
                batchOutliers.mutate(
                  { mark: pendingMark, unmark: pendingUnmark },
                  {
                    onSuccess: () => {
                      setPendingMark([]);
                      setPendingUnmark([]);
                    },
                  },
                )
              }
            />
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
        // 🛑 Not a user preference here. The palette is stored under ONE
        // global key shared by every heatmap in the app, so switching it
        // on any other heatmap switched it on this one — and a diverging
        // ramp on |r| in [0.96, 1.00] splits the scale at a midpoint that
        // means nothing.
        paletteLocked
                defaultClip={1}
                defaultDomain={seqDomain}
                defaultRowScale={false}
                defaultSquareCells
                defaultShowRowLabels
                defaultShowColLabels
                defaultFitMode="squeeze"
                // Flagging lives here and not on the tile: at tile size
                // a row is a couple of pixels tall and the sample it
                // names is not readable, so a click would be a guess.
                dimRows={dimRowFlags}
                markRows={markRowFlags}
                // Room for the SAMPLE names here, not just the factor
                // names — the big view shows both in the same gutter.
                rowLabelGutterWidth={Math.max(labelGutterPx, 190)}
                onRowLabelClick={(i) => {
                  const id = rowAssayIds[i];
                  if (id != null) stageAssay(id);
                }}
                rowLabelTitle={(i) => {
                  const id = rowAssayIds[i];
                  if (id == null) return undefined;
                  const name = assayLabel(id);
                  if (pendingMark.includes(id)) {
                    return `${name} — staged as an outlier; click to undo`;
                  }
                  if (pendingUnmark.includes(id)) {
                    return `${name} — staged for unflagging; click to undo`;
                  }
                  return outlierIds.has(id)
                    ? `${name} — click to unmark as an outlier`
                    : `${name} — click to mark as an outlier`;
                }}
                // A 12px cell is a tile-sized default. In a panel the
                // curator can drag wider, a 32-sample matrix hit that
                // cap at ~380px and left the rest of the panel empty —
                // enlarging the window did nothing for it. Cells may go
                // to 28px here; a large matrix is limited by the width
                // long before this and is unaffected. Both are still
                // adjustable under Options.
                defaultMaxHeight={28}
                defaultMaxWidth={28}
                downloadFilenameStem={`sample-correlation-${experimentId}`}
              />
            </div>
          </div>
        </div>
      ) : null}
    </PanelCard>
  );
}

/**
 * What is staged, what it will cost, and the one button that sends it.
 *
 * 🛑 Flagging is not a label. `markAsMissing` writes NaN into the
 * assay's processed vectors as the request is served; nothing is
 * recomputed, so every derived analysis keeps numbers computed against
 * data that no longer exists. The bar says which steps that is — read
 * from `pipeline-status`, not guessed — because a curator cannot see
 * that consequence anywhere on this panel.
 *
 * It does NOT offer to re-run them. Paul, 2026-09-02: flagging is a
 * curation judgement and scheduling a preprocessing run is a separate
 * decision that should not ride along with a click. The Pipeline tab
 * already has the buttons.
 *
 * Renders nothing when nothing is staged — a permanently visible action
 * bar under a diagnostic plot reads as something you are expected to
 * do.
 */
function OutlierCommitBar({
  mark,
  unmark,
  label,
  willInvalidate,
  busy,
  error,
  onUnstage,
  onDiscard,
  onCommit,
}: {
  mark: number[];
  unmark: number[];
  label: (assayId: number) => string;
  willInvalidate: string[];
  busy: boolean;
  error: Error | null;
  onUnstage: (assayId: number) => void;
  onDiscard: () => void;
  onCommit: () => void;
}) {
  if (mark.length === 0 && unmark.length === 0) return null;
  const chip = (assayId: number, kind: "mark" | "unmark") => (
    <button
      key={`${kind}-${assayId}`}
      type="button"
      onClick={() => onUnstage(assayId)}
      title="Unstage this sample"
      className={
        "px-1.5 py-0.5 rounded text-[11px] " +
        (kind === "mark"
          ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
          : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300")
      }
    >
      {label(assayId)} ×
    </button>
  );
  return (
    <div className="border-b border-slate-200 dark:border-slate-700 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-2 text-xs space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        {mark.length > 0 ? (
          <span className="text-slate-500 dark:text-slate-400">
            flag {mark.length}:
          </span>
        ) : null}
        {mark.map((id) => chip(id, "mark"))}
        {unmark.length > 0 ? (
          <span className="text-slate-500 dark:text-slate-400">
            unflag {unmark.length}:
          </span>
        ) : null}
        {unmark.map((id) => chip(id, "unmark"))}
      </div>
      <div className="text-slate-500 dark:text-slate-400 leading-snug">
        Flagging blanks a sample&rsquo;s processed data immediately, and
        unflagging restores it. Nothing is recomputed
        {willInvalidate.length > 0 ? (
          <>
            , so{" "}
            <span className="text-amber-700 dark:text-amber-300">
              {willInvalidate.join(", ")}
            </span>{" "}
            {willInvalidate.length === 1 ? "goes" : "go"} stale until re-run
            from the Pipeline tab.
          </>
        ) : (
          " — no completed analysis is affected."
        )}
      </div>
      {error ? (
        <div className="text-rose-700 dark:text-rose-300">
          {/* The server's sentence, not ours: a 400 here names the
              offending assay id, which is the only thing that tells a
              curator what to do next. */}
          {error.message}
        </div>
      ) : null}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onCommit}
          disabled={busy}
          className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium"
        >
          {busy ? "saving…" : "Save outlier changes"}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          disabled={busy}
          className="text-slate-500 dark:text-slate-400 hover:underline disabled:opacity-50"
        >
          discard
        </button>
      </div>
    </div>
  );
}
