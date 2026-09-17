/**
 * Fixtures are verbatim `BioAssay.description` values from gemma2,
 * 2026-09-16 — GSE5817/GSM135782 and three others sampled at random.
 * The leading space is real and so is the line order.
 */
import { describe, expect, it } from "vitest";

import {
  parseSampleDescription,
  sampleDescriptionOneLine,
} from "./sampleDescription";

const GSM135782 =
  " gfp neg. sorted cells from 3 disected e14.5 cortecies Treatment, type=wait\n" +
  "Source GEO sample is GSM135782\n" +
  "Last updated (according to GEO): Sep 12 2006";

describe("parseSampleDescription", () => {
  it("keeps the submitter's text and lifts the GEO date out of it", () => {
    const d = parseSampleDescription(GSM135782);
    expect(d.text).toBe(
      "gfp neg. sorted cells from 3 disected e14.5 cortecies Treatment, type=wait",
    );
    expect(d.geoLastUpdated).toBe("Sep 12 2006");
  });

  it("drops the accession line, which every row already shows", () => {
    expect(parseSampleDescription(GSM135782).text).not.toContain("GSM135782");
  });

  it("returns empty text when the description is only bookkeeping", () => {
    const d = parseSampleDescription(
      "Source GEO sample is GSM1842099\nLast updated (according to GEO): Jul 01 2016",
    );
    expect(d.text).toBe("");
    expect(d.geoLastUpdated).toBe("Jul 01 2016");
  });

  it("leaves a description with no bookkeeping alone", () => {
    const d = parseSampleDescription("Whole bone marrow cells, irradiated.");
    expect(d.text).toBe("Whole bone marrow cells, irradiated.");
    expect(d.geoLastUpdated).toBeNull();
  });

  // The submitter's own text can mention GEO — only a line that IS the
  // bookkeeping line goes.
  it("keeps a sentence that merely talks about a GEO sample", () => {
    const d = parseSampleDescription(
      "Replicate of the source GEO sample is described in the paper.\n" +
        "Source GEO sample is GSM1\n",
    );
    expect(d.text).toBe(
      "Replicate of the source GEO sample is described in the paper.",
    );
  });

  it("handles null, empty and whitespace", () => {
    expect(parseSampleDescription(null)).toEqual({
      text: "",
      geoLastUpdated: null,
    });
    expect(parseSampleDescription("   ").text).toBe("");
  });
});

describe("sampleDescriptionOneLine", () => {
  it("joins a multi-line description with a separator", () => {
    expect(
      sampleDescriptionOneLine("first line\nsecond line\nSource GEO sample is GSM1"),
    ).toBe("first line · second line");
  });

  it("is empty when there is nothing but bookkeeping", () => {
    expect(sampleDescriptionOneLine("Source GEO sample is GSM1")).toBe("");
  });
});
