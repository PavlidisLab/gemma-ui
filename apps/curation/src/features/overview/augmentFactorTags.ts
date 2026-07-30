import type { Factor, Tag } from "@/features/experiment/types";

/** Inferred-tag augmenter: synthesises one chip per factor from
 *  ``design.factors``, with the factor's FV labels comma-joined in
 *  ``value.label``. Restores the visual + dedup behaviour that the
 *  OverviewPanel previously got from agents-side
 *  ``import_from_gemma.py`` step 4a, which built the same projection
 *  on the server and shipped it as a tag with
 *  ``inferred_source = "FactorValue"``.
 *
 *  Agents-side stopped emitting these on 2026-06-10 — the
 *  duplication was inflating eval F1 baselines as a factor-as-tag
 *  projection artifact. The UI re-synthesises locally so the dedup
 *  + grouping logic downstream (FV-synth wins over direct EE tags
 *  for the same category, sourceRank ordering, etc.) keeps working
 *  without any further changes. Long-term: refactor the OverviewPanel
 *  factors row to read from ``draft.factors`` directly instead of
 *  going through this projection.
 *
 *  Direct (curator-attached) tags pass through untouched. The synth
 *  uses negative ids so it can't collide with server-assigned tag
 *  ids; the chips are ephemeral display entries and never round-trip
 *  to the server. */
export function augmentInferredFromFactors(
  tags: Tag[],
  factors: Factor[],
): Tag[] {
  if (factors.length === 0) return tags;

  // Build the FV-projected entries.
  let nextSynthId = -1_000_000;
  const synth: Tag[] = [];
  for (const factor of factors) {
    // Continuous factors carry per-sample measurements (age in months,
    // expression level, dose curves), not a discrete category — one
    // FV per distinct number. Projecting those floods the tag bar with
    // dozens of meaningless numeric chips (1.691, 2.428, …). They have
    // no place in the inferred-tag row; the Design crosstab already
    // notes continuous factors are shown separately. Design review 2026-07-21.
    if (factor.type === "continuous") continue;
    const catLabel = (factor.category?.label || factor.name || "").trim();
    if (!catLabel) continue;
    // UNIQUE FV labels only. A factor routinely has several FVs that
    // share a label — a treatment factor with one DMSO arm per
    // timepoint carries five FVs all labelled "DMSO" — which otherwise
    // repeats the same chip once per arm. Case-insensitive dedup,
    // first spelling wins. Design review 2026-07-21.
    const seen = new Set<string>();
    const values: string[] = [];
    for (const fv of factor.factor_values ?? []) {
      const label = (fv.free_text_label || "").trim();
      if (!label) continue;
      const k = label.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      values.push(label);
    }
    if (values.length === 0) continue;
    // Sort case-insensitively for a stable, readable projection.
    const sorted = [...values].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
    synth.push({
      id: nextSynthId--,
      category: {
        label: catLabel,
        uri: factor.category?.uri ?? null,
      },
      value: { label: sorted.join(", "), uri: null },
      inferred: true,
      inferred_source: "FactorValue",
      evidence_code: "IIA",
    });
  }
  if (synth.length === 0) return tags;
  return [...tags, ...synth];
}
