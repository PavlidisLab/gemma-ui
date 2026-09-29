/**
 * The annotation-file download URL the platform page links to.
 *
 * Six platform short names contain a `/`. A slash cannot ride in a
 * path segment: Apache 404s the request before it proxies. Measured on
 * gemma2 2026-09-10 — `/rest/v2/platforms/HG-U133A/B/Plus_2/annotations`
 * and `/rest/v2/platforms/NIA_Mouse_17K_A/B/annotations` answer 404,
 * the same platforms by id (226, 1010) answer 200. None of the six is
 * SEQUENCING, so the card rendered all three download rows and all
 * three were dead.
 */
import { describe, expect, it } from "vitest";
import { platformAnnotationFileUrl } from "@/features/platforms/PlatformDetailPage";
import { PLATFORM_ANNOTATION_FILE_VARIANTS } from "@/lib/platformConstants";

/** id + short name as gemma2 serves them, for the six slashy names. */
const SLASHED = [
  { id: 226, shortName: "HG-U133A/B/Plus_2" },
  { id: 302, shortName: "G4410A/B" },
  { id: 1006, shortName: "MG-U74A/B/C" },
  { id: 1007, shortName: "HuGene-FL/A/B/C/D" },
  { id: 1009, shortName: "RAE230A/B" },
  { id: 1010, shortName: "NIA_Mouse_17K_A/B" },
];

/** The part of the URL between `/platforms/` and `/annotations`. */
const segment = (url: string) =>
  url.replace(/^.*\/platforms\//, "").replace(/\/annotations.*$/, "");

describe("platformAnnotationFileUrl", () => {
  it("addresses a slash-carrying platform by id, for every file type", () => {
    for (const p of SLASHED) {
      for (const v of PLATFORM_ANNOTATION_FILE_VARIANTS) {
        const url = platformAnnotationFileUrl(p, v.type);
        expect(segment(url)).toBe(String(p.id));
        expect(url).toContain(`/platforms/${p.id}/annotations`);
      }
    }
  });

  it("keeps the readable short name when it survives a path", () => {
    expect(platformAnnotationFileUrl({ id: 4, shortName: "GPL96" }, "standard"))
      .toContain("/platforms/GPL96/annotations");
    expect(
      platformAnnotationFileUrl(
        { id: 736, shortName: "Generic_mouse_ncbiIds" },
        "bioProcess",
      ),
    ).toContain("/platforms/Generic_mouse_ncbiIds/annotations");
  });

  it("falls back to the id when there is no short name", () => {
    expect(segment(platformAnnotationFileUrl({ id: 11 }, "standard"))).toBe("11");
    expect(
      segment(platformAnnotationFileUrl({ id: 12, shortName: null }, "standard")),
    ).toBe("12");
  });

  it("still carries the non-standard file type as a query param", () => {
    expect(platformAnnotationFileUrl(SLASHED[0], "noParents")).toContain(
      "?type=noParents",
    );
    // `standard` is the route's default, so it is not spelled out.
    expect(platformAnnotationFileUrl(SLASHED[0], "standard")).not.toContain("?");
  });
});
