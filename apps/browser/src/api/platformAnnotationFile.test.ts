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
//         This endpoint accepts: download, force.
//
// So the section rendered "Failed to load annotations." on every
// platform page from the day it landed until it was removed. The first
// test below is what stops a helpful future `limit` / `offset` / `sort`
// from doing it again.
//
// Measurements are from gemma2 2.9.4, 2026-09-01.
import { describe, expect, it } from "vitest";
import { apiBase } from "./base";
import { platformAnnotationsDownloadUrl } from "./endpoints";
import { platformHasAnnotationFile } from "@/lib/platformConstants";

describe("platformAnnotationsDownloadUrl", () => {
  it("🛑 sends no query parameter but `download` — the route 400s on any other", () => {
    const plain = platformAnnotationsDownloadUrl("GPL96");
    expect(plain).not.toContain("?");

    const gz = platformAnnotationsDownloadUrl("GPL96", { gzip: true });
    const params = new URLSearchParams(gz.split("?")[1] ?? "");
    expect([...params.keys()]).toEqual(["download"]);
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

  it("asks for the gzip variant only when told to", () => {
    expect(platformAnnotationsDownloadUrl(1)).not.toContain("download");
    expect(platformAnnotationsDownloadUrl(1, { gzip: true })).toContain("download=true");
    expect(platformAnnotationsDownloadUrl(1, { gzip: false })).not.toContain("download");
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
