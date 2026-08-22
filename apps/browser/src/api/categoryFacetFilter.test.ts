// The category facet drops annotation sub-clauses from the filter, so
// that picking a value doesn't hide the category it belongs to. It
// matched on the property being at the front of the string, which
// stopped being true when annotation clauses gained a quantifier.
import { describe, expect, it } from "vitest";
import { unquantify } from "./endpoints";
import { generateFilter, negativeCategoryClause } from "@/lib/filter";
import { emptySearchSettings } from "@/lib/types";

const DISEASE = "http://www.ebi.ac.uk/efo/EFO_0000408";
const GENOTYPE = "http://www.ebi.ac.uk/efo/EFO_0000513";
const ALZHEIMER = "http://purl.obolibrary.org/obo/MONDO_0004975";

const isAnnotationClause = (sc: string) =>
  unquantify(sc).startsWith("allCharacteristics.");

describe("category-facet filter stripping", () => {
  it("sees through a quantifier to the property", () => {
    expect(unquantify("any(allCharacteristics.valueUri = x and y = z)")).toBe(
      "allCharacteristics.valueUri = x and y = z)",
    );
    expect(unquantify("none(allCharacteristics.value in (a))")).toBe(
      "allCharacteristics.value in (a))",
    );
    // Nothing to strip — an unquantified clause is unchanged.
    expect(unquantify("taxon.id = 1")).toBe("taxon.id = 1");
  });

  it("recognises both directions of a real annotation filter", () => {
    const term = {
      classUri: DISEASE,
      className: "disease",
      termUri: ALZHEIMER,
      termName: "Alzheimer disease",
    };
    for (const key of ["annotations", "negativeAnnotations"] as const) {
      const clauses = generateFilter({ ...emptySearchSettings(), [key]: [term] });
      expect(clauses.flat().every(isAnnotationClause)).toBe(true);
    }
  });

  it("can identify a category's own exclusion in a real filter", () => {
    // getCategoriesWithChildren drops exactly this string before
    // listing the category's terms. If generateFilter ever emits a
    // different one, the strip silently stops matching and the row
    // disappears from the panel again — so match on the emitted
    // clause, not on a hand-written copy of it.
    const disease = { classUri: DISEASE, className: "disease" };
    const genotype = { classUri: GENOTYPE, className: "genotype" };
    const filter = generateFilter({
      ...emptySearchSettings(),
      negativeCategories: [disease, genotype],
    });

    const self = negativeCategoryClause(disease);
    expect(self).not.toBeNull();
    expect(filter.flat()).toContain(self);

    const childFilter = filter
      .map((c) => c.filter((sc) => sc !== self))
      .filter((c) => c.length > 0);
    // Its own exclusion goes; the other category's stays.
    expect(childFilter.flat()).toEqual([negativeCategoryClause(genotype)]);
  });

  it("has nothing to strip for an uncategorised entry", () => {
    expect(negativeCategoryClause({ classUri: null, className: null })).toBeNull();
  });

  it("leaves a non-annotation clause alone", () => {
    const clauses = generateFilter({
      ...emptySearchSettings(),
      taxon: [{ id: 1 } as never],
    });
    expect(clauses.flat().some(isAnnotationClause)).toBe(false);
  });
});
