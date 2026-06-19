import { describe, expect, it } from "vitest";
import { sameOntologyTerm } from "./ontologyTerm";

/**
 * Tests for sameOntologyTerm() — the identity comparator used across
 * audit, design, and proposal surfaces to detect whether two ontology
 * terms refer to the same concept.
 *
 * The critical regression case: two terms with BOTH URIs empty AND both
 * labels empty must return FALSE. Without this guard, every pair of
 * ungrounded factor values with no URI and no label would collapse into
 * a single identity match — e.g. two distinct ungrounded FVs from
 * different factors both missing URI+label would appear as duplicates.
 *
 * URI comparison is exact (case-sensitive per the implementation
 * comments). Label fallback normalises case + whitespace.
 */
describe("sameOntologyTerm", () => {
  describe("URI-primary comparison", () => {
    it("returns true when both URIs are equal", () => {
      expect(
        sameOntologyTerm(
          { uri: "http://purl.obolibrary.org/obo/MONDO_0004975", label: "MONDO" },
          { uri: "http://purl.obolibrary.org/obo/MONDO_0004975", label: "different label" },
        ),
      ).toBe(true);
    });

    it("returns false when URIs differ — regardless of matching labels", () => {
      expect(
        sameOntologyTerm(
          { uri: "http://purl.obolibrary.org/obo/MONDO_0004975", label: "genotype" },
          { uri: "http://www.ebi.ac.uk/efo/EFO_0000513", label: "genotype" },
        ),
      ).toBe(false);
    });

    it("URI comparison is case-sensitive — different-case URIs must not match", () => {
      // URIs are protocol-stable identifiers; case-insensitive matching
      // risks false positives across distinct resources.
      expect(
        sameOntologyTerm(
          { uri: "http://purl.obolibrary.org/obo/MONDO_0004975" },
          { uri: "HTTP://PURL.OBOLIBRARY.ORG/OBO/MONDO_0004975" },
        ),
      ).toBe(false);
    });
  });

  describe("label fallback — both URIs empty or missing", () => {
    it("REGRESSION: both URIs empty AND both labels empty must return FALSE", () => {
      // Returning true here would collapse distinct ungrounded factor
      // values into a single identity match — see memory entry
      // feedback_proposal_disposition_keying_and_equality.md.
      expect(
        sameOntologyTerm({ uri: "", label: "" }, { uri: "", label: "" }),
      ).toBe(false);
    });

    it("REGRESSION: both URIs null/undefined AND both labels undefined must return FALSE", () => {
      expect(sameOntologyTerm({}, {})).toBe(false);
    });

    it("REGRESSION: both URIs null AND both labels null must return FALSE", () => {
      expect(
        sameOntologyTerm({ uri: null, label: null }, { uri: null, label: null }),
      ).toBe(false);
    });

    it("returns true when both URIs are empty but both labels are the same non-empty string", () => {
      expect(
        sameOntologyTerm(
          { uri: "", label: "genotype" },
          { uri: "", label: "genotype" },
        ),
      ).toBe(true);
    });

    it("label comparison is case-insensitive", () => {
      expect(
        sameOntologyTerm(
          { uri: "", label: "Genotype" },
          { uri: "", label: "genotype" },
        ),
      ).toBe(true);
    });

    it("label comparison trims whitespace", () => {
      expect(
        sameOntologyTerm(
          { uri: "", label: "  genotype  " },
          { uri: "", label: "genotype" },
        ),
      ).toBe(true);
    });

    it("returns false when both URIs empty but labels differ", () => {
      expect(
        sameOntologyTerm(
          { uri: "", label: "genotype" },
          { uri: "", label: "organism part" },
        ),
      ).toBe(false);
    });

    it("returns false when one label is empty and the other is not (no URI on either)", () => {
      // One side has a non-empty label, the other has nothing — label
      // comparison requires BOTH to be non-empty to be meaningful.
      expect(
        sameOntologyTerm({ label: "genotype" }, { label: "" }),
      ).toBe(false);
    });
  });

  describe("null / undefined inputs", () => {
    it("returns false when first argument is null", () => {
      expect(sameOntologyTerm(null, { uri: "http://example.org/foo" })).toBe(false);
    });

    it("returns false when second argument is null", () => {
      expect(sameOntologyTerm({ uri: "http://example.org/foo" }, null)).toBe(false);
    });

    it("returns false when both arguments are null", () => {
      expect(sameOntologyTerm(null, null)).toBe(false);
    });

    it("returns false when first argument is undefined", () => {
      expect(sameOntologyTerm(undefined, { label: "foo" })).toBe(false);
    });
  });

  describe("mixed URI / no-URI", () => {
    it("when one side has URI and the other is empty, falls back to label comparison", () => {
      // Implementation: ``if (au && bu) return au === bu`` — the URI
      // equality gate only fires when BOTH are non-empty. When one is
      // empty the code falls through to the normalised label comparison.
      // Same label → true (the real URI mismatch is not surfaced as false).
      expect(
        sameOntologyTerm(
          { uri: "http://purl.obolibrary.org/obo/MONDO_0004975", label: "genotype" },
          { uri: "", label: "genotype" },
        ),
      ).toBe(true);
    });

    it("when one side has URI and the other is empty, different labels → false", () => {
      expect(
        sameOntologyTerm(
          { uri: "http://purl.obolibrary.org/obo/MONDO_0004975", label: "genotype" },
          { uri: "", label: "organism part" },
        ),
      ).toBe(false);
    });
  });
});
