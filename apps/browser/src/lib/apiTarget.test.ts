/**
 * Which server the footer chip says we are talking to.
 *
 * Pinned because the wrong answer shipped and looked like a
 * misconfiguration: the gemma2 deployment reported
 * "API → localhost:8080" with the amber local-server dot, while every
 * request was going same-origin to gemma2. The build-time
 * `__GEMMA_TARGET__` is the DEV PROXY's upstream; a deployed build has
 * no proxy, so that value is whatever sat in the build machine's
 * environment and describes nothing.
 */
import { describe, expect, it } from "vitest";

import { resolveApiTarget } from "./gemmaConfig";

describe("resolveApiTarget", () => {
  it("🛑 in prod, reports the serving origin — never the baked proxy target", () => {
    expect(
      resolveApiTarget({
        dev: false,
        proxyTarget: "http://localhost:8080",
        baseUrl: "https://gemma2.msl.ubc.ca",
        origin: "https://gemma2.msl.ubc.ca",
      }),
    ).toBe("https://gemma2.msl.ubc.ca");
  });

  it("in prod, still the origin even when nothing else is configured", () => {
    // `apiBase` is the relative `/rest/v2`, so the origin is where the
    // calls land whatever the build did or did not bake in.
    expect(
      resolveApiTarget({ dev: false, origin: "https://gemma2.msl.ubc.ca" }),
    ).toBe("https://gemma2.msl.ubc.ca");
  });

  it("in dev, reports the upstream the proxy forwards to", () => {
    // Here the value is true and useful: the page is served from
    // :5183 and the API calls really do reach :8080.
    expect(
      resolveApiTarget({
        dev: true,
        proxyTarget: "http://localhost:8080",
        baseUrl: "https://gemma2.msl.ubc.ca",
        origin: "http://localhost:5183",
      }),
    ).toBe("http://localhost:8080");
  });

  it("in dev with no proxy target, falls back to the configured base", () => {
    expect(
      resolveApiTarget({
        dev: true,
        proxyTarget: "",
        baseUrl: "https://gemma2.msl.ubc.ca",
        origin: "http://localhost:5183",
      }),
    ).toBe("https://gemma2.msl.ubc.ca");
  });

  it("never returns empty — the chip read 'unset' on a good build once", () => {
    expect(
      resolveApiTarget({ dev: true, origin: "http://localhost:5183" }),
    ).toBe("http://localhost:5183");
  });
});
