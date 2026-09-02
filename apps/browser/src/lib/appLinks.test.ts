import { describe, expect, it } from "vitest";
import { browseTermLink } from "./appLinks";

const CORTEX = "http://purl.obolibrary.org/obo/UBERON_0000956";
const ORGANISM_PART = "http://www.ebi.ac.uk/efo/EFO_0000635";

describe("browseTermLink", () => {
  it("selects the term in the facet rather than typing it as a query", () => {
    // A free-text query left the search box holding a raw URI and the
    // facet unticked; these params are what BrowserPage seeds a
    // SELECTED annotation from.
    expect(
      browseTermLink({
        uri: CORTEX,
        label: "cerebral cortex",
        categoryUri: ORGANISM_PART,
        categoryLabel: "organism part",
      }),
    ).toEqual({
      to: "/browser",
      search: {
        annotationUri: CORTEX,
        annotationLabel: "cerebral cortex",
        categoryUri: ORGANISM_PART,
        categoryLabel: "organism part",
      },
    });
  });

  it("still links a term whose category is unknown", () => {
    // It filters; the panel just can't nest it under a category.
    expect(browseTermLink({ uri: CORTEX })).toEqual({
      to: "/browser",
      search: { annotationUri: CORTEX },
    });
  });

  it("omits blank label and category rather than sending empty params", () => {
    expect(
      browseTermLink({ uri: CORTEX, label: "  ", categoryLabel: "" })?.search,
    ).toEqual({ annotationUri: CORTEX });
  });

  it("returns null for a term with no URI", () => {
    // An ungrounded label has nothing to resolve, so offer no link.
    expect(browseTermLink({ uri: null })).toBeNull();
    expect(browseTermLink({ uri: undefined })).toBeNull();
    expect(browseTermLink({ uri: "   " })).toBeNull();
  });

  it("trims the URI", () => {
    expect(browseTermLink({ uri: `  ${CORTEX}  ` })?.search.annotationUri).toBe(
      CORTEX,
    );
  });
});
