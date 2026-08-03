/**
 * Compact CURIE rendering for ontology URIs.
 *
 * Examples:
 *   http://purl.obolibrary.org/obo/HP_0002511        → HP:0002511
 *   http://purl.obolibrary.org/obo/MONDO_0004975     → MONDO:0004975
 *   http://www.ebi.ac.uk/efo/EFO_0000513             → EFO:0000513
 *   http://identifiers.org/ncbigene/58203            → NCBI:58203
 *   http://gemma.msl.ubc.ca/ont/TGEMO_00184          → TGEMO:00184
 *
 * Used in every place we display an ontology term inline (Term
 * chip, picker dropdowns, statement subject/object suffixes) so
 * long URLs never blow up the layout.
 *
 * Strategy: match a CURIE-style segment at the end of the path
 * (`<PREFIX>_<id>` or `<prefix>/<id>` for identifiers.org-style
 * URLs). If the URI doesn't match anything we recognise, return a
 * trimmed tail rather than the full URL — that's still better
 * than a 50-char wrap.
 */

/** Maps a CURIE (e.g. ``UBERON:0034920``) to a clickable full URL.
 *  Returns full URLs unchanged. Returns ``null`` for empty input.
 *  Unknown prefixes fall back to an OLS search query so the curator
 *  still gets *somewhere* useful.
 *
 *  Needed because some upstream fields (FV statement subject/object,
 *  on certain agent payloads) ship URIs as bare CURIEs rather than
 *  fully-qualified URLs; rendering those as ``href`` attributes
 *  yields broken relative links. */
const CURIE_TO_URL_PREFIX: Record<string, string> = {
  UBERON: "http://purl.obolibrary.org/obo/UBERON_",
  MONDO: "http://purl.obolibrary.org/obo/MONDO_",
  EFO: "http://www.ebi.ac.uk/efo/EFO_",
  PATO: "http://purl.obolibrary.org/obo/PATO_",
  OBI: "http://purl.obolibrary.org/obo/OBI_",
  CL: "http://purl.obolibrary.org/obo/CL_",
  CHEBI: "http://purl.obolibrary.org/obo/CHEBI_",
  HP: "http://purl.obolibrary.org/obo/HP_",
  GO: "http://purl.obolibrary.org/obo/GO_",
  RO: "http://purl.obolibrary.org/obo/RO_",
  BFO: "http://purl.obolibrary.org/obo/BFO_",
  TGEMO: "http://gemma.msl.ubc.ca/ont/TGEMO_",
  NCBITaxon: "http://purl.obolibrary.org/obo/NCBITaxon_",
  // Cellosaurus cell-line accessions ship as ``cellosaurus:CVCL_0395``.
  // The accession already carries its ``CVCL_`` prefix, so the base is
  // just the site root → ``https://www.cellosaurus.org/CVCL_0395``.
  cellosaurus: "https://www.cellosaurus.org/",
};

/** Cellosaurus cell-line link — ONLY for cell lines. Two shapes:
 *   1. Term carries a ``CVCL_<digits>`` accession (``cellosaurus:CVCL_0395``,
 *      a bare ``CVCL_0395``, a full cellosaurus URL, or the
 *      ``cellosaurus:CVCL_1045:SX`` sex-provenance shape — the trailing
 *      ``:SX`` is dropped) → the canonical page
 *      ``https://www.cellosaurus.org/CVCL_0395``.
 *   2. Cell Line Ontology term (``…/obo/CLO_0051454``, no CVCL id) → we
 *      can't address a page, so fall back to a Cellosaurus site SEARCH by
 *      the cell-line name (``label``): ``…/search?query=KGN``. Needs the
 *      label; returns ``null`` without one.
 *  Returns ``null`` for any term that isn't a cell line. */
export function cellosaurusUrl(
  uri: string | null | undefined,
  label?: string | null,
): string | null {
  if (!uri) return null;
  const m = uri.match(/CVCL_\d+/i);
  if (m) return `https://www.cellosaurus.org/${m[0].toUpperCase()}`;
  const name = (label ?? "").trim();
  if (name && /\bCLO_\d+/i.test(uri)) {
    return `https://www.cellosaurus.org/search?query=${encodeURIComponent(
      name,
    )}`;
  }
  return null;
}

/** EBI OLS4 link-out for an ontology term. Resolves the input to a full
 *  IRI first (so a bare CURIE still lands an exact match), then hands OLS
 *  the IRI with ``exactMatch`` so the curator opens the term itself, not
 *  a fuzzy result list. Returns ``null`` for empty input. */
export function olsUrl(uri: string | null | undefined): string | null {
  if (!uri) return null;
  const iri = curieToUrl(uri) ?? uri;
  return `https://www.ebi.ac.uk/ols4/search?q=${encodeURIComponent(
    iri,
  )}&exactMatch=true`;
}

export function curieToUrl(uri: string | null | undefined): string | null {
  if (!uri) return null;
  // Double-mangled IRI: some upstream snapshots glue the obo-purl
  // prefix onto an ALREADY-full IRI and mangle the inner scheme's
  // ``://`` down to ``_//`` — e.g. the shipped TGEMO.tsv synonym
  // snapshot emits
  // ``http://purl.obolibrary.org/obo/http_//gemma.msl.ubc.ca/ont/TGEMO_00001``
  // for what should be ``http://gemma.msl.ubc.ca/ont/TGEMO_00001``. Left
  // as-is this 404s in the "open in OBO" link AND misses Gemma's term
  // endpoint (queried by IRI), so the popover wrongly reads "Gemma
  // doesn't know this term". Peel the bogus prefix, restore the inner
  // scheme, and re-run through this router so the recovered IRI still
  // gets namespace-canonicalised.
  const doubleMangled = uri.match(
    /^https?:\/\/purl\.obolibrary\.org\/obo\/(https?)_\/\/(.+)$/i,
  );
  if (doubleMangled) {
    return curieToUrl(`${doubleMangled[1]}://${doubleMangled[2]}`);
  }
  // Some prefixes are sometimes mis-namespaced under the OBO purl by
  // upstream sources (the agent ontology index / predicates.json emit
  // e.g. ``http://purl.obolibrary.org/obo/EFO_0022874`` or
  // ``…/obo/TGEMO_00171``). purl.obolibrary.org does NOT host EFO
  // (canonical: ebi.ac.uk/efo) or TGEMO (Gemma's own ontology,
  // canonical: gemma.msl.ubc.ca/ont) — those links 404 ("Term not
  // found / open in OBO"). Rewrite to the canonical namespace, matching
  // how the EFO:/TGEMO: CURIE prefixes already resolve. GSE87281 anchor.
  const oboMis = uri.match(
    /^https?:\/\/purl\.obolibrary\.org\/obo\/(EFO|TGEMO)_(\w+)$/i,
  );
  if (oboMis) {
    const pfx = oboMis[1].toUpperCase();
    const ns =
      pfx === "EFO"
        ? "http://www.ebi.ac.uk/efo/EFO_"
        : "http://gemma.msl.ubc.ca/ont/TGEMO_";
    return `${ns}${oboMis[2]}`;
  }
  if (/^https?:\/\//i.test(uri)) return uri;
  // NCBI gene CURIEs carry two colons (``NCBI:gene:948``) so the
  // generic single-colon split below misses them. Route to the
  // canonical NCBI Gene page when the shape matches.
  const ncbi = ncbiGeneIdFromUri(uri);
  if (ncbi) return ncbiGeneUrl(ncbi);
  const m = uri.match(/^([A-Za-z][A-Za-z0-9]*):(.+)$/);
  if (m) {
    const prefix = CURIE_TO_URL_PREFIX[m[1]];
    if (prefix) return `${prefix}${m[2]}`;
    return `https://www.ebi.ac.uk/ols4/search?q=${encodeURIComponent(uri)}`;
  }
  return uri;
}

/** Extract the Entrez Gene ID from any of the URI / CURIE shapes
 *  curation surfaces produce for NCBI genes:
 *    - ``http://identifiers.org/ncbigene/948``
 *    - ``.../record/ncbi_gene/948`` (Pavlab commons)
 *    - ``NCBI:gene:948`` (display CURIE)
 *    - ``ncbigene:948``
 *  Returns ``null`` for any other shape so callers can fall through
 *  to the ontology lookup path. */
export function ncbiGeneIdFromUri(
  uri: string | null | undefined,
): string | null {
  if (!uri) return null;
  const fromPath = uri.match(/ncbi_?gene\/(\d+)(?:[/?#].*)?$/i);
  if (fromPath) return fromPath[1];
  const fromCurie =
    uri.match(/^NCBI:gene:(\d+)$/i) || uri.match(/^ncbigene:(\d+)$/i);
  if (fromCurie) return fromCurie[1];
  return null;
}

export function ncbiGeneUrl(geneId: string): string {
  return `https://www.ncbi.nlm.nih.gov/gene/${geneId}`;
}

export function shortenUri(uri: string | null | undefined): string {
  if (!uri) return "";
  // 1. Pavlab/commons NCBI gene: .../record/ncbi_gene/19934 →
  //    "NCBI:gene:19934". Listed first because the generic
  //    underscore-CURIE rule below ALSO matches "ncbi_gene" but
  //    swallows the gene id as if "gene" were the local identifier,
  //    losing the actual species-distinguishing ID. Carve out the
  //    NCBI gene shape explicitly so the ID always shows.
  const mNcbi = uri.match(/ncbi_gene\/(\d+)(?:[/?#].*)?$/i);
  if (mNcbi) return `NCBI:gene:${mNcbi[1]}`;
  // 2. underscore-separated CURIE in the path:
  //    .../OBO/MONDO_0004975, .../efo/EFO_0000513, .../ont/TGEMO_00184
  const m1 = uri.match(/[/#]([A-Za-z][A-Za-z0-9]+)_(\w+)(?:[/?#].*)?$/);
  if (m1) {
    const prefix = m1[1].toUpperCase();
    return `${prefix}:${m1[2]}`;
  }
  // 3. identifiers.org-style: /ncbigene/58203, /pubmed/12345678 etc.
  const m2 = uri.match(/identifiers\.org\/([a-z]+(?:Gene)?)\/(\w+)/i);
  if (m2) {
    const prefix = m2[1]
      .toUpperCase()
      .replace("NCBIGENE", "NCBI:gene")
      .replace("PUBMED", "PMID");
    return `${prefix}:${m2[2]}`;
  }
  // 4. fallback: last path segment, capped, prefixed with "…"
  const tail = uri.split(/[/#]/).filter(Boolean).pop() ?? uri;
  return tail.length > 24 ? `…${tail.slice(-22)}` : tail;
}
