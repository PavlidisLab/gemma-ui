/**
 * A term URI is not always a PURL.
 *
 * 64,728 characteristics on prod hold a bare CURIE (`CL:0000129`) where
 * every other row holds a full PURL — cellxgene imports, found
 * 2026-09-10. Anything that treats a term URI as a URL has to cope.
 *
 * Both halves of the upstream fix are in flight — the importer
 * normalises identifiers on ingest (`f53b1f94fb`) and the existing rows
 * get a repair pass — but neither was deployed when this was written,
 * and the guard is not contingent on them: `curieToUrl` passes a full
 * PURL through unchanged, so this holds before the repair and after
 * it.
 *
 * 🛑 The pair of rules this pins, which pull in OPPOSITE directions:
 *
 *  - for a LINK, expand — a bare CURIE in an `href` is not a URL, and
 *    the browser resolves it against the current page;
 *  - for a FILTER or an identity comparison, do NOT expand — Gemma
 *    stores those rows AS the bare CURIE, so a normalised PURL matches
 *    nothing on exactly the affected population.
 *
 * That is why there is no ingestion-boundary normalisation here, unlike
 * every other shape in this codebase. Normalising once at the edge
 * would fix the links and silently break search.
 */
import { describe, expect, it } from "vitest";
import { curieToUrl, shortenUri } from "./curie";

const BARE = [
  "CL:0000129",
  "EFO:0000513",
  "UBERON:0002435",
  "MONDO:0004975",
  "NCBITaxon:9606",
];

describe("a bare CURIE is linkable", () => {
  it("expands to an absolute URL for every prefix in the affected data", () => {
    for (const c of BARE) {
      const url = curieToUrl(c);
      expect(url, c).toBeTruthy();
      expect(url, c).toMatch(/^https?:\/\//);
    }
  });

  it("still lands somewhere useful for a prefix it does not know", () => {
    // The failure mode to avoid is a dead href, not an imperfect one.
    const url = curieToUrl("WEIRDPREFIX:12345");
    expect(url).toMatch(/^https?:\/\//);
  });

  it("leaves a full PURL alone", () => {
    const purl = "http://purl.obolibrary.org/obo/CL_0000129";
    expect(curieToUrl(purl)).toBe(purl);
  });

  it("renders readably without expansion", () => {
    // Display must not depend on the link fix — a CURIE already reads
    // as a CURIE.
    expect(shortenUri("CL:0000129")).toBe("CL:0000129");
  });
});

describe("the two forms are the SAME term to a reader", () => {
  it("shortens to the same text either way", () => {
    expect(shortenUri("http://purl.obolibrary.org/obo/CL_0000129")).toBe(
      shortenUri("CL:0000129"),
    );
  });
});
