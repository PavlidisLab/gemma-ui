// A platform's annotation file — the element → gene mapping — is offered
// on the platform page as a download link. It replaces a section that
// tried to render the same route as ontology-annotation chips
// (`1797aea`, removed in `0e36b02`): platforms don't carry those, and
// the route serves a TSV file, not JSON.
//
// The old code failed for a reason worth pinning permanently. It sent
// `limit=500`, and this route rejects every parameter it doesn't know:
//
//     400 Unknown query parameter 'limit'.
//         This endpoint accepts: download, force, type.
//
// So the section rendered "Failed to load annotations." on every
// platform page from the day it landed until it was removed. The first
// test below is what stops a helpful future `limit` / `offset` / `sort`
// from doing it again.
//
// `type` joined that list in 2.9.4 and is the only parameter this
// helper sends. Its values are just as strictly checked —
// `type=bogus` is `400 Unknown annotation file type 'bogus'. Expected
// one of: standard, bioProcess, noParents.` — so the spellings below
// are the server's, exactly.
//
// Measurements are from gemma2 2.9.4, 2026-09-01.
import { describe, expect, it } from "vitest";
import { apiBase } from "./base";
import { platformAnnotationsDownloadUrl } from "./endpoints";
import {
  PLATFORM_ANNOTATION_FILE_VARIANTS,
  pickGenericPlatform,
  platformHasAnnotationFile,
} from "@/lib/platformConstants";

describe("platformAnnotationsDownloadUrl", () => {
  it("🛑 sends no query parameter but `type` — the route 400s on any it doesn't know", () => {
    for (const v of PLATFORM_ANNOTATION_FILE_VARIANTS) {
      const url = platformAnnotationsDownloadUrl("GPL96", v.type);
      const query = url.split("?")[1] ?? "";
      expect(query.split("&").filter(Boolean).map((p) => p.split("=")[0])).toEqual(
        v.type === "standard" ? [] : ["type"],
      );
    }
  });

  it("leaves the parameter off for the default type — a bare URL already serves it", () => {
    expect(platformAnnotationsDownloadUrl("GPL96")).not.toContain("?");
    expect(platformAnnotationsDownloadUrl(1)).not.toContain("?");
    expect(platformAnnotationsDownloadUrl(1, "standard")).toBe(
      platformAnnotationsDownloadUrl(1),
    );
  });

  it("asks for a variant by the server's own spelling", () => {
    // Case matters: `bioprocess` is a 400, not a fallback.
    expect(platformAnnotationsDownloadUrl("GPL96", "bioProcess")).toBe(
      `${apiBase}/platforms/GPL96/annotations?type=bioProcess`,
    );
    expect(platformAnnotationsDownloadUrl("GPL96", "noParents")).toBe(
      `${apiBase}/platforms/GPL96/annotations?type=noParents`,
    );
  });

  it("addresses the platform by short name or numeric id", () => {
    expect(platformAnnotationsDownloadUrl("GPL96")).toContain("/platforms/GPL96/annotations");
    expect(platformAnnotationsDownloadUrl(1)).toContain("/platforms/1/annotations");
  });

  it("goes through the configured api base, never a hardcoded /rest/v2", () => {
    // A literal API root breaks the moment the app is mounted anywhere
    // else — see `src/api/base.ts`.
    expect(platformAnnotationsDownloadUrl(1)).toBe(
      `${apiBase}/platforms/1/annotations`,
    );
  });

  it("does not ask for the `download` variant — it is the same bytes", () => {
    // `download=true` transfers the identical 19673 gzip bytes measured
    // on GPL96; it only swaps `Content-Encoding: gzip` +
    // `text/tab-separated-values` for an opaque `application/octet-stream`
    // named `.an.txt.gz`. Same wire cost, and the curator has to unzip
    // it. The plain form is already compressed in transit. Holds for
    // the variants too — `?type=bioProcess&download=true` is the same
    // trade, down to the `_bioProcess.an.txt.gz` name.
    for (const v of PLATFORM_ANNOTATION_FILE_VARIANTS) {
      expect(platformAnnotationsDownloadUrl(1, v.type)).not.toContain("download");
    }
  });
});

describe("PLATFORM_ANNOTATION_FILE_VARIANTS", () => {
  it("offers all three files the route serves, widest first", () => {
    // Widest first because that is the one most readers want and the
    // one a bare URL has always meant; the narrower two are the
    // additions. The list order IS the render order on the card.
    expect(PLATFORM_ANNOTATION_FILE_VARIANTS.map((v) => v.type)).toEqual([
      "standard",
      "noParents",
      "bioProcess",
    ]);
  });

  it("says what each file holds — the label alone does not distinguish them", () => {
    for (const v of PLATFORM_ANNOTATION_FILE_VARIANTS) {
      expect(v.label.length).toBeGreaterThan(0);
      expect(v.description.length).toBeGreaterThan(0);
    }
  });
});

describe("platformHasAnnotationFile", () => {
  // The link is hidden rather than offered-and-broken for the one type
  // that has no file. Every row here was HEAD-checked against 2.9.4.
  it.each([
    ["ONECOLOR", true],
    ["TWOCOLOR", true],
    ["DUALMODE", true],
    ["GENELIST", true],
    ["SEQUENCING", false],
  ] as const)("%s → %s", (type, expected) => {
    expect(platformHasAnnotationFile(type)).toBe(expected);
  });

  it("is case- and whitespace-tolerant about the wire value", () => {
    expect(platformHasAnnotationFile(" sequencing ")).toBe(false);
    expect(platformHasAnnotationFile("Sequencing")).toBe(false);
  });

  it("offers the link when the type is missing rather than hiding it", () => {
    // An absent type is not evidence of an absent file. A link that
    // might 404 is recoverable; a silently missing download is not.
    expect(platformHasAnnotationFile(null)).toBe(true);
    expect(platformHasAnnotationFile(undefined)).toBe(true);
    expect(platformHasAnnotationFile("")).toBe(true);
    expect(platformHasAnnotationFile("OTHER")).toBe(true);
  });
});

describe("pickGenericPlatform", () => {
  // The rows below are the shapes the two callers actually pass:
  // `/datasets/platforms` facet rows (the switched-onto set) and
  // `/platforms?filter=technologyType = "GENELIST"` rows. Counts are
  // from 2.9.4, 2026-09-01.
  const genericHuman = {
    id: 735,
    technologyType: "GENELIST",
    taxon: { id: 1 },
    numberOfExpressionExperiments: 4588,
  };
  const genericMouse = {
    id: 736,
    technologyType: "GENELIST",
    taxon: { id: 2 },
    numberOfExpressionExperiments: 7529,
  };
  const genericMouseEnsembl = {
    id: 671,
    technologyType: "GENELIST",
    taxon: { id: 2 },
    numberOfExpressionExperiments: 1,
  };
  const genericRat = {
    id: 741,
    technologyType: "GENELIST",
    taxon: { id: 3 },
    numberOfExpressionExperiments: 666,
  };

  it("takes the gene-list row out of a switched-onto facet", () => {
    // The facet for GPL16791 leads with GPL16791 itself and carries the
    // other sequencing platforms its datasets share; only the GENELIST
    // row is a platform with an annotation file.
    const facet = [
      { id: 752, technologyType: "SEQUENCING", taxon: { id: 1 }, numberOfExpressionExperiments: 749 },
      { ...genericHuman, numberOfExpressionExperiments: 749 },
      { id: 1046, technologyType: "SEQUENCING", taxon: { id: 1 }, numberOfExpressionExperiments: 14 },
    ];
    expect(pickGenericPlatform(facet)?.id).toBe(735);
  });

  it("🛑 keeps a cross-taxon answer when no taxon is asked for", () => {
    // GPL20797 is Rattus rattus (taxon 79); its dataset is quantified
    // onto Generic_rat_ncbiIds, which is Rattus norvegicus (taxon 3).
    // The switched-onto set is evidence, not a guess — filtering it by
    // the platform's own taxon would throw away the right answer and
    // leave the page with none.
    const facet = [
      { id: 862, technologyType: "SEQUENCING", taxon: { id: 79 }, numberOfExpressionExperiments: 1 },
      { ...genericRat, numberOfExpressionExperiments: 1 },
    ];
    expect(pickGenericPlatform(facet)?.id).toBe(741);
    expect(pickGenericPlatform(facet, 79)).toBeNull();
  });

  it("restricts to the taxon when one is given — the no-datasets fallback", () => {
    const generics = [genericHuman, genericMouse, genericMouseEnsembl, genericRat];
    expect(pickGenericPlatform(generics, 1)?.id).toBe(735);
    expect(pickGenericPlatform(generics, 3)?.id).toBe(741);
  });

  it("prefers the generic the corpus actually uses when a taxon has two", () => {
    // Mouse has both an NCBI-id and an Ensembl-id generic; 7529
    // datasets against 1 is not a close call.
    expect(pickGenericPlatform([genericMouseEnsembl, genericMouse], 2)?.id).toBe(736);
  });

  it("breaks a tie on id so the pick does not flicker between renders", () => {
    const a = { ...genericMouse, id: 900, numberOfExpressionExperiments: 5 };
    const b = { ...genericMouse, id: 300, numberOfExpressionExperiments: 5 };
    expect(pickGenericPlatform([a, b], 2)?.id).toBe(300);
    expect(pickGenericPlatform([b, a], 2)?.id).toBe(300);
  });

  it("answers null rather than inventing a link", () => {
    // 15 of the 91 sequencing platforms on 2.9.4 are of taxa with no
    // generic at all, and an empty facet means the platform has no
    // datasets — 25 more. Both land here.
    expect(pickGenericPlatform([])).toBeNull();
    expect(pickGenericPlatform(undefined)).toBeNull();
    expect(pickGenericPlatform([genericHuman, genericMouse], 12)).toBeNull();
    expect(
      pickGenericPlatform([
        { id: 752, technologyType: "SEQUENCING", taxon: { id: 1 }, numberOfExpressionExperiments: 749 },
      ]),
    ).toBeNull();
  });

  it("is tolerant about how the wire spells the technology type", () => {
    expect(pickGenericPlatform([{ ...genericHuman, technologyType: " genelist " }])?.id).toBe(735);
  });
});
