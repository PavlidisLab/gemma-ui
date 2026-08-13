import type {
  AnnotationTermDetail,
  TermSourceMetadata,
} from "@/api/annotations";

/**
 * Derived facts — what a catalogue already knows about a term, so a
 * curator doesn't have to curate it.
 *
 * Curation policy 2026-08-12: *we should not curate information we can
 * infer.* A disease intrinsic to a cell line is a property of the line,
 * not a finding about the experiment, so it comes off the curator's
 * plate — which only works if the UI puts it back on the screen.
 *
 * 🛑 Three provenance classes, and they must never render alike:
 *
 * - **curated** — a claim a human made and stands behind.
 * - **inherited** — the existing ``tag.inferred``: an annotation on this
 *   experiment re-presented at another level (a sample characteristic
 *   bubbled up to an experiment tag). Mechanical and lossless.
 * - **derived** — this module: a fact read from OUTSIDE the experiment,
 *   from a catalogue or the corpus. It can be wrong.
 *
 * The word is "derived", never "inferred" — ``inferred`` already means
 * the inherited class across ~190 sites, and two adjacent near-synonyms
 * for different trust levels is how curators stop trusting the chrome.
 *
 * Scope is deliberately wider than cell lines: genotypes and treatments
 * carry derivable facts too, and disease is not the only object type.
 * Handoff: UIB_REPLY_2026_08_12_DERIVED_FACTS_GRAMMAR_AND_THE_SLOT_YOU_ALREADY_HAVE.
 */

/** One fact a catalogue asserts about a term. ``value`` is plain text:
 *  no source ships a grounded URI for these yet, and a chip that opens
 *  a card Gemma can't resolve (NCBITaxon, verified 2026-08-12) would
 *  dead-end the curator. When the wire grows URI-carrying facts this
 *  type gains an object ref and the values become navigable. */
export interface DerivedFact {
  /** The relation, curator-facing: "disease", "species", "sex". */
  relation: string;
  /** The asserted value. */
  value: string;
  /** Which catalogue said so — becomes the row's badge. */
  source: "Cellosaurus" | "CLO";
  /** Which property of that catalogue it was read from, for the badge
   *  hover. When two catalogues disagree the curator needs to see which
   *  one is talking. */
  sourceDetail: string;
  /** ``warn`` is for a fact the curator must not miss (a contaminated
   *  or misidentified line). Everything else is reference. */
  tone: "info" | "warn";
}

/**
 * CLO records a line's disease as a description string rather than a
 * relation: ``"disease: plasmacytoma;   myeloma"``. Gemma started
 * serving it 2026-08-12 — in the SAME ``definition`` field that carries
 * genuine textual definitions (``CLO_0037272`` TMD8 has real prose), so
 * the two are indistinguishable by shape and rendering the string as-is
 * would put a derived fact in the "what this term means" slot.
 *
 * This is the ONE place that pattern-matches it, and the key list is an
 * allow-list of exactly one: across 500 CLO terms sampled from OLS,
 * 163 carried a description and **all 163** used ``disease:``. A general
 * ``^key:`` regex would swallow prose definitions that happen to open
 * with a word and a colon, which is why this isn't one.
 *
 * Interim by construction — delete it when the wire ships the fact
 * structured (asked for in the 2026-08-12 handoff, §7.1).
 */
const CLO_DESCRIPTION_KEY = /^disease:\s*(.+)$/is;

/** Split a CLO ``disease:`` description out of the definition slot.
 *  Returns the prose to render as a definition (empty when the whole
 *  string was a derived fact) plus the facts it yielded. A definition
 *  that doesn't match is passed through untouched. */
function splitCloDescription(
  definition: string,
  uri: string,
): { definition: string; facts: DerivedFact[] } {
  // Only CLO writes descriptions in this shape; don't pattern-match
  // every ontology's prose on the off chance.
  if (!/\/CLO_\d+$/.test(uri)) return { definition, facts: [] };
  const m = CLO_DESCRIPTION_KEY.exec(definition.trim());
  if (!m) return { definition, facts: [] };
  // ``plasmacytoma;   myeloma`` is two diseases, not one — the
  // multiplicity is real and each gets its own row.
  const facts = m[1]
    .split(";")
    .map((v) => v.trim())
    .filter(Boolean)
    .map(
      (value): DerivedFact => ({
        relation: "disease",
        value,
        source: "CLO",
        sourceDetail: "description",
        tone: "info",
      }),
    );
  return { definition: facts.length > 0 ? "" : definition, facts };
}

/** Facts carried by the Cellosaurus ``sourceMetadata`` block. Ordered
 *  most- to least- decision-relevant: a contamination flag changes what
 *  the curator does, a sex doesn't. */
function cellosaurusFacts(sm: TermSourceMetadata): DerivedFact[] {
  const facts: DerivedFact[] = [];
  const row = (
    relation: string,
    value: string | null | undefined,
    sourceDetail: string,
    tone: DerivedFact["tone"] = "info",
  ) => {
    const v = (value ?? "").trim();
    if (v) facts.push({ relation, value: v, source: "Cellosaurus", sourceDetail, tone });
  };
  // Contamination first and loudest — Cellosaurus saying the line is
  // not what its name claims is the one fact here that should stop a
  // curator mid-annotation.
  row("problematic", sm.problematic, "problematic", "warn");
  for (const s of sm.species ?? []) {
    const label = (s?.label ?? "").trim();
    if (!label) continue;
    // Taxon id rides in the value: Gemma serves no NCBITaxon card
    // (verified 2026-08-12), so this can't be a navigable chip.
    row("species", s?.ncbiTaxonId ? `${label} · NCBI Taxon ${s.ncbiTaxonId}` : label, "species-list");
  }
  row("cell line type", sm.cellLineType, "cell-line-type");
  // The same slot carries mouse strains, which is where the "not just
  // cell lines" half of this starts.
  row("strain type", sm.strainType, "strain-type");
  row("sex", sm.sex, "sex");
  return facts;
}

/**
 * Everything derived about one term, plus the definition text that
 * survives after any derived fact is lifted out of it.
 *
 * Callers render ``definition`` where they rendered ``detail.definition``
 * before, and ``facts`` in a block that is visibly not curated content.
 */
export function deriveFromTerm(detail: AnnotationTermDetail): {
  definition: string;
  facts: DerivedFact[];
} {
  const split = splitCloDescription(detail.definition ?? "", detail.uri ?? "");
  const sm = detail.sourceMetadata;
  return {
    definition: split.definition,
    facts: [...split.facts, ...(sm ? cellosaurusFacts(sm) : [])],
  };
}

/** The one fact that warrants interrupting the curator, if present.
 *  Split out so the popover can hoist it above the definition instead
 *  of burying it under a 900-character Cellosaurus dump. */
export function alertFact(facts: DerivedFact[]): DerivedFact | null {
  return facts.find((f) => f.tone === "warn") ?? null;
}
