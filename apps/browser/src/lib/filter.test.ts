import { describe, expect, it } from "vitest";
import { generateFilter } from "./filter";
import { emptySearchSettings } from "./types";
import type { AnnotationTerm, Category, SearchSettings } from "./types";

const DISEASE = "http://www.ebi.ac.uk/efo/EFO_0000408";
const ALZHEIMER = "http://purl.obolibrary.org/obo/MONDO_0004975";
const GENOTYPE = "http://www.ebi.ac.uk/efo/EFO_0000513";
const TNF_GENE = "http://purl.org/commons/record/ncbi_gene/7124";

function settings(patch: Partial<SearchSettings> = {}): SearchSettings {
  return { ...emptySearchSettings(), ...patch };
}

const term = (
  classUri: string | null,
  className: string | null,
  termUri: string | null,
  termName: string | null,
): AnnotationTerm => ({ classUri, className, termUri, termName });

/** Flatten to the wire string the API client would build. */
const wire = (s: SearchSettings) =>
  generateFilter(s)
    .map((c) => c.join(" or "))
    .join(" and ");

describe("generateFilter — a term is bound to its category", () => {
  // The behaviour this replaced emitted two independent clauses, which
  // also matched datasets where the category and the value sat on
  // DIFFERENT characteristics. Measured against gemma2 when this
  // landed: Disease > Alzheimer's went 329 -> 314, and TNF as a
  // perturbed gene 51 -> 39.
  it("wraps value and category in one any() quantifier", () => {
    const f = wire(
      settings({
        annotations: [term(DISEASE, "disease", ALZHEIMER, "Alzheimer disease")],
      }),
    );
    expect(f).toBe(
      `any(allCharacteristics.valueUri in (${ALZHEIMER}) and allCharacteristics.categoryUri = ${DISEASE})`,
    );
  });

  it("does not emit the category as a clause of its own", () => {
    // The give-away for a regression: a bare categoryUri clause ANDed
    // beside the value is exactly the loose form we moved off. Assert
    // on the DNF array — the flattened string contains " and " inside
    // each quantifier, so a text match can't tell the two apart.
    const clauses = generateFilter(
      settings({
        annotations: [term(GENOTYPE, "genotype", TNF_GENE, "TNF [human]")],
      }),
    );
    expect(clauses).toHaveLength(1);
    expect(
      clauses.flat().some((c) => c.startsWith("allCharacteristics.categoryUri")),
    ).toBe(false);
  });

  it("keeps several terms of one category in a single quantified clause", () => {
    const f = wire(
      settings({
        annotations: [
          term(DISEASE, "disease", ALZHEIMER, "Alzheimer disease"),
          term(DISEASE, "disease", "http://x/MONDO_1", "other disease"),
        ],
      }),
    );
    expect(f).toBe(
      `any(allCharacteristics.valueUri in (${ALZHEIMER}, http://x/MONDO_1) and allCharacteristics.categoryUri = ${DISEASE})`,
    );
  });

  it("ANDs separate categories, so both must match", () => {
    const clauses = generateFilter(
      settings({
        annotations: [
          term(DISEASE, "disease", ALZHEIMER, "Alzheimer disease"),
          term(GENOTYPE, "genotype", TNF_GENE, "TNF [human]"),
        ],
      }),
    );
    expect(clauses).toHaveLength(2);
    const f = wire(
      settings({
        annotations: [
          term(DISEASE, "disease", ALZHEIMER, "Alzheimer disease"),
          term(GENOTYPE, "genotype", TNF_GENE, "TNF [human]"),
        ],
      }),
    );
    // Two ANDed clauses — one quantifier per category.
    expect(f).toContain(`categoryUri = ${DISEASE}`);
    expect(f).toContain(`categoryUri = ${GENOTYPE}`);
  });

  it("ORs a free-text value against a URI value under the same category", () => {
    const f = wire(
      settings({
        annotations: [
          term(DISEASE, "disease", ALZHEIMER, "Alzheimer disease"),
          term(DISEASE, "disease", null, "some free text"),
        ],
      }),
    );
    expect(f).toContain(" or ");
    expect(f).toContain("allCharacteristics.value in (");
    // Both halves quantified — neither may leak the loose form.
    for (const half of f.split(" or ")) expect(half.startsWith("any(")).toBe(true);
  });

  it("falls back to value alone when the term has no category", () => {
    // Uncategorised terms have nothing to bind to.
    const f = wire(
      settings({ annotations: [term(null, null, ALZHEIMER, "Alzheimer disease")] }),
    );
    expect(f).toBe(`allCharacteristics.valueUri in (${ALZHEIMER})`);
  });
});

describe("generateFilter — an excluded term is bound the same way", () => {
  // Exclusion binds for the same reason inclusion does, and so that the
  // two are exact complements. Measured against gemma2: 23,547 datasets
  // total, any(...) 314, none(...) 23,233. Unbound, the exclusion
  // removed 411 — strictly more than the include added.
  it("wraps value and category in one none() quantifier", () => {
    const f = wire(
      settings({
        negativeAnnotations: [term(DISEASE, "disease", ALZHEIMER, "Alzheimer disease")],
      }),
    );
    expect(f).toBe(
      `none(allCharacteristics.valueUri in (${ALZHEIMER}) and allCharacteristics.categoryUri = ${DISEASE})`,
    );
  });

  it("is the exact complement of the include for the same row", () => {
    const t = term(DISEASE, "disease", ALZHEIMER, "Alzheimer disease");
    const included = wire(settings({ annotations: [t] }));
    const excluded = wire(settings({ negativeAnnotations: [t] }));
    // Same predicate, opposite quantifier — nothing else may differ.
    expect(excluded).toBe(`none(${included.slice("any(".length)}`);
  });

  it("ANDs the halves of one category rather than ORing them", () => {
    // The give-away for a regression: `none(A) or none(B)` keeps a
    // dataset that carries A as long as it lacks B. Both have to go.
    const s = settings({
      negativeAnnotations: [
        term(DISEASE, "disease", ALZHEIMER, "Alzheimer disease"),
        term(DISEASE, "disease", null, "some free text"),
      ],
    });
    const clauses = generateFilter(s);
    expect(clauses).toHaveLength(2);
    expect(clauses.every((c) => c.length === 1)).toBe(true);
    // " or " joins an inner array; every disjunction here would be wrong.
    expect(wire(s)).not.toContain(" or ");
  });

  it("gives each excluded category its own quantifier", () => {
    const clauses = generateFilter(
      settings({
        negativeAnnotations: [
          term(DISEASE, "disease", ALZHEIMER, "Alzheimer disease"),
          term(GENOTYPE, "genotype", TNF_GENE, "TNF [human]"),
        ],
      }),
    );
    expect(clauses).toHaveLength(2);
    expect(clauses.flat().every((c) => c.startsWith("none("))).toBe(true);
    const f = clauses.flat().join(" ");
    expect(f).toContain(`categoryUri = ${DISEASE}`);
    expect(f).toContain(`categoryUri = ${GENOTYPE}`);
  });

  it("still emits none() for an uncategorised excluded term", () => {
    // Nothing to bind to, but the quantifier is what makes it negative.
    const f = wire(
      settings({ negativeAnnotations: [term(null, null, ALZHEIMER, "Alzheimer disease")] }),
    );
    expect(f).toBe(`none(allCharacteristics.valueUri in (${ALZHEIMER}))`);
  });
});

describe("generateFilter — the branches that did not change", () => {
  it("keeps a whole-category exclude as a bare none() over the category", () => {
    // `negativeCategories` means "no term in this category" — there is
    // no value to bind, so the conjunction would say nothing.
    expect(
      wire(settings({ negativeCategories: [{ classUri: DISEASE, className: "disease" }] })),
    ).toBe(`none(allCharacteristics.categoryUri in (${DISEASE}))`);
  });

  it("keeps a whole-category include as a bare category clause", () => {
    // `categories` means "any term in this category" — there is no
    // value to bind, so the quantifier would say nothing.
    const cat: Category = { classUri: DISEASE, className: "disease" };
    expect(wire(settings({ categories: [cat] }))).toBe(
      `allCharacteristics.categoryUri = ${DISEASE}`,
    );
  });

  it("emits nothing for empty settings", () => {
    expect(generateFilter(settings())).toEqual([]);
  });
});

describe("generateFilter — values are quoted for the grammar", () => {
  // FilterArg.g4: STRING admits anything but ( ) , " and space, so a
  // term name carrying one of those has to be quoted, and a quote
  // inside the quotes escapes as \" .
  it("quotes a free-text term that carries a space", () => {
    const f = wire(settings({ annotations: [term(null, null, null, "some free text")] }));
    expect(f).toBe(`allCharacteristics.value in ("some free text")`);
  });

  it("escapes an embedded quote rather than dropping it", () => {
    const f = wire(settings({ annotations: [term(null, null, null, 'a "quoted" term')] }));
    expect(f).toBe(`allCharacteristics.value in ("a \\"quoted\\" term")`);
  });

  it("quotes excluded values too", () => {
    // The negative branches used to join raw, so a comma or a space in
    // a term name produced a clause that parsed as something else.
    const f = wire(
      settings({ negativeAnnotations: [term(null, null, null, "some free text")] }),
    );
    expect(f).toBe(`none(allCharacteristics.value in ("some free text"))`);
  });
});

describe("generateFilter — malformed input can't corrupt the filter", () => {
  it("drops a group whose terms are all unusable rather than emitting an empty clause", () => {
    // An empty inner array joins to "" and would produce a filter
    // string with a dangling " and ".
    const f = generateFilter(
      settings({ annotations: [term(DISEASE, "disease", null, null)] }),
    );
    expect(f.every((clause) => clause.length > 0)).toBe(true);
    expect(wire(settings({ annotations: [term(DISEASE, "disease", null, null)] })))
      .not.toContain(" and  and ");
  });
});
