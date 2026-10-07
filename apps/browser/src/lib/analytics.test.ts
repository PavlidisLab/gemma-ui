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
import {
  TITLE_WAIT_MS,
  mountPrefix,
  pageLocation,
  trackPageViews,
} from "./analytics";

/** Re-import with a given page origin. The module reads the origin at
 *  call time but `isPublicOrigin` is bound at import, so each case gets
 *  a fresh registry. */
async function load(origin: string, gaId = "G-41V8D9335C") {
  vi.resetModules();
  vi.stubGlobal("__GEMMA_TARGET__", "");
  vi.stubEnv("VITE_GA_MEASUREMENT_ID", gaId);
  Object.defineProperty(window, "location", {
    writable: true,
    value: { origin, pathname: "/", href: origin + "/" },
  });
  return await import("./analytics");
}

function stubRouter() {
  const listeners: Array<(e: { toLocation: { href: string } }) => void> = [];
  const state = {
    matches: [] as Array<{ staticData?: { titled?: boolean } }>,
  };
  return {
    listeners,
    state,
    /** Resolve a route, as the router does after rendering it. */
    resolve(href: string, titled = false) {
      state.matches = [{ staticData: { titled } }];
      listeners.forEach((fn) => fn({ toLocation: { href } }));
    },
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
  vi.unstubAllEnvs();
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

  it("loads nothing on the public host when no ID is configured", async () => {
    // A build whose .env.<mode> names no property must stay dark, not
    // borrow production's and pollute its numbers.
    const { initAnalytics } = await load("https://staging-gemma.msl.ubc.ca", "");
    initAnalytics(stubRouter());
    expect(document.head.querySelector("script")).toBeNull();
    expect(window.gtag).toBeUndefined();
  });

  it("reports to the property its build names", async () => {
    const { initAnalytics } = await load("https://gemma2.msl.ubc.ca", "G-TEST123");
    initAnalytics(stubRouter());
    expect(document.head.querySelector("script")?.getAttribute("src")).toContain(
      "gtag/js?id=G-TEST123",
    );
  });

  it("loads the tag on the public host and reports the first route", async () => {
    const { initAnalytics } = await load("https://gemma.msl.ubc.ca");
    const router = stubRouter();
    initAnalytics(router);
    router.resolve("/dataset/123");

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
    const router = stubRouter();
    initAnalytics(router);
    router.resolve("/");
    router.resolve("/platforms/GPL96");

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

describe("trackPageViews", () => {
  const APP = "Gemma Browser";
  let sent: Array<{ href: string; title: string }>;
  const send = (href: string) => sent.push({ href, title: document.title });

  beforeEach(() => {
    vi.useFakeTimers();
    document.head.innerHTML = "<title></title>";
    document.title = APP;
    sent = [];
  });
  afterEach(() => vi.useRealTimers());

  it("counts a route once however often it re-resolves", () => {
    // onResolved fires whenever pending router work settles; it is
    // not a navigation event.
    const router = stubRouter();
    trackPageViews(router, APP, send);
    router.resolve("/genes");
    router.resolve("/genes");
    router.resolve("/genes");
    expect(sent.map((s) => s.href)).toEqual(["/genes"]);
  });

  it("still counts a return to an earlier route", () => {
    const router = stubRouter();
    trackPageViews(router, APP, send);
    router.resolve("/genes");
    router.resolve("/platforms");
    router.resolve("/genes");
    expect(sent.map((s) => s.href)).toEqual(["/genes", "/platforms", "/genes"]);
  });

  it("sends an untitled route at once", () => {
    const router = stubRouter();
    trackPageViews(router, APP, send);
    router.resolve("/platforms");
    expect(sent).toEqual([{ href: "/platforms", title: APP }]);
  });

  it("holds a titled route's view until the page names the tab", async () => {
    const router = stubRouter();
    trackPageViews(router, APP, send);
    router.resolve("/dataset/2", true);
    expect(sent).toEqual([]);

    document.title = "GSE2872 · Gemma Browser";
    await vi.advanceTimersByTimeAsync(0); // MutationObserver delivery
    expect(sent).toEqual([
      { href: "/dataset/2", title: "GSE2872 · Gemma Browser" },
    ]);
  });

  it("sends at once when the title is already there (cached data)", () => {
    const router = stubRouter();
    trackPageViews(router, APP, send);
    document.title = "GSE2872 · Gemma Browser";
    router.resolve("/dataset/2", true);
    expect(sent).toHaveLength(1);
  });

  it("gives up waiting and sends under the app name", async () => {
    // A dataset that 404s never names itself; the view still counts.
    const router = stubRouter();
    trackPageViews(router, APP, send);
    router.resolve("/dataset/nope", true);
    await vi.advanceTimersByTimeAsync(TITLE_WAIT_MS);
    expect(sent).toEqual([{ href: "/dataset/nope", title: APP }]);
  });

  it("sends a held view when the visitor moves on first", () => {
    const router = stubRouter();
    trackPageViews(router, APP, send);
    router.resolve("/dataset/2", true);
    router.resolve("/genes");
    expect(sent.map((s) => s.href)).toEqual(["/dataset/2", "/genes"]);
  });

  it("sends a held view when the tab is closed", () => {
    const router = stubRouter();
    trackPageViews(router, APP, send);
    router.resolve("/dataset/2", true);
    window.dispatchEvent(new Event("pagehide"));
    expect(sent.map((s) => s.href)).toEqual(["/dataset/2"]);
  });
});
