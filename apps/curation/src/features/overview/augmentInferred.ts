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
export function augmentInferredFromBiomaterials(
  tags: Tag[],
  biomaterials: Biomaterial[],
): Tag[] {
  const valuesByCat = new Map<string, Set<string>>();
  const catLabels = new Map<string, string>();
  for (const bm of biomaterials) {
    const chars = bm.characteristics ?? {};
    for (const [catLabel, valLabel] of Object.entries(chars)) {
      const cat = (catLabel || "").trim();
      const val = (valLabel || "").trim();
      if (!cat || !val) continue;
      const key = cat.toLowerCase();
      if (!catLabels.has(key)) catLabels.set(key, cat);
      const set = valuesByCat.get(key) ?? new Set<string>();
      set.add(val);
      valuesByCat.set(key, set);
    }
  }
  if (valuesByCat.size === 0) return tags;

  const directCats = new Set<string>();
  for (const t of tags) {
    if (t.inferred) continue;
    const k = (t.category.label || "").toLowerCase();
    if (k) directCats.add(k);
  }

  const augmented: Tag[] = [];
  for (const t of tags) {
    if (!t.inferred) {
      augmented.push(t);
      continue;
    }
    const k = (t.category.label || "").toLowerCase();
    if (valuesByCat.has(k) && !directCats.has(k)) continue;
    augmented.push(t);
  }

  // Negative ids keep the synth tags out of the way of any real
  // (server-assigned) tag id space. They're ephemeral display
  // entries; never round-tripped to the server.
  let nextSynthId = -1;
  for (const [catKey, valSet] of valuesByCat.entries()) {
    if (directCats.has(catKey)) continue;
    const sortedValues = Array.from(valSet).sort((a, b) =>
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
