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
 */

/**
 * Species name → ``G.s.`` abbreviation.
 *
 *   ``Homo sapiens``     → ``H.s.``
 *   ``Mus musculus``     → ``M.m.``
 *   ``Rattus norvegicus``→ ``R.n.``
 *   ``Danio rerio``      → ``D.r.``
 *
 * A common name is accepted too and routed through the pairing table
 * below (``human`` → ``H.s.``): gene labels state the species as
 * ``[human]`` while ``/annotations/search`` ships the scientific name,
 * and both end up in the same chip suffix.
 *
 * Returns ``""`` when the name is null / blank / a single word that
 * isn't a common name we know, so callers can omit the suffix
 * gracefully.
 */
export function taxonAbbreviation(
  scientificName: string | null | undefined,
): string {
  if (!scientificName) return "";
  const raw = scientificName.trim();
  const asCommon = TAXON_NAME_PAIRS.find(
    ([common]) => common === raw.toLowerCase(),
  );
  const parts = (asCommon ? asCommon[1] : raw).split(/\s+/);
  if (parts.length < 2) return "";
  const genus = parts[0][0]?.toUpperCase() ?? "";
  const species = parts[1][0]?.toLowerCase() ?? "";
  return genus && species ? `${genus}.${species}.` : "";
}

/**
 * Common name ↔ scientific name, for the species a curator meets. Gemma
 * stores a design's taxon as the common name (``"human"``) while GEO
 * writes the scientific one (``"Homo sapiens"``), so comparing the two
 * needs the pairing.
 */
const TAXON_NAME_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["human", "homo sapiens"],
  ["mouse", "mus musculus"],
  ["rat", "rattus norvegicus"],
  ["zebrafish", "danio rerio"],
  ["fly", "drosophila melanogaster"],
  ["worm", "caenorhabditis elegans"],
  ["yeast", "saccharomyces cerevisiae"],
  ["chicken", "gallus gallus"],
  ["pig", "sus scrofa"],
  ["cow", "bos taurus"],
  ["dog", "canis lupus familiaris"],
  ["rabbit", "oryctolagus cuniculus"],
  ["macaque", "macaca mulatta"],
];

/**
 * Do two taxon names refer to the same species? Accepts either name
 * form on either side (``"human"`` vs ``"Homo sapiens"`` matches).
 *
 * Returns ``false`` for a species not in the table above rather than
 * guessing — callers use this to decide whether a fact is already shown
 * elsewhere, and a wrong ``true`` there hides something.
 */
export function taxonNamesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const x = (a ?? "").trim().toLowerCase();
  const y = (b ?? "").trim().toLowerCase();
  if (!x || !y) return false;
  if (x === y) return true;
  return TAXON_NAME_PAIRS.some(
    ([common, scientific]) =>
      (x === common && y === scientific) || (x === scientific && y === common),
  );
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
