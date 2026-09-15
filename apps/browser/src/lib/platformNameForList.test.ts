import { describe, expect, it } from "vitest";
import { platformNameForList } from "./platformConstants";

// Names as gemma2 serves them, 2026-09-15.
describe("platformNameForList", () => {
  it("shortens the common vendor and product strings", () => {
    expect(platformNameForList("Affymetrix GeneChip Human Genome U133 Plus 2.0 Array")).toBe(
      "Affx Human Genome U133 Plus 2.0",
    );
    expect(platformNameForList("Affymetrix Mouse Gene 1.0 ST Array")).toBe(
      "Affx Mouse Gene 1.0 ST",
    );
    expect(platformNameForList("Illumina HumanHT-12 V4.0 expression beadchip")).toBe(
      "Illumina HumanHT-12 V4.0",
    );
    expect(platformNameForList("Affymetrix Clariom S Human array")).toBe("Affx Clariom S Human");
  });

  it("drops a leading CDF tag and the word 'version' but keeps what separates siblings", () => {
    expect(
      platformNameForList(
        "[MoGene-2_0-st] Affymetrix Mouse Gene 2.0 ST Array [transcript (gene) version]",
      ),
    ).toBe("Affx Mouse Gene 2.0 ST [transcript (gene)]");
    // GPL4133 and GPL6480 — the same array, two probe naming schemes.
    expect(
      platformNameForList(
        "Agilent-014850 Whole Human Genome Microarray 4x44K G4112F (Feature Number version)",
      ),
    ).toBe("Agilent-014850 Whole Human Genome 4x44K G4112F (Feature Number)");
    expect(
      platformNameForList(
        "Agilent-014850 Whole Human Genome Microarray 4x44K G4112F (Probe Name version)",
      ),
    ).toBe("Agilent-014850 Whole Human Genome 4x44K G4112F (Probe Name)");
  });

  it("leaves a name with none of the strings alone", () => {
    expect(platformNameForList("NIA Mouse 17K_B")).toBe("NIA Mouse 17K_B");
  });

  it("never returns an empty label", () => {
    expect(platformNameForList("Array")).toBe("Array");
  });
});
