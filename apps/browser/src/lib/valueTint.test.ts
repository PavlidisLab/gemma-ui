import { describe, expect, it } from "vitest";
import { compareSortColumn, compareValuesNatural } from "./valueTint";

describe("compareValuesNatural", () => {
  it("orders replicate labels numerically, not lexically", () => {
    // Plain string comparison puts "rep10" before "rep2" (lexical "1" <
    // "2"); the Samples table needs the numeric read a curator expects.
    expect(compareValuesNatural("Topotecan_RNAseq_rep2", "Topotecan_RNAseq_rep10")).toBeLessThan(0);
    expect(compareValuesNatural("Topotecan_RNAseq_rep10", "Topotecan_RNAseq_rep2")).toBeGreaterThan(0);
  });

  it("orders GSM accessions numerically", () => {
    expect(compareValuesNatural("GSM2", "GSM10")).toBeLessThan(0);
  });
});

describe("compareSortColumn", () => {
  it("sorts ascending by natural order", () => {
    const rows = ["GSM10", "GSM2", "GSM1"];
    expect([...rows].sort((a, b) => compareSortColumn(a, b, 1))).toEqual([
      "GSM1",
      "GSM2",
      "GSM10",
    ]);
  });

  it("sorts descending by natural order", () => {
    const rows = ["GSM10", "GSM2", "GSM1"];
    expect([...rows].sort((a, b) => compareSortColumn(a, b, -1))).toEqual([
      "GSM10",
      "GSM2",
      "GSM1",
    ]);
  });

  it("puts blanks last ascending", () => {
    const rows = ["b", "", "a", ""];
    expect([...rows].sort((a, b) => compareSortColumn(a, b, 1))).toEqual([
      "a",
      "b",
      "",
      "",
    ]);
  });

  it("puts blanks last descending too — a missing value never floats to the top", () => {
    const rows = ["b", "", "a", ""];
    expect([...rows].sort((a, b) => compareSortColumn(a, b, -1))).toEqual([
      "b",
      "a",
      "",
      "",
    ]);
  });

  it("returns 0 for equal values so Array#sort's stable sort leaves ties in place", () => {
    // Array.prototype.sort has been spec-guaranteed stable since ES2019
    // (Node's V8 has honoured it for longer); a 0 return is what makes
    // that guarantee apply here — rows with the same column value keep
    // their prior relative order instead of getting shuffled.
    const rows: Array<{ key: string; seq: number }> = [
      { key: "same", seq: 0 },
      { key: "same", seq: 1 },
      { key: "same", seq: 2 },
    ];
    const sorted = [...rows].sort((a, b) => compareSortColumn(a.key, b.key, 1));
    expect(sorted.map((r) => r.seq)).toEqual([0, 1, 2]);
    expect(compareSortColumn("same", "same", 1)).toBe(0);
    expect(compareSortColumn("", "", 1)).toBe(0);
  });
});
