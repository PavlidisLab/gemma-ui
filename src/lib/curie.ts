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

export function shortenUri(uri: string | null | undefined): string {
  if (!uri) return "";
  // 1. underscore-separated CURIE in the path:
  //    .../OBO/MONDO_0004975, .../efo/EFO_0000513, .../ont/TGEMO_00184
  const m1 = uri.match(/[\/#]([A-Za-z][A-Za-z0-9]+)_(\w+)(?:[\/?#].*)?$/);
  if (m1) {
    const prefix = m1[1].toUpperCase();
    return `${prefix}:${m1[2]}`;
  }
  // 2. identifiers.org-style: /ncbigene/58203, /pubmed/12345678 etc.
  const m2 = uri.match(/identifiers\.org\/([a-z]+(?:Gene)?)\/(\w+)/i);
  if (m2) {
    const prefix = m2[1]
      .toUpperCase()
      .replace("NCBIGENE", "NCBI")
      .replace("PUBMED", "PMID");
    return `${prefix}:${m2[2]}`;
  }
  // 3. fallback: last path segment, capped, prefixed with "…"
  const tail = uri.split(/[\/#]/).filter(Boolean).pop() ?? uri;
  return tail.length > 24 ? `…${tail.slice(-22)}` : tail;
}
