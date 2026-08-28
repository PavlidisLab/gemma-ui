/**
 * Getting the dataset row out of what `/rest/v2/datasets/{id}` returns.
 *
 * 🛑 That endpoint is PAGINATED. Measured on gemma2 2026-08-28, its
 * top-level keys are:
 *
 *   data · groupBy · sort · offset · limit · totalElements · filter ·
 *   inferredTerms
 *
 * `unwrapGemmaEnvelope` in client.ts only unwraps an envelope carrying
 * nothing but `apiVersion` / `buildInfo` / `data`, so this one comes
 * back wrapped on purpose — a list caller needs `totalElements`, and
 * the unwrapper cannot tell the two kinds apart. Its own comment says
 * the caller picks `.data` explicitly.
 *
 * The reader did not. `Array.isArray(envelope)` is false, so it
 * returned the ENVELOPE as the metadata and every field read off it
 * came back undefined. In remote mode that emptied the banner's title,
 * taxon, platform and GEO link simultaneously, which reads as four
 * separate bugs and is one.
 */
import { describe, expect, it } from "vitest";
import { firstDatasetRow } from "./design";

/** Verbatim shape from gemma2, trimmed to the fields the banner reads. */
const ROW = {
  id: 517,
  short_name: "GSE6306",
  name: "Sample Matching by Inferred Agonal Stress in Gene Expression Analyses of the Brain",
  accession: "GSE6306",
  external_database: "GEO",
  external_uri: "https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE6306",
};

const PAGINATED_ENVELOPE = {
  data: [ROW],
  groupBy: ["id"],
  sort: { orderBy: "id", direction: "+" },
  offset: 0,
  limit: 20,
  totalElements: 1,
  filter: "",
  inferredTerms: [],
};

describe("firstDatasetRow", () => {
  it("digs the row out of the paginated envelope", () => {
    // The case that was broken: extra keys beside `data`, so nothing
    // upstream unwrapped it.
    expect(firstDatasetRow(PAGINATED_ENVELOPE).short_name).toBe("GSE6306");
    expect(firstDatasetRow(PAGINATED_ENVELOPE).accession).toBe("GSE6306");
  });

  it("never returns the envelope itself", () => {
    const got = firstDatasetRow(PAGINATED_ENVELOPE) as Record<string, unknown>;
    expect(got.totalElements).toBeUndefined();
    expect(got.data).toBeUndefined();
  });

  it("takes the first row of a bare array", () => {
    expect(firstDatasetRow([ROW]).short_name).toBe("GSE6306");
  });

  it("passes a bare row through", () => {
    expect(firstDatasetRow(ROW).short_name).toBe("GSE6306");
  });

  it("handles the pure envelope too, in case the unwrapper stops firing", () => {
    expect(
      firstDatasetRow({ apiVersion: "2.9.4", data: [ROW] }).short_name,
    ).toBe("GSE6306");
  });

  it("returns an empty object rather than throwing on nothing useful", () => {
    for (const v of [null, undefined, "", 7, [], { data: [] }]) {
      expect(firstDatasetRow(v)).toEqual({});
    }
  });
});
