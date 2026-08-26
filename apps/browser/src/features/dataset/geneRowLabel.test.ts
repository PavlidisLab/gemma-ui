/**
 * Pins the probe→gene row-label rule shared by the Expression heatmap
 * (Visualize tab) and the top-loaded-probes heatmap (Diagnostics tab).
 *
 * A design element can map to several genes. Naming only the first —
 * the behaviour before 2026-08-25 — silently asserted a 1:1 mapping
 * that isn't there. Fixtures below are real rows from
 * ``/svd/loadings`` on frink; ``95705_s_at`` (Actb + Lrrc58) and
 * ``39230_at`` (APOBEC3A_B + APOBEC3B) are the multi-mapping cases.
 *
 * Lives here rather than in ``packages/heatmap`` because that package
 * carries no test runner; the browser app is the consumer that drives
 * the rule.
 */
import { describe, it, expect } from "vitest";
import {
  buildGeneRowLabel,
  buildHeatmapDataFromPayload,
  probeRowLabel,
} from "@gemma/heatmap";

const g = (id: number, officialSymbol: string, name: string) => ({
  id,
  officialSymbol,
  name,
});

const ACTB = g(475297, "Actb", "actin, beta");
const LRRC58 = g(860695, "Lrrc58", "leucine rich repeat containing 58");
const APOBEC3A_B = g(
  8762596,
  "APOBEC3A_B",
  "APOBEC3A and APOBEC3B deletion hybrid",
);
const APOBEC3B = g(
  198417,
  "APOBEC3B",
  "apolipoprotein B mRNA editing enzyme catalytic subunit 3B",
);

describe("buildGeneRowLabel", () => {
  it("names the searched gene plainly when the probe is specific to it", () => {
    expect(buildGeneRowLabel([ACTB], new Set([ACTB.id]))).toEqual({
      labelSymbol: "Actb",
      labelName: "actin, beta",
    });
  });

  it("marks the row when the probe also reaches an unsearched gene", () => {
    expect(buildGeneRowLabel([ACTB, LRRC58], new Set([ACTB.id]))).toEqual({
      labelSymbol: "Actb*",
      labelName: "actin, beta",
    });
  });

  it("joins every searched gene the probe matched", () => {
    expect(
      buildGeneRowLabel(
        [APOBEC3A_B, APOBEC3B],
        new Set([APOBEC3A_B.id, APOBEC3B.id]),
      ),
    ).toEqual({
      labelSymbol: "APOBEC3A_B;APOBEC3B",
      labelName:
        "APOBEC3A and APOBEC3B deletion hybrid; apolipoprotein B mRNA editing enzyme catalytic subunit 3B",
    });
  });

  it("joins AND marks when the probe reaches past the searched genes", () => {
    expect(
      buildGeneRowLabel(
        [APOBEC3A_B, APOBEC3B, ACTB],
        new Set([APOBEC3A_B.id, APOBEC3B.id]),
      ).labelSymbol,
    ).toBe("APOBEC3A_B;APOBEC3B*");
  });

  it("names every gene and marks nothing when there is no search", () => {
    // Random-sample preview + the PC-loadings popup: no query, so no
    // gene is "specifically matched" and the mark would be meaningless.
    expect(buildGeneRowLabel([ACTB, LRRC58], new Set()).labelSymbol).toBe(
      "Actb;Lrrc58",
    );
  });

  it("marks a row none of whose genes were searched", () => {
    expect(buildGeneRowLabel([ACTB, LRRC58], new Set([99])).labelSymbol).toBe(
      "Actb;Lrrc58*",
    );
  });

  it("returns blank for an unmapped probe so the caller can fall back", () => {
    expect(buildGeneRowLabel([], new Set([ACTB.id]))).toEqual({
      labelSymbol: "",
      labelName: "",
    });
  });

  it("placeholders a missing name so the two label columns stay aligned", () => {
    expect(
      buildGeneRowLabel([ACTB, g(9, "FOO", "")], new Set()).labelName,
    ).toBe("actin, beta; —");
  });

  it("keeps the name column blank rather than emitting bare separators", () => {
    expect(
      buildGeneRowLabel([g(1, "A", ""), g(2, "B", "")], new Set()).labelName,
    ).toBe("");
  });
});

/**
 * The two heatmaps must label the same probe the same way.
 *
 * They reach the gutter by different routes — the expression heatmap
 * builds a HeatmapPayload and goes through
 * `buildHeatmapDataFromPayload`; the PC-loadings popup hand-builds the
 * v1 `HeatmapData` from `/svd/loadings` rows. Both now defer to
 * `probeRowLabel`, and these pin that they agree, because a divergence
 * would otherwise only show up as two heatmaps naming one probe
 * differently.
 */
describe("expression and top-loaded heatmaps agree on a row label", () => {
  /** As `/svd/loadings` serves it — the PC-loadings popup's input. */
  const loadingsRow = {
    designElementId: 156366,
    designElementName: "95705_s_at",
    genes: [ACTB, LRRC58],
  };

  /** The same probe as VisualizeTab's wire adapter builds it. */
  const payloadRow = {
    designElementId: loadingsRow.designElementId,
    designElementName: loadingsRow.designElementName,
    geneIds: loadingsRow.genes.map((g) => g.id),
    geneSymbols: loadingsRow.genes.map((g) => g.officialSymbol),
    geneNames: loadingsRow.genes.map((g) => g.name),
    ...buildGeneRowLabel(loadingsRow.genes, new Set<number>()),
  };

  const expressionLabels = () => {
    const built = buildHeatmapDataFromPayload(
      {
        datasetId: 1,
        matrix: {
          values: [[1]],
          rows: 1,
          cols: 1,
          quantitationType: {
            name: "qt",
            isPreferred: true,
            isRatio: false,
            scale: "LOG2",
          },
        },
        rows: [payloadRow],
        columns: [
          {
            bioAssayId: 1,
            bioMaterialId: 1,
            name: "s1",
            outlier: false,
            factorValueIds: {},
          },
        ],
        factors: [],
      },
      { mainGroupingFactorId: null },
    );
    return built.data;
  };

  it("names every mapped gene identically on both", () => {
    const pca = probeRowLabel(loadingsRow);
    const expression = expressionLabels();
    expect(pca.symbol).toBe("Actb;Lrrc58");
    expect(expression.rowLabels?.[0]).toBe(pca.symbol);
    expect(expression.rowLabelColumns?.[0]?.[0]).toBe(pca.symbol);
  });

  it("agrees on the gene-name column too", () => {
    const pca = probeRowLabel(loadingsRow);
    expect(expressionLabels().rowLabelColumns?.[0]?.[1]).toBe(pca.name);
  });

  it("agrees on the probe-name fallback when nothing is mapped", () => {
    const bare = { ...loadingsRow, genes: [] };
    const pca = probeRowLabel(bare);
    expect(pca.symbol).toBe("95705_s_at");
    // Same row through the payload path.
    const built = buildHeatmapDataFromPayload(
      {
        datasetId: 1,
        matrix: {
          values: [[1]],
          rows: 1,
          cols: 1,
          quantitationType: {
            name: "qt",
            isPreferred: true,
            isRatio: false,
            scale: "LOG2",
          },
        },
        rows: [
          {
            designElementId: bare.designElementId,
            designElementName: bare.designElementName,
            geneIds: [],
            geneSymbols: [],
            geneNames: [],
          },
        ],
        columns: [
          {
            bioAssayId: 1,
            bioMaterialId: 1,
            name: "s1",
            outlier: false,
            factorValueIds: {},
          },
        ],
        factors: [],
      },
      { mainGroupingFactorId: null },
    );
    expect(built.data.rowLabels?.[0]).toBe(pca.symbol);
  });

  it("the single-string label is symbol-only on both (it feeds the TSV)", () => {
    const pca = probeRowLabel(loadingsRow);
    // Not "Actb;Lrrc58 · actin, beta; …" — the PC-loadings popup used
    // to join symbol and name here while the expression heatmap did
    // not, so one probe exported under two different labels.
    expect(pca.symbol).not.toContain("·");
    expect(expressionLabels().rowLabels?.[0]).not.toContain("·");
  });
});
