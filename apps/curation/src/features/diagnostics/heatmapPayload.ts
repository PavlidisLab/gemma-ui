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
  datasetId: number;
}): HeatmapPayload | null {
  const { design, bioAssayIds, values, colLabels, datasetId } = args;
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
      designElementId: i,
      designElementName: "",
      geneIds: [],
      geneSymbols: [],
    })),
    columns,
    // Passed through as-is: the payload's `Factor` is the SAME
    // snake_case shape the design editor uses (`factor_values`,
    // `free_text_label`, `is_baseline`), deliberately, so no adapter
    // sits between the editor's truth and what the strips draw. A
    // remapping here would be a second place for the two to drift.
    factors: design.factors,
  };
}
