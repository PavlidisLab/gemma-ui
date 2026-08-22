// The category facet drops annotation sub-clauses from the filter, so
// that picking a value doesn't hide the category it belongs to. It
// matched on the property being at the front of the string, which
// stopped being true when annotation clauses gained a quantifier.
import { describe, expect, it } from "vitest";
import { unquantify } from "./endpoints";
import { generateFilter } from "@/lib/filter";
import { emptySearchSettings } from "@/lib/types";

const DISEASE = "http://www.ebi.ac.uk/efo/EFO_0000408";
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

  it("leaves a non-annotation clause alone", () => {
    const clauses = generateFilter({
      ...emptySearchSettings(),
      taxon: [{ id: 1 } as never],
    });
    expect(clauses.flat().some(isAnnotationClause)).toBe(false);
  });
});
