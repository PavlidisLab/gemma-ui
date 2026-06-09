/** Display helpers for FactorValue dropdowns / picker UIs.
 *
 *  Centralised here so the same disambiguation policy applies in
 *  every place a curator picks an FV by label — the per-cell select
 *  in ``SampleDetailsPanel``, the bulk-assign table in
 *  ``BulkAssignPanel``, and any future picker.
 */

export interface FvLabelInput {
  id: number;
  free_text_label?: string | null;
  is_baseline?: boolean;
  /** Source-of-truth assignment list. Used to surface "no samples"
   *  warnings in the picker so the curator notices empty FVs. */
  biomaterial_short_names?: string[];
}

/** Build the visible text for an FV ``<option>``.
 *
 *  Three nudges baked in:
 *
 *  1. **Disambiguation.** Two FVs in the same factor can share a
 *     ``free_text_label`` (saw 2026-06-06 on GSE319237: two
 *     "Igf1-Egfp transgenic" FVs for the EGFP+/EGFP- sort).
 *     When a non-empty label appears more than once in ``allFvs``,
 *     append ``(id N)`` to every matching option so each is uniquely
 *     identifiable. Singletons render clean.
 *
 *  2. **Sample count.** Append ``(n=K)`` showing how many
 *     biomaterials are assigned to this FV. Gives the curator a
 *     fast read of partition balance during picking. Suppressed
 *     when ``opts.compact`` is set — used for the currently-
 *     selected option in a native ``<select>`` so the closed cell
 *     doesn't repeat the same ``(n=K)`` on every row of the same
 *     FV. Other options in the open dropdown still carry the
 *     count so the curator can compare partition sizes.
 *
 *  3. **Empty-FV warning.** When ``biomaterial_short_names`` is
 *     empty (and the input carries the field at all — undefined is
 *     treated as "we don't know, skip the warning"), prefix with
 *     ``⚠ no samples — ``. A factor value with no assignments is
 *     almost always a curation oversight (curator added a new level
 *     but didn't reassign any sample to it yet); surfacing it in
 *     every picker the FV appears in keeps the gap visible.
 *
 *  Empty labels fall back to ``FV {id}`` (existing behaviour) and
 *  are intrinsically id-unique so no extra disambiguation suffix is
 *  needed.
 *
 *  ``· baseline`` is appended last regardless.
 */
export function fvDisplayLabel(
  fv: FvLabelInput,
  allFvs: FvLabelInput[],
  opts?: { compact?: boolean },
): string {
  const base = fv.free_text_label || `FV ${fv.id}`;
  let out = base;
  if (fv.free_text_label) {
    let dupes = 0;
    for (const o of allFvs) {
      if ((o.free_text_label || "") === fv.free_text_label) dupes++;
      if (dupes > 1) break;
    }
    if (dupes > 1) out = `${base} (id ${fv.id})`;
  }
  if (fv.biomaterial_short_names !== undefined) {
    const n = fv.biomaterial_short_names.length;
    if (n === 0) {
      out = `⚠ no samples — ${out}`;
    } else if (!opts?.compact) {
      out = `${out} (n=${n})`;
    }
  }
  return fv.is_baseline ? `${out} · baseline` : out;
}
