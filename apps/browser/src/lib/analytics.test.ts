/**
 * @vitest-environment jsdom
 *
 * Two things about GA in this app are not the default behaviour and so
 * are the things that can silently regress:
 *
 *  - it must not fire from a dev server, and "dev server" is not just
 *    loopback (see `isPublicOrigin`);
 *  - a hash-route navigation must produce a page_view with the route in
 *    the PATH, not a bare `/` with the route hidden in a fragment GA4
 *    drops from the Page path dimension.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountPrefix, pageLocation } from "./analytics";

/** Re-import with a given page origin. The module reads the origin at
 *  call time but `isPublicOrigin` is bound at import, so each case gets
 *  a fresh registry. */
async function load(origin: string) {
  vi.resetModules();
  vi.stubGlobal("__GEMMA_TARGET__", "");
  Object.defineProperty(window, "location", {
    writable: true,
    value: { origin, pathname: "/", href: origin + "/" },
  });
  return await import("./analytics");
}

function stubRouter(href = "/") {
  const listeners: Array<(e: { toLocation: { href: string } }) => void> = [];
  return {
    listeners,
    state: { location: { href } },
    subscribe: (
      _e: "onResolved",
      fn: (e: { toLocation: { href: string } }) => void,
    ) => {
      listeners.push(fn);
      return () => {};
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.gtag;
  delete window.dataLayer;
});

describe("mountPrefix", () => {
  it("is empty at a host root", () => {
    expect(mountPrefix("/")).toBe("");
  });

  it("keeps a sub-path mount", () => {
    expect(mountPrefix("/browser/")).toBe("/browser");
    expect(mountPrefix("/browser")).toBe("/browser");
  });

  it("drops an explicit index.html", () => {
    expect(mountPrefix("/browser/index.html")).toBe("/browser");
  });
});

describe("pageLocation", () => {
  it("folds the hash route into the path", () => {
    expect(pageLocation("https://gemma.msl.ubc.ca", "/", "/dataset/123")).toBe(
      "https://gemma.msl.ubc.ca/dataset/123",
    );
  });

  it("keeps the route's own search string", () => {
    expect(
      pageLocation("https://gemma.msl.ubc.ca", "/", "/dataset/123?tab=design"),
    ).toBe("https://gemma.msl.ubc.ca/dataset/123?tab=design");
  });

  it("does not merge a sub-path deployment into the root's rows", () => {
    expect(
      pageLocation("https://gemma.msl.ubc.ca", "/browser/", "/dataset/123"),
    ).toBe("https://gemma.msl.ubc.ca/browser/dataset/123");
  });
});

describe("initAnalytics", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
  });

  it("loads nothing on a plain-http dev host", async () => {
    const { initAnalytics } = await load("http://192.168.1.20:5183");
    initAnalytics(stubRouter());
    expect(document.head.querySelector("script")).toBeNull();
    expect(window.gtag).toBeUndefined();
  });

  it("loads nothing on https loopback", async () => {
    const { initAnalytics } = await load("https://localhost:5183");
    initAnalytics(stubRouter());
    expect(window.gtag).toBeUndefined();
  });

  it("loads the tag on the public host and reports the first route", async () => {
    const { initAnalytics } = await load("https://gemma.msl.ubc.ca");
    initAnalytics(stubRouter("/dataset/123"));

    const tag = document.head.querySelector("script");
    expect(tag?.getAttribute("src")).toContain(
      "googletagmanager.com/gtag/js?id=G-41V8D9335C",
    );

    // config must suppress the automatic view, or the manual one below
    // double-counts every first load.
    const calls = (window.dataLayer ?? []).map((a) => Array.from(a as never));
    expect(calls).toContainEqual([
      "config",
      "G-41V8D9335C",
      { send_page_view: false },
    ]);
    const view = calls.find((c) => c[1] === "page_view");
    expect(view?.[2]).toMatchObject({
      page_location: "https://gemma.msl.ubc.ca/dataset/123",
    });
  });

  it("reports a page_view for each later route", async () => {
    const { initAnalytics } = await load("https://gemma.msl.ubc.ca");
    const router = stubRouter("/");
    initAnalytics(router);

    router.listeners.forEach((fn) =>
      fn({ toLocation: { href: "/platforms/GPL96" } }),
    );

    const locations = (window.dataLayer ?? [])
      .map((a) => Array.from(a as never))
      .filter((c) => c[1] === "page_view")
      .map((c) => (c[2] as { page_location: string }).page_location);
    expect(locations).toEqual([
      "https://gemma.msl.ubc.ca/",
      "https://gemma.msl.ubc.ca/platforms/GPL96",
    ]);
  });
});
