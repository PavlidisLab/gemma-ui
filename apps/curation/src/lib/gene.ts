/**
 * Gene-label display rules.
 *
 * A gene reaches the UI as an ontology-shaped term — an NCBI gene URI
 * plus whatever label the producing tool wrote — and those labels come
 * in at least four shapes, because they come from four places:
 *
 *   "ESR1"                                    a curator's own binding
 *   "ESR1 [human] estrogen receptor 1"        Gemma's prior-usage index
 *   "Esr1 estrogen receptor 1"                Gemma's gene catalogue
 *   "ESR1 — estrogen receptor 1"              the NCBI esummary adapter
 *
 * Rendered verbatim they are long, they push the CURIE out of a chip,
 * and the species — the one thing that decides whether the binding is
 * right — is either buried mid-string or missing. So chips show the
 * SYMBOL, mark the species beside it, and keep the full name for the
 * tooltip.
 *
 * Species is read off the label only. A lookup by gene id would be
 * authoritative (Gemma's ``/rest/v2/genes/{ncbiId}`` carries taxon and
 * official symbol), but it isn't wired, so a bare "ESR1" resolves to
 * UNKNOWN rather than to a guess — and unknown is flagged, not
 * silently passed. See ``geneSpeciesVerdict``.
 */
import { ncbiGeneIdFromUri } from "./curie";
import { taxonNamesMatch } from "./taxon";

/** Is this term a gene? Gene-ness is decided by the URI, never by the
 *  label — "ESR1" as free text is a curator's unresolved string, and
 *  rewriting it as though we knew it was a gene would invent a fact. */
export function isGeneUri(uri: string | null | undefined): boolean {
  return ncbiGeneIdFromUri(uri) !== null;
}

export interface GeneLabelParts {
  /** The symbol as written — "ESR1", "Esr1". Case is meaningful
   *  (human upper, mouse/rat title) so it is preserved, never
   *  normalized. */
  symbol: string;
  /** Species as the label states it, in whatever form it used
   *  ("human", "Mus musculus"). Null when the label doesn't say. */
  species: string | null;
  /** The descriptive name — "estrogen receptor 1". Null when the
   *  label is symbol-only. */
  fullName: string | null;
}

/** Split a gene label into symbol / species / full name.
 *
 * Only the first token is treated as the symbol; a species in square
 * brackets is consumed if it directly follows, and everything left is
 * the name. An em-dash or hyphen separator (the NCBI adapter's form)
 * is dropped from the front of the name.
 *
 * A blank label yields a blank symbol — callers fall back to rendering
 * what they were given rather than an empty chip. */
export function parseGeneLabel(
  label: string | null | undefined,
): GeneLabelParts {
  const text = (label ?? "").trim();
  if (!text) return { symbol: "", species: null, fullName: null };

  const bracket = text.match(/^(\S+)\s*\[([^\]]+)\]\s*(.*)$/);
  if (bracket) {
    return {
      symbol: bracket[1],
      species: bracket[2].trim() || null,
      fullName: stripSeparator(bracket[3]) || null,
    };
  }

  const spaced = text.match(/^(\S+)\s+(.*)$/);
  if (spaced) {
    return {
      symbol: spaced[1],
      species: null,
      fullName: stripSeparator(spaced[2]) || null,
    };
  }

  return { symbol: text, species: null, fullName: null };
}

function stripSeparator(rest: string): string {
  return rest.replace(/^[—–-]\s*/, "").trim();
}

/** What the species marker on a gene chip is saying.
 *
 *  - ``match``    — the gene's species is the dataset's. Quiet.
 *  - ``mismatch`` — they disagree. Amber: it may still be deliberate
 *    (a human transgene in a mouse, a xenograft) which is why this
 *    flags rather than blocks.
 *  - ``unknown``  — the label doesn't say what species this is, so
 *    nobody can tell whether it's right. Also amber, per the rule that
 *    an unverifiable binding is not the same as a verified one.
 *  - ``unchecked``— we know the gene's species but not the dataset's
 *    (a surface rendering outside an experiment). Show the species,
 *    claim nothing. */
export type GeneSpeciesVerdict =
  | "match"
  | "mismatch"
  | "unknown"
  | "unchecked";

export function geneSpeciesVerdict(
  geneSpecies: string | null | undefined,
  datasetTaxon: string | null | undefined,
): GeneSpeciesVerdict {
  if (!geneSpecies?.trim()) return "unknown";
  if (!datasetTaxon?.trim()) return "unchecked";
  return taxonNamesMatch(geneSpecies, datasetTaxon) ? "match" : "mismatch";
}

/** Does this verdict warrant the amber "check me" treatment? */
export function geneSpeciesNeedsCheck(v: GeneSpeciesVerdict): boolean {
  return v === "mismatch" || v === "unknown";
}

/** The species line for a gene's tooltip. One wording, shared by the
 *  chip and the picker row, so the same gene explains itself the same
 *  way wherever a curator meets it. */
export function geneSpeciesNote(
  verdict: GeneSpeciesVerdict,
  geneSpecies: string | null | undefined,
  datasetTaxon: string | null | undefined,
): string {
  switch (verdict) {
    case "match":
      return `Species: ${geneSpecies} — matches the dataset.`;
    case "mismatch":
      return (
        `Species: ${geneSpecies}, but this dataset is ${datasetTaxon}. ` +
        `Check this is the gene you meant — a cross-species binding can ` +
        `be right (a transgene, a xenograft), which is why this flags ` +
        `rather than blocks.`
      );
    case "unknown":
      return (
        `Species: not stated on this label, so it can't be checked ` +
        `against the dataset${datasetTaxon ? ` (${datasetTaxon})` : ""}. ` +
        `Open the CURIE to see which gene this id is.`
      );
    case "unchecked":
      return `Species: ${geneSpecies}.`;
  }
}
