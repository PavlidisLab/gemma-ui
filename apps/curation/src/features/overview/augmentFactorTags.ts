import type { Factor, Statement, Tag } from "@/features/experiment/types";

/** A statement rendered as text: ``subject predicate object``, the
 *  same reading order ``TagStatementInline`` and the Design tab's
 *  ``FvDisplayRow`` use. Empty when the statement carries no subject.
 *
 *  Kept comma-free on purpose — the chip renderer splits a synth
 *  value on ``,`` to get one chip per value, so a comma inside a
 *  statement would tear it in half. */
function statementText(st: Statement): string {
  const parts = [
    (st.subject?.label || "").trim(),
    (st.predicate?.label || "").trim(),
    (st.object?.label || "").trim(),
  ].filter(Boolean);
  return parts.join(" ");
}

/** Does this statement say more than its bare subject? A statement
 *  with no predicate and no object IS the leading term, so the FV's
 *  own free-text label is the better display. */
function isQualified(st: Statement): boolean {
  return !!(st.predicate?.label || "").trim() || !!(st.object?.label || "").trim();
}

/** What a projected FV chip shows.
 *
 *  A qualified statement is shown IN FULL — ``lung adenocarcinoma has
 *  modifier organoid``, not the leading ``lung adenocarcinoma``. The
 *  leading term alone makes two different arms of a factor render as
 *  the same chip, and it makes an experiment-level tag carrying that
 *  same term look like a duplicate of the whole arm when it is not
 *  (design review 2026-09-20, GSE276387: three ``disease`` arms all led by
 *  ``lung adenocarcinoma``). Unqualified FVs keep their free-text
 *  label, which is the curator's own spelling. */
function fvDisplayLabel(
  fv: NonNullable<Factor["factor_values"]>[number],
): string {
  const qualified = (fv.statements ?? []).filter(isQualified);
  if (qualified.length > 0) {
    const texts = qualified.map(statementText).filter(Boolean);
    if (texts.length > 0) return texts.join(" · ");
  }
  return (fv.free_text_label || "").trim();
}

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
      const label = fvDisplayLabel(fv);
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
  // Statements whose OWN category differs from their factor's. The
  // projection above asks "what is this factor about?"; this asks
  // "what category is each term actually serving?", which is the
  // question a reader of the tag bar has.
  //
  // GSE9012 is the case that exposed it: a `genotype` factor whose two
  // FVs each carry a second statement categorised `organism part` —
  // hepatocellular carcinoma on one arm, liver on the other. Those are
  // the ONLY organism-part facts in the whole design (no EE tag, no
  // sample characteristic carries one), so the overview showed nothing
  // and the experiment read as having no anatomy at all. Gemma's own
  // /datasets/{id}/annotations surfaces them, which is why the public
  // browser shows the chip and this page didn't.
  //
  // Divergence is normal, not a defect — roughly 95 of 3,731 gold
  // statements differ from their factor deliberately (see da374c5), so
  // this reports rather than flags.
  //
  // Merged across factors by category so two factors carrying organism
  // part yield one chip, not two.
  const byCategory = new Map<
    string,
    { label: string; uri: string | null; values: string[]; seen: Set<string> }
  >();
  for (const factor of factors) {
    if (factor.type === "continuous") continue;
    const factorCat = (factor.category?.label || factor.name || "").trim().toLowerCase();
    for (const fv of factor.factor_values ?? []) {
      for (const st of fv.statements ?? []) {
        const catLabel = (st.category?.label || "").trim();
        // No category of its own, or the same one the factor already
        // projected — either way the chip above covers it.
        if (!catLabel || catLabel.toLowerCase() === factorCat) continue;
        // Full statement, not the bare subject — same rule as the
        // projection above.
        const subject = statementText(st);
        if (!subject) continue;
        const key = catLabel.toLowerCase();
        const entry =
          byCategory.get(key) ??
          { label: catLabel, uri: st.category?.uri ?? null, values: [], seen: new Set<string>() };
        const vk = subject.toLowerCase();
        if (!entry.seen.has(vk)) {
          entry.seen.add(vk);
          entry.values.push(subject);
        }
        byCategory.set(key, entry);
      }
    }
  }
  for (const entry of byCategory.values()) {
    synth.push({
      id: nextSynthId--,
      category: { label: entry.label, uri: entry.uri },
      value: {
        label: [...entry.values]
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
          .join(", "),
        uri: null,
      },
      inferred: true,
      inferred_source: "Statement",
      evidence_code: "IIA",
    });
  }

  if (synth.length === 0) return tags;
  return [...tags, ...synth];
}
