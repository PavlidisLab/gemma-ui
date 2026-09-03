/**
 * Turn the curation design draft into the `HeatmapPayload` the heatmap
 * widget wants, for any matrix whose columns are bioAssays.
 *
 * 🛑 **This is not a second heatmap.** `HeatmapWidget` already draws
 * per-factor annotation strips, orders columns by the design and opens
 * gaps between groups — but only from a `payload`. Handed a bare
 * `HeatmapData` it has no factors to read, so it draws the matrix in
 * wire order with no strips. Both diagnostics panels were passing
 * `data`, which is the whole reason the sample-correlation matrix and
 * the PC-loadings popup showed neither the annotations nor the design
 * grouping the expression heatmap shows.
 *
 * The join is: design factor value -> biomaterial short names ->
 * biomaterial -> bio_assays[].bio_assay_id -> the matrix's column ids.
 * That last hop is the one that was broken until `bio_assay_id`
 * survived `composeDesign`; without it every column here would come out
 * unassigned.
 */

import type { HeatmapPayload } from "@gemma/heatmap";
import type { Design } from "@/features/experiment/types";
import { qcFactorId, qcStripMetrics, type QcMetrics } from "@/api/qcMetrics";

/** A row is a probe only if the caller gave it a design-element id.
 *  Rows that are samples (the correlation matrix) carry a label and no
 *  id, and must not be described as probes anywhere. */
function isProbe(
  row?: { designElementId?: number | null },
): boolean {
  return row?.designElementId != null;
}

/** bioAssay id -> the biomaterial short name it belongs to. */
function assayToShortName(design: Design): Map<number, string> {
  const out = new Map<number, string>();
  for (const bm of design.biomaterials ?? []) {
    for (const ba of bm.bio_assays ?? []) {
      if (ba.bio_assay_id != null) out.set(ba.bio_assay_id, bm.short_name);
    }
  }
  return out;
}

/**
 * Build a payload for a matrix whose columns are the given bioAssay
 * ids, in the given order.
 *
 * Returns `null` when the design cannot annotate the matrix at all — no
 * factors, or not one column that resolves to a sample. A caller that
 * gets `null` should fall back to its plain `HeatmapData`, which is
 * exactly what it rendered before: fewer strips is a worse picture, a
 * blank one is a broken panel.
 *
 * `rowLabels` / `colLabels` are carried through unchanged; the widget
 * reads column identity from `columns[].name`.
 */
export function buildDesignHeatmapPayload(args: {
  design: Design | null | undefined;
  /** Column bioAssay ids, in the matrix's own column order. */
  bioAssayIds: Array<number | string>;
  /** Row-major matrix, rows x bioAssayIds.length. */
  values: Array<Array<number | null>>;
  /** Per-column display name, parallel to `bioAssayIds`. */
  colLabels: string[];
  /** Optional per-row identity, parallel to `values`.
   *
   *  🛑 Needed whenever the caller wants row labels AND strips. When a
   *  payload is supplied the widget builds its matrix from it and
   *  ignores the sibling `data`, so row labels passed only on `data`
   *  vanish the moment annotations are switched on — the gene gutter
   *  in the PC-loadings popup did exactly that. */
  rows?: Array<{ symbol: string; name: string; designElementId?: number | null }>;
  datasetId: number;
}): HeatmapPayload | null {
  const { design, bioAssayIds, values, colLabels, rows, datasetId } = args;
  if (!design || !design.factors?.length || !bioAssayIds.length) return null;

  const shortNameOf = assayToShortName(design);
  if (shortNameOf.size === 0) return null;

  // short name -> { factorId: factorValueId }. A factor value lists the
  // biomaterials assigned to it, so the map is built by inversion.
  const bySample = new Map<string, Record<number, number>>();
  for (const f of design.factors) {
    for (const fv of f.factor_values ?? []) {
      for (const sn of fv.biomaterial_short_names ?? []) {
        const rec = bySample.get(sn) ?? {};
        rec[f.id] = fv.id;
        bySample.set(sn, rec);
      }
    }
  }

  let assigned = 0;
  const columns = bioAssayIds.map((raw, i) => {
    const id = typeof raw === "number" ? raw : Number(raw);
    const shortName = Number.isFinite(id) ? shortNameOf.get(id) : undefined;
    const factorValueIds = shortName ? (bySample.get(shortName) ?? {}) : {};
    if (Object.keys(factorValueIds).length > 0) assigned++;
    return {
      bioAssayId: Number.isFinite(id) ? id : i,
      // The widget groups on the factor assignment, not on the
      // biomaterial, so a missing biomaterial id costs nothing here.
      bioMaterialId: 0,
      name: colLabels[i] ?? shortName ?? String(raw),
      outlier: false,
      factorValueIds,
    };
  });

  // 🛑 Not "some columns assigned" — none. A matrix where the design
  // places no column has nothing to group by and would render strips
  // that are entirely blank, which reads as a rendering fault rather
  // than as missing assignments.
  if (assigned === 0) return null;

  return {
    datasetId,
    matrix: {
      values,
      rows: values.length,
      cols: bioAssayIds.length,
      // Neither matrix is expression data: the correlation panel holds
      // Pearson r and the loadings popup a rank-1 projection. The
      // widget only reads this to caption a value, so it is named
      // rather than faked as a real QT.
      quantitationType: {
        name: "value",
        isRatio: false,
        isPreferred: false,
        scale: "LINEAR",
      },
    },
    // One row entry per matrix row, unnamed: these panels label their
    // rows themselves (sample names on the correlation matrix, gene
    // symbols in the loadings popup) and the payload's row identity is
    // about probes, which neither matrix has.
    rows: values.map((_, i) => ({
      // 🛑 The gutter falls back to `probe ${designElementId}` when a
      // row carries no label, which printed "probe 0, probe 1, …" down
      // the side of the sample-correlation matrix — whose rows are
      // SAMPLES and have no probes at all. The fix is to NAME the rows
      // (`labelSymbol` below); this id is only ever the fallback.
      designElementId: rows?.[i]?.designElementId ?? i,
      // 🛑 Only when the row IS a probe, which the caller signals by
      // giving a design-element id. The sample-correlation matrix names
      // its rows too, and filling these made its tooltip read
      // "PROBE ACHC35_3xLPS_3 (ACHC35_3xLPS_3)" — the sample's name as
      // a probe, and again as the gene it supposedly maps to.
      designElementName: isProbe(rows?.[i]) ? (rows?.[i]?.symbol ?? "") : "",
      geneIds: [],
      geneSymbols: isProbe(rows?.[i]) && rows?.[i]?.symbol ? [rows[i].symbol] : [],
      geneNames: rows?.[i] ? [rows[i].name] : undefined,
      labelSymbol: rows?.[i]?.symbol,
      labelName: rows?.[i]?.name,
    })),
    columns,
    // Passed through as-is: the payload's `Factor` is the SAME
    // snake_case shape the design editor uses (`factor_values`,
    // `free_text_label`, `is_baseline`), deliberately, so no adapter
    // sits between the editor's truth and what the strips draw. A
    // remapping here would be a second place for the two to drift.
    //
    // 🛑 One exception, and it is narrow. The widget reads
    // `numeric_value`, which `composeDesign` already fills from Gemma's
    // measurement — so this is a BACKSTOP, not a replacement: it fills
    // the field only where a continuous value arrived without one, from
    // the same shared reader `PcFactorCard` uses. A value that has a
    // measurement keeps it untouched.
    factors: design.factors.map((f) =>
      f.type === "continuous"
        ? {
            ...f,
            factor_values: (f.factor_values ?? []).map((fv) => ({
              ...fv,
              numeric_value: continuousFvValue(fv),
            })),
          }
        : f,
    ),
  };
}


/**
 * The number behind a continuous factor value.
 *
 * 🛑 `numeric_value` FIRST. It is the canonical scalar — `composeDesign`
 * fills it from Gemma's `FactorValue.measurement.value` for any value
 * flagged `is_measurement` — and `free_text_label` is the HUMAN
 * rendering of the same thing: "86 years", not "86". `Number("86
 * years")` is NaN, so a parser that reaches for the label first turns a
 * perfectly good measurement into a missing one, which is what
 * `PcFactorCard` was doing: every continuous factor contributed NaN to
 * its PC association and scored zero.
 *
 * The free-text parse stays as a fallback for a value a curator typed
 * that never went through a measurement, and the statement subject
 * behind that.
 *
 * Shared on purpose: the heatmap orders columns by these and the PC
 * card correlates them against the components. Two readings would be
 * two answers to "what is this sample's age".
 *
 * Null for anything unparseable — the honest answer for a continuous
 * factor whose values were never filled in. The strip then reads as
 * unassigned rather than as zero.
 */
export function continuousFvValue(fv: {
  numeric_value?: number | null;
  free_text_label?: string | null;
  statements?: Array<{ subject?: { label?: string | null } | null }> | null;
}): number | null {
  if (typeof fv.numeric_value === "number" && Number.isFinite(fv.numeric_value)) {
    return fv.numeric_value;
  }
  const raw = String(
    fv.free_text_label || fv.statements?.[0]?.subject?.label || "",
  ).trim();
  if (raw === "") return null;
  // Leading number, so "86 years" still reads as 86 when nothing set
  // the measurement.
  const m = raw.match(/^[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/);
  const n = m ? Number(m[0]) : Number(raw);
  return Number.isFinite(n) ? n : null;
}


/**
 * Attach per-sample sequencing QC as continuous strips.
 *
 * The correlation matrix answers "which samples resemble each other";
 * these answer "and how well did each one sequence", against the same
 * columns in the same order. Mapping rate and duplication owe nothing
 * to expression similarity, so a sample that is both poorly correlated
 * AND poorly mapped is a different call from one that is merely
 * poorly correlated — which was previously unanswerable from this panel
 * (Paul's idea; gembro's `/qc-metrics`, 2026-09-02).
 *
 * Returns the payload untouched when there is nothing to draw, so a
 * microarray dataset — which never has a MultiQC report — looks exactly
 * as it did.
 */
export function withQcMetricStrips(
  payload: ReturnType<typeof buildDesignHeatmapPayload>,
  qc: QcMetrics | null | undefined,
): ReturnType<typeof buildDesignHeatmapPayload> {
  if (!payload || !qc || !qc.report_present) return payload;
  const strips = qcStripMetrics(qc);
  if (strips.length === 0) return payload;

  const byAssay = new Map(qc.samples.map((s) => [s.bio_assay_id, s]));
  const added = strips.flatMap((strip, i) => {
    const measurements: Record<number, number> = {};
    for (const c of payload.columns) {
      const v = byAssay.get(Number(c.bioAssayId))?.values?.[strip.name];
      if (typeof v === "number" && Number.isFinite(v)) {
        measurements[Number(c.bioAssayId)] = v;
      }
    }
    // Every column or none: a gradient with holes in it cannot be read,
    // because a missing measurement and a low one look the same.
    if (Object.keys(measurements).length !== payload.columns.length) return [];
    return [
      {
        id: qcFactorId(i),
        name: strip.label,
        description:
          strip.meta?.description ||
          `sequencing QC: ${strip.name}${strip.meta?.namespace ? ` (${strip.meta.namespace})` : ""}`,
        type: "continuous" as const,
        category: { label: strip.label, uri: null },
        factor_values: [],
        continuousMeasurements: measurements,
      },
    ];
  });
  if (added.length === 0) return payload;
  return { ...payload, factors: [...payload.factors, ...added] };
}
