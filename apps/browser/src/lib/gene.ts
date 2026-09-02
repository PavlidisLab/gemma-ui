/**
 * Gene-label display rules for the browse surfaces.
 *
 * A gene reaches the annotation list as an ontology-shaped term — an
 * NCBI gene URI plus whatever label the producing tool wrote — and
 * those labels arrive long:
 *
 *   "Tardbp [mouse] TAR DNA binding protein"
 *   "Esr1 estrogen receptor 1"
 *   "ESR1 — estrogen receptor 1"
 *
 * Rendered verbatim they crowd out the CURIE and make two chips that
 * differ only by gene id look like a wall of prose. The chip shows the
 * SYMBOL and keeps the full label on hover.
 *
 * A local port of ``apps/curation/src/lib/gene.ts``, matching how
 * ``baseline.ts`` / ``OntologyTermChip`` port curation display
 * conventions into this app rather than acquiring a cross-app import.
 * The curation copy is the original; keep the parse in step with it.
 *
 * 🛑 Display only. Never key equality, dedup or a search haystack off
 * the short form — "TAR DNA binding protein" has to keep finding
 * Tardbp.
 */
import { ncbiGeneIdFromUri } from "./curie";

/** Is this term a gene? Decided by the URI, never by the label — a
 *  bare "ESR1" written as free text is an unresolved string, and
 *  shortening it as though we knew it were a gene would invent a
 *  fact. */
export function isGeneUri(uri: string | null | undefined): boolean {
  return ncbiGeneIdFromUri(uri) !== null;
}

export interface GeneLabelParts {
  /** The symbol as written. Case is meaningful (human upper,
   *  mouse/rat title) so it is preserved, never normalized. */
  symbol: string;
  /** Species as the label states it, in whatever form it used. Null
   *  when the label doesn't say. */
  species: string | null;
  /** The descriptive name. Null when the label is symbol-only. */
  fullName: string | null;
}

/** Split a gene label into symbol / species / full name.
 *
 *  Only the first token is the symbol; a bracketed species is consumed
 *  if it directly follows, and the rest is the name, with an em-dash
 *  or hyphen separator dropped from its front. A blank label yields a
 *  blank symbol so callers fall back to what they were given rather
 *  than rendering an empty chip. */
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

/** What a chip should print for this term.
 *
 *  A no-op for anything that isn't a gene URI, so it is safe to wrap a
 *  label whose kind you don't know. */
export function geneDisplayLabel(
  label: string | null | undefined,
  uri: string | null | undefined,
): string {
  const text = (label ?? "").trim();
  if (!isGeneUri(uri)) return text;
  return parseGeneLabel(text).symbol || text;
}
