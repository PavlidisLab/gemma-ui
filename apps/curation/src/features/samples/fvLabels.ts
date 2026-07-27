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

/** Build the visible text + hover-tooltip for an FV ``<option>``.
 *
 *  Three nudges baked in:
 *
 *  1. **Disambiguation.** Two FVs in the same factor can share a
 *     ``free_text_label`` (saw 2026-06-06 on GSE319237: two
 *     "Igf1-Egfp transgenic" FVs for the EGFP+/EGFP- sort). When
 *     a non-empty label appears more than once in ``allFvs``, the
 *     id is surfaced on the option's ``title`` (tooltip) so the
 *     curator can hover to disambiguate without the noisy
 *     ``(id N)`` suffix invading the visible cell. Per design review
 *     2026-06-13: "only the actual label should be shown; if there
 *     is extra information to be shown, put it in a tooltip."
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
 *  are intrinsically id-unique so no disambiguation tooltip is
 *  added in that case.
 *
 *  ``· baseline`` is appended last regardless.
 */
export interface FvDisplayResult {
  /** The visible cell / option text. */
  text: string;
  /** Hover tooltip — populated when the FV's label collides with
   *  another in ``allFvs``; carries ``id N`` so the curator can
   *  disambiguate. Empty string when no tooltip is needed (most
   *  rows); callers can spread it directly into ``title=`` and
   *  most browsers omit an empty title attribute. */
  title: string;
}

export function fvDisplayLabel(
  fv: FvLabelInput,
  allFvs: FvLabelInput[],
  opts?: { compact?: boolean },
): FvDisplayResult {
  const base = fv.free_text_label || `FV ${fv.id}`;
  let out = base;
  let title = "";
  if (fv.free_text_label) {
    let dupes = 0;
    for (const o of allFvs) {
      if ((o.free_text_label || "") === fv.free_text_label) dupes++;
      if (dupes > 1) break;
    }
    if (dupes > 1) {
      // Disambiguation moves to the hover tooltip instead of the
      // visible text (design review 2026-06-13).
      title = `id ${fv.id}`;
    }
  }
  if (fv.biomaterial_short_names !== undefined) {
    const n = fv.biomaterial_short_names.length;
    if (n === 0) {
      out = `⚠ no samples — ${out}`;
    } else if (!opts?.compact) {
      out = `${out} (n=${n})`;
    }
  }
  if (fv.is_baseline) out = `${out} · baseline`;
  return { text: out, title };
}
