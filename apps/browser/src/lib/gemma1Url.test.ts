/**
 * @vitest-environment jsdom
 *
 * The Gemma 1.0 webapp is not the Gemma this app talks to.
 *
 * The 1.0 links were built from `gemmaUrl`, which resolves to the
 * configured API base. That was 1.0 once; it is Gemma 2.0 now, and 2.0
 * does not serve the JSP pages — measured 2026-08-26:
 *
 *   gemma.msl.ubc.ca/expressionExperiment/…?id=28143   -> 200
 *   gemma2.msl.ubc.ca/expressionExperiment/…?id=28143  -> 404
 *
 * These pin the separation so the two bases can't collapse back.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const JSP = "/expressionExperiment/showExpressionExperiment.html?id=28143";

async function load(opts: { apiBase?: string; webUrl?: string } = {}) {
  vi.resetModules();
  vi.stubGlobal("__GEMMA_TARGET__", opts.apiBase ?? "");
  vi.stubEnv("VITE_GEMMA_BASE_URL", "");
  vi.stubEnv("VITE_GEMMA_WEB_URL", opts.webUrl ?? "");
  return await import("./gemmaConfig");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("gemma1Url", () => {
  it("does NOT follow the API base to Gemma 2.0 — the regression", async () => {
    const { gemma1Url, gemmaUrl } = await load({
      apiBase: "https://gemma2.msl.ubc.ca",
    });
    expect(gemma1Url(JSP)).toBe("https://gemma.msl.ubc.ca" + JSP);
    // The API base is still what the snippets want; only the JSP link moved.
    expect(gemmaUrl("/rest/v2/datasets")).toBe(
      "https://gemma2.msl.ubc.ca/rest/v2/datasets",
    );
  });

  it("defaults to the 1.0 host when nothing is configured at all", async () => {
    const { gemma1Url } = await load();
    expect(gemma1Url(JSP)).toBe("https://gemma.msl.ubc.ca" + JSP);
  });

  it("honours an explicit override, trailing slash and all", async () => {
    const { gemma1Url } = await load({ webUrl: "https://staging.example.org/" });
    expect(gemma1Url(JSP)).toBe("https://staging.example.org" + JSP);
  });

  it("stays put even when the API base is a local dev target", async () => {
    // The dev proxy fronts frink; a 1.0 link there would 404 the same way.
    const { gemma1Url } = await load({ apiBase: "http://frink.msl.ubc.ca:8080" });
    expect(gemma1Url(JSP)).toBe("https://gemma.msl.ubc.ca" + JSP);
  });
});
