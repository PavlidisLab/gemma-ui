import { describe, expect, it } from "vitest";
import { platformRouteParam } from "./platformConstants";

// The six slash-carrying short names are real, taken from a scan of all
// 671 platforms on gemma2 (2026-08-26). They are not hypotheticals: 75
// datasets sit on them.
const SLASHED = [
  { id: 226, shortName: "HG-U133A/B/Plus_2" },
  { id: 302, shortName: "G4410A/B" },
  { id: 1006, shortName: "MG-U74A/B/C" },
  { id: 1007, shortName: "HuGene-FL/A/B/C/D" },
  { id: 1009, shortName: "RAE230A/B" },
  { id: 1010, shortName: "NIA_Mouse_17K_A/B" },
];

describe("platformRouteParam", () => {
  it("uses the short name when it can survive a path segment", () => {
    expect(platformRouteParam({ id: 4, shortName: "GPL96" })).toBe("GPL96");
    expect(platformRouteParam({ id: 736, shortName: "Generic_mouse_ncbiIds" })).toBe(
      "Generic_mouse_ncbiIds",
    );
  });

  it("falls back to the id for every short name carrying a slash", () => {
    for (const p of SLASHED) {
      expect(platformRouteParam(p)).toBe(String(p.id));
    }
  });

  it("falls back for the other characters a path segment cannot carry", () => {
    // %2F is what a slash would become, and it 404s at Apache before it
    // ever reaches Tomcat — so a pre-encoded name is no escape either.
    expect(platformRouteParam({ id: 7, shortName: "A%2FB" })).toBe("7");
    expect(platformRouteParam({ id: 8, shortName: "A?b" })).toBe("8");
    expect(platformRouteParam({ id: 9, shortName: "A#b" })).toBe("9");
  });

  it("keeps a space — %20 survives the whole stack", () => {
    expect(platformRouteParam({ id: 10, shortName: "Joes data" })).toBe("Joes data");
  });

  it("falls back when the short name is missing or blank", () => {
    expect(platformRouteParam({ id: 11, shortName: null })).toBe("11");
    expect(platformRouteParam({ id: 12, shortName: "   " })).toBe("12");
    expect(platformRouteParam({ id: 13 })).toBe("13");
  });

  it("returns empty for no platform rather than the string 'undefined'", () => {
    expect(platformRouteParam(null)).toBe("");
    expect(platformRouteParam(undefined)).toBe("");
  });
});
