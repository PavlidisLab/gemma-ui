import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CurieLink } from "./CurieLink";

/**
 * Render-to-markup tests for CurieLink.
 *
 * CurieLink renders a clickable button showing the shortened form of an
 * ontology URI (CURIE format). When ``uri`` is null / undefined / empty
 * it renders nothing at all (returns null). The popover (CuriePopover)
 * only mounts after the button is clicked, which changes React state —
 * static markup always sees the closed/initial state, so the popover
 * is not visible here. Popover interaction tests belong in Playwright.
 *
 * Contracts tested:
 *   - null / empty uri → empty markup
 *   - full OBO URI → CURIE shortform in the button text
 *   - identifiers.org URI → NCBI-style CURIE
 *   - ``display`` prop overrides the auto-shortened text
 *   - button carries aria-haspopup="dialog" (accessibility)
 */

function render(props: Parameters<typeof CurieLink>[0]) {
  return renderToStaticMarkup(<CurieLink {...props} />);
}

describe("CurieLink", () => {
  describe("null / empty uri — renders nothing", () => {
    it("returns empty string when uri is null", () => {
      expect(render({ uri: null })).toBe("");
    });

    it("returns empty string when uri is undefined", () => {
      expect(render({ uri: undefined })).toBe("");
    });

    it("returns empty string when uri is an empty string", () => {
      // shortenUri('') → '' but the early guard `if (!uri) return null`
      // fires first because '' is falsy.
      expect(render({ uri: "" })).toBe("");
    });
  });

  describe("full OBO URI — CURIE shortform rendered", () => {
    it("renders EFO:0000513 for the EFO URI", () => {
      const html = render({
        uri: "http://www.ebi.ac.uk/efo/EFO_0000513",
      });
      expect(html).toContain("EFO:0000513");
    });

    it("renders HP:0002511 for the HP URI", () => {
      const html = render({
        uri: "http://purl.obolibrary.org/obo/HP_0002511",
      });
      expect(html).toContain("HP:0002511");
    });

    it("renders MONDO:0004975 for the MONDO URI", () => {
      const html = render({
        uri: "http://purl.obolibrary.org/obo/MONDO_0004975",
      });
      expect(html).toContain("MONDO:0004975");
    });

    it("renders TGEMO:00184 for the Gemma-internal TGEMO URI", () => {
      const html = render({
        uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00184",
      });
      expect(html).toContain("TGEMO:00184");
    });
  });

  describe("identifiers.org URIs — NCBI-style CURIE", () => {
    it("renders NCBI:gene:58203 for the identifiers.org ncbigene URI", () => {
      const html = render({
        uri: "http://identifiers.org/ncbigene/58203",
      });
      expect(html).toContain("NCBI:gene:58203");
    });
  });

  describe("display prop — overrides auto-shortened text", () => {
    it("shows the display prop text instead of shortenUri output", () => {
      const html = render({
        uri: "http://www.ebi.ac.uk/efo/EFO_0000513",
        display: "My custom label",
      });
      expect(html).toContain("My custom label");
      // The auto-shortening would produce "EFO:0000513" — that
      // should NOT appear when display is overridden.
      expect(html).not.toContain("EFO:0000513");
    });
  });

  describe("accessibility attributes", () => {
    it("button has aria-haspopup=dialog", () => {
      const html = render({
        uri: "http://www.ebi.ac.uk/efo/EFO_0000513",
      });
      expect(html).toContain('aria-haspopup="dialog"');
    });

    it("uses uri as the button title when no explicit title prop given", () => {
      const uri = "http://www.ebi.ac.uk/efo/EFO_0000513";
      const html = render({ uri });
      // renderToStaticMarkup includes title attribute
      expect(html).toContain(`title="${uri}"`);
    });

    it("uses the title prop when explicitly supplied", () => {
      const html = render({
        uri: "http://www.ebi.ac.uk/efo/EFO_0000513",
        title: "Cell line",
      });
      expect(html).toContain('title="Cell line"');
    });
  });

  describe("plain text / non-CURIE URI — fallback rendering", () => {
    it("renders the trailing path segment for an unrecognised URI", () => {
      // Falls through all CURIE-matching rules in shortenUri; the
      // last path segment is used as the display text.
      const html = render({
        uri: "https://example.com/terms/SomeLocalTerm",
      });
      expect(html).toContain("SomeLocalTerm");
    });
  });
});
