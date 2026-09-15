import { describe, expect, it } from "vitest";
import { platformNameForList } from "./platformConstants";

describe("platformNameForList", () => {
  it("keeps the Feature Number / Probe Name distinction, dropping only 'version'", () => {
    // GPL4133 and GPL6480 on gemma2 — the same array, two probe naming schemes.
    expect(
      platformNameForList(
        "Agilent-014850 Whole Human Genome Microarray 4x44K G4112F (Feature Number version)",
      ),
    ).toBe("Agilent-014850 Whole Human Genome Microarray 4x44K G4112F (Feature Number)");
    expect(
      platformNameForList(
        "Agilent-014850 Whole Human Genome Microarray 4x44K G4112F (Probe Name version)",
      ),
    ).toBe("Agilent-014850 Whole Human Genome Microarray 4x44K G4112F (Probe Name)");
  });

  it("leaves every other name alone", () => {
    for (const name of [
      "Caltech 16K cDNA Mouse Array",
      "Agilent-014868 Whole Mouse Genome Microarray 4x44K (G4122F)",
      "NIA Mouse 44K Microarray v3.0 (Whole Genome 60-mer Oligo) [Agilent 015087]",
    ]) {
      expect(platformNameForList(name)).toBe(name);
    }
  });
});
