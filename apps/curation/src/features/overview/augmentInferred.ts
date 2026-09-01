import { characteristicValues } from "@/features/experiment/characteristicValues";
import type { Biomaterial, Tag } from "@/features/experiment/types";

/** Inferred-tag augmenter: synthesises one chip per category from
 *  the biomaterial characteristics, capturing every distinct value
 *  across the cohort. Gemma's annotation feed only returns one row
 *  per (dataset, category) pair for BioMaterial-source annotations,
 *  so a 165-sample cohort with 6 organism_part values surfaces just
 *  one chip without this. Direct (curator-attached) tags are passed
 *  through untouched. Inferred tags whose category is also covered
 *  by biomaterial characteristics are dropped — the synth supersedes
 *  them with the comprehensive value set.
 *
 *  The synth chip uses ``inferred_source: "BioMaterial"`` and
 *  ``evidence_code: "IIA"`` because biomaterial characteristics on
 *  imported datasets came in via Gemma's GEO load. URIs flow
 *  through ``charUriLookup`` at split-time, so per-value chips
 *  render ontology-resolved when the underlying characteristic_uris
 *  carry term URIs.
 *
 *  Lives in its own .ts (not .tsx) file so React Fast Refresh
 *  doesn't complain about mixing component and non-component exports
 *  out of OverviewPanel.tsx. */
/** Dedupe key for a characteristic value: case-folded with INTERNAL
 *  whitespace collapsed, not just trimmed.
 *
 *  Submitters hand-type these strings per sample, so the same value
 *  arrives with drifting spacing — GSE102352 carries both
 *  ``"Cortical NSC/neurons at day 33 of neuronal  differentiation"``
 *  (two spaces) and the single-space spelling. A trim-only key treats
 *  those as two values, and since the synth chip comma-joins a
 *  category's values the curator reads the same text twice inside one
 *  chip. */
const valueKey = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export function augmentInferredFromBiomaterials(
  tags: Tag[],
  biomaterials: Biomaterial[],
): Tag[] {
  // catKey → (value dedupe key → first-seen spelling). The first
  // spelling wins for display; the key only decides sameness, so a
  // submitter's original spacing is never rewritten.
  const valuesByCat = new Map<string, Map<string, string>>();
  const catLabels = new Map<string, string>();
  for (const bm of biomaterials) {
    // Per characteristic, not per category: a category carrying two
    // characteristics is two values, and the joined ``A; B`` string is
    // neither of them. ``characteristicValues`` reads the fold's own
    // decomposition — see ``characteristicValues.ts``.
    for (const { category, label: val } of characteristicValues(bm)) {
      const key = category.toLowerCase();
      if (!catLabels.has(key)) catLabels.set(key, category);
      const byValue = valuesByCat.get(key) ?? new Map<string, string>();
      const vk = valueKey(val);
      if (!byValue.has(vk)) byValue.set(vk, val);
      valuesByCat.set(key, byValue);
    }
  }
  if (valuesByCat.size === 0) return tags;

  // Per-value cover: a direct tag suppresses re-synth of its OWN value
  // only, not the whole category — so other per-sample values still
  // surface as inherited, and deleting a redundant direct tag reveals
  // its inherited underlying value (design review 2026-07-20).
  const directPairs = new Set<string>();
  for (const t of tags) {
    if (t.inferred) continue;
    const c = (t.category.label || "").trim().toLowerCase();
    const v = valueKey(t.value?.label || "");
    if (c && v) directPairs.add(`${c}|${v}`);
  }

  const augmented: Tag[] = [];
  for (const t of tags) {
    if (!t.inferred) {
      augmented.push(t);
      continue;
    }
    // Existing inferred tag: drop it when the per-value biomaterial
    // synth below covers its category — the synth is the comprehensive
    // source. Pass through inferred tags for categories the
    // biomaterials don't carry.
    const k = (t.category.label || "").toLowerCase();
    if (valuesByCat.has(k)) continue;
    augmented.push(t);
  }

  // Negative ids keep the synth tags out of the way of any real
  // (server-assigned) tag id space. They're ephemeral display
  // entries; never round-tripped to the server.
  let nextSynthId = -1;
  for (const [catKey, byValue] of valuesByCat.entries()) {
    // Synth only the values NOT already carried by a direct tag; the
    // direct wins (and gets the redundancy glint), the rest surface as
    // inherited. Every value covered ⇒ nothing synthesized.
    const uncovered = Array.from(byValue.entries())
      .filter(([vk]) => !directPairs.has(`${catKey}|${vk}`))
      .map(([, display]) => display);
    if (uncovered.length === 0) continue;
    const sortedValues = uncovered.sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
    augmented.push({
      id: nextSynthId--,
      category: { label: catLabels.get(catKey) || catKey, uri: null },
      value: { label: sortedValues.join(", "), uri: null },
      inferred: true,
      inferred_source: "BioMaterial",
      evidence_code: "IIA",
    });
  }
  return augmented;
}
