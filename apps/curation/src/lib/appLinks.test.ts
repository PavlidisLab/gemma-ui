/**
 * Cross-app links must address a HASH route.
 *
 * The browser app runs on `createHashHistory()`, so `/browser` is a
 * fragment, not a path. Emitting it as a path 404s on any host serving
 * the app statically — and passes in local dev regardless, because
 * vite's SPA fallback answers every path with index.html and the hash
 * router then shows its default route instead of the one requested. So
 * the local-dev "it works" signal cannot catch this; only the shape of
 * the URL can.
 *
 * Measured 2026-08-27: gemma2.msl.ubc.ca serves the browser app at `/`
 * (200) and 404s on both `/browser` and `/admin/system`.
 */
import { describe, expect, it } from "vitest";
import { adminUrl, browserUrl } from "./appLinks";

describe("cross-app links", () => {
  it("puts the route in the fragment, not the path", () => {
    const url = browserUrl("/browser");
    expect(url).toContain("/#/browser");
    // The failure mode: a bare path that a static host cannot resolve.
    expect(url).not.toMatch(/[^#]\/browser$/);
  });

  it("normalizes a route given without a leading slash", () => {
    expect(browserUrl("browser")).toBe(browserUrl("/browser"));
  });

  it("sends Admin to the browser app's admin route, also hashed", () => {
    expect(adminUrl()).toContain("/#/admin/system");
  });

  it("still produces a usable URL for the default route", () => {
    expect(browserUrl()).toMatch(/\/#\/$/);
  });
});
