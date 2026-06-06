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
}

/** Build the visible text for an FV ``<option>``.
 *
 *  Two FVs in the same factor can share a ``free_text_label`` —
 *  e.g. the curator just split an existing cohort with a new FV
 *  whose label hasn't been disambiguated yet (saw 2026-06-06 on
 *  GSE319237: two "Igf1-Egfp transgenic" FVs for the EGFP+ / EGFP-
 *  sort). Without intervention the dropdown renders both options
 *  identically and the curator can't pick one over the other.
 *
 *  Policy: when a non-empty label appears more than once in
 *  ``allFvs``, append ``(id N)`` to every matching option so each
 *  is uniquely identifiable. Singletons render clean.
 *
 *  Empty labels fall back to ``FV {id}`` (existing behaviour) and
 *  are intrinsically id-unique so no extra suffix is needed.
 *
 *  ``· baseline`` is appended last regardless.
 */
export function fvDisplayLabel(
  fv: FvLabelInput,
  allFvs: FvLabelInput[],
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
  return fv.is_baseline ? `${out} · baseline` : out;
}
