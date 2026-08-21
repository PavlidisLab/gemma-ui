import { describe, expect, it } from "vitest";
import { STATEMENT_TEMPLATES, templatesFor } from "./statementTemplates";
import { KNOWN_PREDICATE_URIS, PREDICATES } from "@/generated/predicates";

/**
 * Guards on the pre-baked statement shapes.
 *
 * These exist because a hand-built URI shipped wrong and nothing
 * caught it: the `gene knockdown` template emitted
 * `purl.obolibrary.org/obi/OBI_0002625`, which resolves to nothing in
 * Gemma — and Gemma hard-rejects an ungrounded term on commit, so the
 * template handed the curator a design that could not be saved. Every
 * URI a template bakes in is now checked against either the generated
 * predicate allow-list or the set of namespaces Gemma actually serves.
 */

// The three bases Gemma's ontologies live on. `/obi/` is NOT one of
// them — OBI terms take the ordinary `/obo/` path.
const KNOWN_TERM_BASES = [
  "http://purl.obolibrary.org/obo/",
  "http://www.ebi.ac.uk/efo/",
  "http://gemma.msl.ubc.ca/ont/",
];

describe("STATEMENT_TEMPLATES", () => {
  it("has unique ids", () => {
    const ids = STATEMENT_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("builds a predicate that is on the generated allow-list", () => {
    for (const t of STATEMENT_TEMPLATES) {
      const s = t.build(null);
      expect(s.predicate?.uri, `${t.id} predicate`).toBeTruthy();
      expect(
        KNOWN_PREDICATE_URIS.has(s.predicate!.uri!),
        `${t.id} predicate ${s.predicate!.uri} is not in predicates.json`,
      ).toBe(true);
    }
  });

  it("bakes in subject / object URIs only on namespaces Gemma serves", () => {
    for (const t of STATEMENT_TEMPLATES) {
      const s = t.build(null);
      for (const [slot, term] of [
        ["subject", s.subject],
        ["object", s.object],
      ] as const) {
        // A blank slot is the curator's to fill — only pre-filled terms
        // carry a URI, and only those can be wrong here.
        if (!term?.uri) continue;
        expect(
          KNOWN_TERM_BASES.some((b) => term.uri!.startsWith(b)),
          `${t.id} ${slot} ${term.uri} is on an unknown namespace`,
        ).toBe(true);
      }
    }
  });

  it("carries the factor's category onto the built statement", () => {
    const cat = { label: "treatment", uri: "http://www.ebi.ac.uk/efo/EFO_0000727" };
    for (const t of STATEMENT_TEMPLATES) {
      expect(t.build(cat).category, `${t.id} category`).toEqual(cat);
      expect(t.build(null).category, `${t.id} null category`).toBeNull();
    }
  });

  it("offers the composed shapes from the curation rules", () => {
    // 13_statement_templates §1-§8. Named explicitly so dropping one is
    // a deliberate act rather than an accident of an edit elsewhere.
    const ids = new Set(STATEMENT_TEMPLATES.map((t) => t.id));
    for (const id of [
      "cell-type-from-tissue", // §1 cell type out of a tissue
      "cell-type-from-line", // §2 cell type off a line
      "culture-modality-organoid", // §3 organoid is a modifier, not a part
      "disease-induced-by", // §4 disease model
      "treatment-protein-gene", // §5 the catalog triplet
      "treatment-protein-dose", // §5 dose on the protein subject
      "genotype-ko", // §6 gene plus zygosity
      "baseline-has-role", // §7 reference roles
      "dea-subset-axis", // §8 has role names the sub-experiment
    ]) {
      expect(ids.has(id), `missing template ${id}`).toBe(true);
    }
  });
});

describe("templatesFor", () => {
  it("returns every template whatever the category — ordered, not filtered", () => {
    // A factor value routinely carries a statement from a SECOND
    // category, so the menu orders by relevance rather than hiding.
    expect(templatesFor(null)).toHaveLength(STATEMENT_TEMPLATES.length);
    expect(
      templatesFor({ label: "genotype", uri: null }),
    ).toHaveLength(STATEMENT_TEMPLATES.length);
  });

  it("floats the matching category and the generic patterns to the top", () => {
    const ordered = templatesFor({ label: "Cell Type", uri: null });
    const firstOther = ordered.findIndex(
      (t) => t.category !== "cell type" && t.category !== "*",
    );
    // Everything before the first non-matching entry is a match, and at
    // least the §1/§2 origin shapes are in there.
    const head = ordered.slice(0, firstOther);
    expect(head.length).toBeGreaterThan(0);
    expect(head.every((t) => t.category === "cell type" || t.category === "*")).toBe(
      true,
    );
    expect(head.map((t) => t.id)).toContain("cell-type-from-tissue");
  });

  it("every sanctioned predicate has at least one worked template", () => {
    // The agents side gained the same guard with 13_statement_templates
    // §§1-21 (cab, 2026-08-21): an allow-list saying a predicate is legal
    // while nothing shows what a correct statement with it looks like is
    // how curators end up coining a shape. `targeted towards` arrived
    // exactly that way — sanctioned, reachable, and undocumented on this
    // side until it had a template.
    const covered = new Set(
      STATEMENT_TEMPLATES.map((t) => t.build(null).predicate?.uri).filter(
        Boolean,
      ),
    );
    const orphans = PREDICATES.filter((p) => !covered.has(p.uri)).map(
      (p) => p.label,
    );
    expect(orphans).toEqual([]);
  });
});
