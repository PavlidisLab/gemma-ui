/**
 * Where a dataset came from.
 *
 * 🛑 The bug this replaces rendered NOTHING: both call sites read
 * `dataset.accession?.accession` where the field is a string, so the
 * link was permanently suppressed — and the `Dataset` type declared
 * the object shape, so the reader and the type agreed and neither was
 * right about the server.
 *
 * Payloads below are copied verbatim from
 * `GET /datasets/28143` (GSE217927) on gemma2, 2026-08-26.
 */
import { describe, expect, it } from "vitest";
import { datasetSource } from "./externalSource";

const GEO = {
  accession: "GSE217927",
  externalUri: "https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE217927",
  externalDatabase: "GEO",
  externalLabel: "GSE217927",
};

describe("datasetSource", () => {
  it("prefers the server's own URI over anything constructed", () => {
    const s = datasetSource(GEO)!;
    expect(s.href).toBe(GEO.externalUri);
    expect(s.label).toBe("GSE217927");
    expect(s.database).toBe("GEO");
  });

  it("does NOT assume GEO — each database gets its own home", () => {
    // The old code built an NCBI URL from any accession. For a
    // CELLxGENE UUID that is a link to a page that does not exist, or
    // worse to a GEO record that happens to share the identifier.
    const cases = [
      ["ARRAYEXPRESS", "E-MTAB-1234", /ebi\.ac\.uk/],
      ["CELLXGENE", "abc-123-uuid", /cellxgene\.cziscience\.com/],
      ["SRA", "SRP000001", /ncbi\.nlm\.nih\.gov\/sra/],
      ["GEO", "GSE1", /geo\/query/],
    ] as const;
    for (const [db, acc, host] of cases) {
      const s = datasetSource({ accession: acc, externalDatabase: db })!;
      expect(s.href).toMatch(host);
    }
  });

  it("shows an unknown database's accession rather than guessing a URL", () => {
    const s = datasetSource({ accession: "X-1", externalDatabase: "SOMETHINGNEW" })!;
    expect(s.href).toBeNull();
    // A readable accession beats a link to somewhere it is not.
    expect(s.label).toBe("X-1");
    expect(s.database).toBe("SOMETHINGNEW");
  });

  it("returns null for a direct upload — no source is not a missing source", () => {
    // Callers render nothing for null. "Unknown" would be a claim we
    // failed to find something that was never there.
    expect(datasetSource({})).toBeNull();
    expect(datasetSource(null)).toBeNull();
    expect(datasetSource({ accession: "", externalDatabase: "" })).toBeNull();
  });

  it("still links when the label is absent but the URI is not", () => {
    const s = datasetSource({ accession: "GSE9", externalUri: "https://x/y" })!;
    expect(s.href).toBe("https://x/y");
    expect(s.label).toBe("GSE9");
  });

  it("escapes an accession before putting it in a URL", () => {
    const s = datasetSource({ accession: "a b&c", externalDatabase: "GEO" })!;
    expect(s.href).toContain("a%20b%26c");
  });
});
