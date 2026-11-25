import { describe, it, expect } from "vitest";
import { buildDeProbeRows } from "./deProbeRows";

const level = (
  symbol: string,
  probe: string | null,
  pvalue: number,
  log2FoldChange = 1,
) => ({
  geneOfficialSymbol: symbol,
  pvalue,
  correctedPvalue: pvalue,
  log2FoldChange,
  vectors: probe
    ? [{ designElementName: probe, bioAssayExpressionLevels: {} }]
    : [],
});

const symbols = (rows: ReturnType<typeof buildDeProbeRows>) =>
  rows.map((r) => r.genes.map((g) => g.officialSymbol));

describe("buildDeProbeRows", () => {
  it("puts genes sharing a probe on one row, in p-value order", () => {
    const rows = buildDeProbeRows([
      level("PRKY", "204060_s_at", 2e-9),
      level("XIST", "224588_at", 1e-40),
      level("PRKX", "204060_s_at", 2e-9),
    ]);
    expect(symbols(rows)).toEqual([["XIST"], ["PRKX", "PRKY"]]);
  });

  it("keeps rows apart when the statistics differ", () => {
    const rows = buildDeProbeRows([
      level("A", "p1", 0.01, 1),
      level("B", "p1", 0.01, -1),
    ]);
    expect(rows).toHaveLength(2);
  });

  it("never merges genes that came without a vector", () => {
    const rows = buildDeProbeRows([
      level("A", null, 0.01),
      level("B", null, 0.01),
    ]);
    expect(rows).toHaveLength(2);
  });
});
