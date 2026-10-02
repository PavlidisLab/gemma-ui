/**
 * One Gemma web front-end now. There were two — a JSP webapp and a
 * React browser app, at different hosts — and an experiment page
 * linked to both. As of 2026-10-02 the browser app is served from
 * the JSP app's old host, and the JSP paths 404 there (verified
 * live). See the header comment in `gemmaUrls.ts`.
 *
 * The hash is the part still worth pinning: the browser app uses
 * `createHashHistory` so deep links survive a static mount with no
 * server rewrite. Drop the `#` and every link 404s — silently, from
 * the curator's side, because it looks like a perfectly ordinary URL.
 */
import { describe, expect, it } from "vitest";
import { GEMMA_WEB_URL, experimentPageUrl, platformPageUrl } from "./gemmaUrls";

describe("experimentPageUrl", () => {
  it("is a real host", () => {
    expect(GEMMA_WEB_URL).toMatch(/^https?:\/\//);
  });

  it("deep-links through the hash, mounted at the root", () => {
    // Verified live 2026-10-02: `/` serves the app, the old JSP paths
    // (expressionExperiment/showExpressionExperiment.html) 404.
    expect(experimentPageUrl(9)).toBe(`${GEMMA_WEB_URL}/#/dataset/9`);
  });

  it("takes a string id without mangling it", () => {
    expect(experimentPageUrl("1658")).toBe(`${GEMMA_WEB_URL}/#/dataset/1658`);
  });
});

describe("platformPageUrl", () => {
  it("links by shortName — the browser app's platform route has no numeric-id form", () => {
    expect(platformPageUrl("GPL1261")).toBe(
      `${GEMMA_WEB_URL}/#/platforms/GPL1261`,
    );
  });

  it("encodes the shortName", () => {
    expect(platformPageUrl("a/b")).toBe(`${GEMMA_WEB_URL}/#/platforms/a%2Fb`);
  });

  it("returns null with no shortName to link with", () => {
    expect(platformPageUrl(null)).toBeNull();
    expect(platformPageUrl(undefined)).toBeNull();
    expect(platformPageUrl("")).toBeNull();
  });
});
