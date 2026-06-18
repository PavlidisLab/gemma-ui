/**
 * Taxon (species) display helpers for gene-shaped annotation hits.
 *
 * Gemma's ``/annotations/search`` ships ``taxon_common_name``
 * (``"mouse"``) and ``taxon_scientific_name`` (``"Mus musculus"``)
 * on gene hits, but NO pre-computed abbreviation. The picker shows
 * the compact ``H.s.`` / ``M.m.`` form next to a gene symbol so a
 * curator can tell ``KRAS (H.s.)`` from ``Kras (M.m.)`` at a glance —
 * wrong-species bindings are a Tier-1 failure mode. We derive that
 * abbreviation client-side here.
 *
 * See handoff UIB_HANDOFF_2026_06_18_ANNOTATION_SEARCH_GENE_TAXON.
 */

/**
 * Genus-species → ``G.s.`` abbreviation.
 *
 *   ``Homo sapiens``     → ``H.s.``
 *   ``Mus musculus``     → ``M.m.``
 *   ``Rattus norvegicus``→ ``R.n.``
 *   ``Danio rerio``      → ``D.r.``
 *
 * Returns ``""`` when the scientific name is null / blank / a single
 * word, so callers can omit the suffix gracefully.
 */
export function taxonAbbreviation(
  scientificName: string | null | undefined,
): string {
  if (!scientificName) return "";
  const parts = scientificName.trim().split(/\s+/);
  if (parts.length < 2) return "";
  const genus = parts[0][0]?.toUpperCase() ?? "";
  const species = parts[1][0]?.toLowerCase() ?? "";
  return genus && species ? `${genus}.${species}.` : "";
}

/**
 * Rough lab-frequency ordering so that, when a gene symbol matches
 * across species, the picker clusters them human → mouse → rat →
 * everything else. Lower number sorts first. Keyed on common name
 * first (cheap, stable), falling back to the scientific name.
 */
export function taxonSortPriority(
  commonName: string | null | undefined,
  scientificName: string | null | undefined,
): number {
  const c = (commonName ?? "").trim().toLowerCase();
  const s = (scientificName ?? "").trim().toLowerCase();
  if (c === "human" || s === "homo sapiens") return 0;
  if (c === "mouse" || s === "mus musculus") return 1;
  if (c === "rat" || s === "rattus norvegicus") return 2;
  return 3;
}
