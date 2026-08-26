/**
 * There are two Gemma web front-ends as of 2026-08-25, and an
 * experiment page links to both.
 *
 * The hash in the 2.0 link is the part worth pinning: the browser app
 * uses `createHashHistory` so deep links survive a static mount with
 * no server rewrite. Drop the `#` and every link 404s — silently, from
 * the curator's side, because it looks like a perfectly ordinary URL.
 */
import { describe, expect, it } from "vitest";
import {
  GEMMA_BROWSER_URL,
  GEMMA_WEB_URL,
  browserExperimentPageUrl,
  experimentPageUrl,
} from "./gemmaUrls";

describe("the two front-ends", () => {
  it("are different hosts and neither is empty", () => {
    expect(GEMMA_WEB_URL).toMatch(/^https?:\/\//);
    expect(GEMMA_BROWSER_URL).toMatch(/^https?:\/\//);
    expect(GEMMA_BROWSER_URL).not.toBe(GEMMA_WEB_URL);
  });

  it("2.0 deep-links through the hash, mounted at the root", () => {
    // Verified live 2026-08-25: `/` serves the app, every sub-path 404s.
    expect(browserExperimentPageUrl(9)).toBe(`${GEMMA_BROWSER_URL}/#/dataset/9`);
  });

  it("keeps 1.0 on its JSP page", () => {
    expect(experimentPageUrl(9)).toBe(
      `${GEMMA_WEB_URL}/expressionExperiment/showExpressionExperiment.html?id=9`,
    );
  });

  it("addresses both with the SAME id", () => {
    // The curation store preserves Gemma's experiment ids on import, so
    // one id is good in all three places — GSE3253 is 9 in the store and
    // 9 on gemma2 (checked 2026-08-25). If that ever stops being true,
    // both of these links point at the wrong dataset rather than
    // failing, which is why it is worth stating out loud.
    expect(browserExperimentPageUrl(1658)).toContain("/1658");
    expect(experimentPageUrl(1658)).toContain("id=1658");
  });

  it("takes a string id without mangling it", () => {
    expect(browserExperimentPageUrl("1658")).toBe(
      `${GEMMA_BROWSER_URL}/#/dataset/1658`,
    );
  });
});
