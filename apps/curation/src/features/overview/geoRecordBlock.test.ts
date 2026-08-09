/**
 * Legacy ``Overall design:`` tail extraction for the Overview's
 * ``design (GEO)`` row.
 *
 * The fold that produced these descriptions appended a fixed metadata
 * footer after the design paragraph — ``Organisms:`` / ``PMIDs:`` /
 * ``URL:``. Taking everything to end-of-string swept the footer into the
 * row, so it read as the design with a taxon, a PMID list and a GEO URL
 * glued on — all three already rendered by the banner. 220 of 534
 * stored descriptions carry such a tail.
 *
 * The boundary is the footer's literal labels, NOT a "looks like a
 * heading" shape: design prose carries its own ``Label:`` lines, and a
 * generic rule empties or truncates those (see the last two cases).
 */
import { describe, expect, it } from "vitest";

import {
  descriptionWithoutGeoRecordBlock,
  overallDesignFromDescription,
} from "./geoRecordBlock";

describe("overallDesignFromDescription", () => {
  it("returns '' when there is no folded tail", () => {
    expect(overallDesignFromDescription(null)).toBe("");
    expect(overallDesignFromDescription("")).toBe("");
    expect(overallDesignFromDescription("A plain abstract.")).toBe("");
  });

  // Shape from the store (GSE9509).
  it("stops at the Organisms / PMIDs / URL footer", () => {
    const desc = [
      "=== GEO record (series-level, verbatim) ===",
      "Title: IL-10 attenuates the LPS response",
      "Overall design: Mouse IL-10 -/- macrophages were isolated and set up in culture.",
      "Organisms: Mus musculus",
      "PMIDs: 18025162",
      "URL: https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE9509",
    ].join("\n");
    expect(overallDesignFromDescription(desc)).toBe(
      "Mouse IL-10 -/- macrophages were isolated and set up in culture.",
    );
  });

  it("keeps a multi-line design paragraph up to the footer", () => {
    const desc = [
      "Overall design: Genomic DNA from 3 MPNST tumour samples was subjected to RNA-seq.",
      "Three cell lines were subjected to RNA-seq (ipNF05.5, MPNST8814, sNF96.2).",
      "URL: https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE270880",
    ].join("\n");
    expect(overallDesignFromDescription(desc)).toBe(
      "Genomic DNA from 3 MPNST tumour samples was subjected to RNA-seq.\n" +
        "Three cell lines were subjected to RNA-seq (ipNF05.5, MPNST8814, sNF96.2).",
    );
  });

  // GSE188549: the design text itself OPENS with a "Label:" line. A
  // generic heading rule truncates this to nothing.
  it("keeps design prose that starts with its own Label: line", () => {
    const desc =
      "Overall design: Bulk RNA Seq: MHC-IIhi and MHC-IIlo TAMs from 3LL-R " +
      "tumour-bearing mice.\nOrganisms: Mus musculus";
    expect(overallDesignFromDescription(desc)).toBe(
      "Bulk RNA Seq: MHC-IIhi and MHC-IIlo TAMs from 3LL-R tumour-bearing mice.",
    );
  });

  // GSE270880: a "Label:" line MID-paragraph is part of the design.
  it("keeps a Label: line that is really design prose", () => {
    const desc =
      "Overall design: Three cell lines were sequenced.\n" +
      "Two conditions: siControl and TSPO knockdown\n" +
      "PMIDs: 40842566";
    expect(overallDesignFromDescription(desc)).toBe(
      "Three cell lines were sequenced.\n" +
        "Two conditions: siControl and TSPO knockdown",
    );
  });

  it("matches the header case-insensitively", () => {
    expect(
      overallDesignFromDescription("overall design: Two arms.\norganisms: Homo sapiens"),
    ).toBe("Two arms.");
  });
});


/**
 * Read-view de-duplication.
 *
 * The gate is per-label: hide the block only when every label in it is
 * readable elsewhere on the page. A block-shaped check ("the design
 * paragraph matches the row, so drop the lot") looks equivalent and
 * isn't — on the rows that survived the agents-side de-fold, the PMID
 * list is routinely longer than Publications (22 of 31), the GEO title
 * differs from Gemma's (3 of 28), and the block names two species where
 * the design carries one taxon.
 */
describe("descriptionWithoutGeoRecordBlock", () => {
  const design =
    "Mouse IL-10 -/- macrophages were isolated and set up in culture.";
  const block = [
    "=== GEO record (series-level, verbatim) ===",
    "Title: A transcriptional repressor induced by STAT3.",
    `Overall design: ${design}`,
    "Organisms: Mus musculus",
    "PMIDs: 18025162",
    "URL: https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE9509",
  ].join("\n");
  const head =
    "IL-10 regulates anti-inflammatory signalling via STAT3.\n" +
    "Last Updated (by provider): Nov 02 2007";
  const desc = `${head}\n\n${block}`;
  // What the rest of the page is showing for that experiment.
  const page = {
    overallDesign: design,
    title: "A transcriptional repressor induced by STAT3.",
    taxon: "mouse",
    pubmedIds: ["18025162"],
    accession: "GSE9509",
  };

  it("drops the whole block when every label is shown elsewhere", () => {
    expect(descriptionWithoutGeoRecordBlock(desc, page)).toBe(head);
  });

  it("cuts at the fold header when there is no block marker", () => {
    const noMarker = `An abstract.\nOverall design: ${design}\nOrganisms: Mus musculus`;
    expect(descriptionWithoutGeoRecordBlock(noMarker, page)).toBe("An abstract.");
  });

  it("leaves a clean description untouched", () => {
    expect(descriptionWithoutGeoRecordBlock("Just an abstract.", page)).toBe(
      "Just an abstract.",
    );
    expect(descriptionWithoutGeoRecordBlock(null, page)).toBe("");
  });

  describe("keeps the block when a label is NOT recoverable", () => {
    it("design paragraph the design (GEO) row isn't showing", () => {
      expect(
        descriptionWithoutGeoRecordBlock(desc, {
          ...page,
          overallDesign: "A different design.",
        }),
      ).toBe(desc);
      expect(
        descriptionWithoutGeoRecordBlock(desc, { ...page, overallDesign: "" }),
      ).toBe(desc);
    });

    // GSE20194: block lists 20064235, 20676074; publications has only the
    // second. The first is reachable nowhere else on the page.
    it("a PMID missing from Publications", () => {
      const twoPmids = desc.replace("PMIDs: 18025162", "PMIDs: 20064235, 18025162");
      expect(descriptionWithoutGeoRecordBlock(twoPmids, page)).toBe(twoPmids);
    });

    // GSE28584: GEO's title and Gemma's are different sentences.
    it("a GEO title that isn't the banner's", () => {
      expect(
        descriptionWithoutGeoRecordBlock(desc, {
          ...page,
          title: "Effect of Griffithsin on gene expression profile",
        }),
      ).toBe(desc);
    });

    it("a second organism the design's taxon doesn't cover", () => {
      const twoOrganisms = desc.replace(
        "Organisms: Mus musculus",
        "Organisms: Homo sapiens, Mus musculus",
      );
      expect(descriptionWithoutGeoRecordBlock(twoOrganisms, page)).toBe(
        twoOrganisms,
      );
    });

    // GSE13787 / GSE25727 / GSE50851 and 3 others: a multi-paragraph
    // Summary: only partly present in the description head.
    it("a Summary: the head doesn't already carry", () => {
      const withSummary = desc.replace(
        "Title: A transcriptional repressor induced by STAT3.",
        "Title: A transcriptional repressor induced by STAT3.\n" +
          "Summary: Introduction\nBasal-like carcinomas are aggressive.",
      );
      expect(descriptionWithoutGeoRecordBlock(withSummary, page)).toBe(
        withSummary,
      );
    });

    it("a label the fold never emits", () => {
      const odd = desc.replace(
        "Organisms: Mus musculus",
        "Submitter note: embargoed\nOrganisms: Mus musculus",
      );
      expect(descriptionWithoutGeoRecordBlock(odd, page)).toBe(odd);
    });
  });

  describe("recoverable in a form that isn't string equality", () => {
    it("taxon by common name against GEO's scientific name", () => {
      expect(descriptionWithoutGeoRecordBlock(desc, page)).toBe(head);
      expect(
        descriptionWithoutGeoRecordBlock(desc, { ...page, taxon: "Mus musculus" }),
      ).toBe(head);
    });

    it("a Summary: the description head already carries", () => {
      const summary = "IL-10 regulates anti-inflammatory signalling via STAT3.";
      const withSummary = desc.replace(
        "Title: A transcriptional repressor induced by STAT3.",
        `Title: A transcriptional repressor induced by STAT3.\nSummary: ${summary}`,
      );
      expect(descriptionWithoutGeoRecordBlock(withSummary, page)).toBe(head);
    });

    // GSE55238: GEO emits !Series_overall_design twice, MINiML joins the
    // lines — the second "Label:" is design text, not a stray field.
    it("a repeated design line, which is design and not a new label", () => {
      const twoLine =
        "We used mouse microarrays to profile two sepsis models\n" +
        "Infection protocol: Used the CLP model and Cecal Slurry method.";
      const d = [
        "An abstract.",
        "=== GEO record (series-level, verbatim) ===",
        `Overall design: ${twoLine}`,
        "Organisms: Mus musculus",
      ].join("\n");
      expect(
        descriptionWithoutGeoRecordBlock(d, { ...page, overallDesign: twoLine }),
      ).toBe("An abstract.");
      // …and the design (GEO) row must be showing BOTH lines for that
      // to be honest.
      expect(overallDesignFromDescription(d)).toBe(twoLine);
    });
  });
});

/**
 * Split sub-series: the design's short name is suffixed (``GSE25299.2``)
 * and the block's URL addresses the base series — 9 of the 31 blocks
 * that survived the agents-side de-fold. The banner shows the suffixed
 * name, so the link is reachable and the URL line is not a reason to
 * keep the block.
 */
describe("descriptionWithoutGeoRecordBlock — split sub-series URL", () => {
  const design = "Two arms, treated and control.";
  const desc = [
    "An abstract.",
    "=== GEO record (series-level, verbatim) ===",
    `Overall design: ${design}`,
    "Organisms: Homo sapiens",
    "URL: https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE25299",
  ].join("\n");
  const page = { overallDesign: design, taxon: "human", accession: "GSE25299.2" };

  it("matches the base accession under a suffixed short name", () => {
    expect(descriptionWithoutGeoRecordBlock(desc, page)).toBe("An abstract.");
  });

  it("still keeps the block when the URL is a different series", () => {
    expect(
      descriptionWithoutGeoRecordBlock(desc, { ...page, accession: "GSE99999" }),
    ).toBe(desc);
  });
});
