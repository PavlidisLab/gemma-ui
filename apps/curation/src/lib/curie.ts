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
};

export function curieToUrl(uri: string | null | undefined): string | null {
  if (!uri) return null;
  if (/^https?:\/\//i.test(uri)) return uri;
  const m = uri.match(/^([A-Za-z][A-Za-z0-9]*):(.+)$/);
  if (m) {
    const prefix = CURIE_TO_URL_PREFIX[m[1]];
    if (prefix) return `${prefix}${m[2]}`;
    return `https://www.ebi.ac.uk/ols4/search?q=${encodeURIComponent(uri)}`;
  }
  return uri;
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
