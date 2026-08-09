import { describe, expect, it } from "vitest";
import { parsePmidOrDoi } from "./publications";

describe("parsePmidOrDoi", () => {
  it("classifies bare digits as a PMID", () => {
    expect(parsePmidOrDoi("23671070")).toEqual({
      kind: "pmid",
      value: "23671070",
    });
    expect(parsePmidOrDoi("1")).toEqual({ kind: "pmid", value: "1" });
  });

  it("classifies a bare 10.xxxx/yyyy reference as a DOI", () => {
    expect(parsePmidOrDoi("10.1038/s41586-023-12345-x")).toEqual({
      kind: "doi",
      value: "10.1038/s41586-023-12345-x",
    });
  });

  it("strips a doi.org URL wrapper", () => {
    expect(parsePmidOrDoi("https://doi.org/10.1234/abcd.5678")).toEqual({
      kind: "doi",
      value: "10.1234/abcd.5678",
    });
    expect(parsePmidOrDoi("http://dx.doi.org/10.1234/abcd")).toEqual({
      kind: "doi",
      value: "10.1234/abcd",
    });
  });

  it("strips a 'doi:' prefix", () => {
    expect(parsePmidOrDoi("doi:10.1038/s41586-023-12345-x")).toEqual({
      kind: "doi",
      value: "10.1038/s41586-023-12345-x",
    });
    expect(parsePmidOrDoi("DOI: 10.1038/s41586-023-12345-x")).toEqual({
      kind: "doi",
      value: "10.1038/s41586-023-12345-x",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(parsePmidOrDoi("   23671070   ")).toEqual({
      kind: "pmid",
      value: "23671070",
    });
  });

  it("returns null for empty input", () => {
    expect(parsePmidOrDoi("")).toBeNull();
    expect(parsePmidOrDoi("   ")).toBeNull();
  });

  it("returns null for unrecognised input (free text, partial DOI, etc.)", () => {
    expect(parsePmidOrDoi("not a pmid or doi")).toBeNull();
    expect(parsePmidOrDoi("10.1038")).toBeNull(); // missing /suffix
    expect(parsePmidOrDoi("foo/bar")).toBeNull();
    expect(parsePmidOrDoi("12345abc")).toBeNull(); // mixed digits / letters
  });
});
