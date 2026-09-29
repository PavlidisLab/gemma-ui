/**
 * Which term chips offer the browse link.
 *
 * The link filters `allCharacteristics.valueUri`, so it is only
 * truthful for a chip that IS an annotation's own term — a
 * characteristic's value, or a statement's subject. Measured on gemma2
 * 2026-09-10 against GSE11630 (eid 1658), whose design page renders all
 * four roles at once:
 *
 *   subject   CHEBI_24757   `… and id = 1658` ⇒ 1 (GSE11630)
 *   object    EFO_0004425   `… and id = 1658` ⇒ 0
 *   predicate TGEMO_00166   `… and id = 1658` ⇒ 0
 *   category  EFO_0000727   `… and id = 1658` ⇒ 0
 *
 * A link on the last three does not merely under-report: the list it
 * lands on excludes the dataset the reader clicked from.
 */
import { describe, expect, it } from "vitest";
import {
  effectiveTermVariant,
  termChipBrowseLink,
} from "@/components/OntologyTermChip";

// The four roles, as GSE11630's design page renders them.
const SUBJECT = "http://purl.obolibrary.org/obo/CHEBI_24757"; // hypochlorous acid
const OBJECT = "http://www.ebi.ac.uk/efo/EFO_0004425"; // initial time point
const PREDICATE = "http://gemma.msl.ubc.ca/ont/TGEMO_00166";
const CATEGORY = "http://www.ebi.ac.uk/efo/EFO_0000727"; // treatment

describe("termChipBrowseLink", () => {
  it("does not link unless the caller opts in", () => {
    // Linking is opt-in so a chip added to a new surface is inert
    // until someone has decided the term is an annotation's own.
    expect(termChipBrowseLink({ uri: SUBJECT })).toBeNull();
    expect(termChipBrowseLink({ uri: CATEGORY })).toBeNull();
    expect(termChipBrowseLink({ uri: OBJECT })).toBeNull();
  });

  it("links an annotation's own term when the caller opts in", () => {
    expect(termChipBrowseLink({ uri: SUBJECT, asLink: true })).toEqual({
      to: "/browser",
      search: { annotationUri: SUBJECT },
    });
  });

  it("never links a predicate, even when the caller opts in", () => {
    // A predicate URI is not in the value column at all — the filter
    // answers zero datasets for it.
    expect(
      termChipBrowseLink({ uri: PREDICATE, variant: "predicate", asLink: true }),
    ).toBeNull();
  });

  it("never links an ungrounded label", () => {
    expect(termChipBrowseLink({ uri: null, asLink: true })).toBeNull();
    expect(termChipBrowseLink({ uri: "   ", asLink: true })).toBeNull();
    expect(
      termChipBrowseLink({ uri: SUBJECT, variant: "free", asLink: true }),
    ).toBeNull();
  });

  it("carries the label and category through to the facet", () => {
    expect(
      termChipBrowseLink({
        uri: SUBJECT,
        asLink: true,
        termLabel: "hypochlorous acid",
        categoryUri: CATEGORY,
        categoryLabel: "treatment",
      }),
    ).toEqual({
      to: "/browser",
      search: {
        annotationUri: SUBJECT,
        annotationLabel: "hypochlorous acid",
        categoryUri: CATEGORY,
        categoryLabel: "treatment",
      },
    });
  });
});

describe("effectiveTermVariant", () => {
  it("degrades a URI-less default term to free", () => {
    expect(effectiveTermVariant("default", null)).toBe("free");
    expect(effectiveTermVariant("default", "")).toBe("free");
    expect(effectiveTermVariant("default", SUBJECT)).toBe("default");
  });

  it("leaves a pinned variant alone", () => {
    expect(effectiveTermVariant("predicate", PREDICATE)).toBe("predicate");
    expect(effectiveTermVariant("predicate", null)).toBe("predicate");
    expect(effectiveTermVariant("free", SUBJECT)).toBe("free");
  });
});
