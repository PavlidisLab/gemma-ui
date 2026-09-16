/**
 * @vitest-environment jsdom
 *
 * The app can be mounted under a sub-path on a static server that
 * cannot be told to fall back to index.html, so routes live in the
 * fragment (see main.tsx). That arrangement leans on four specific
 * behaviours of TanStack's hash history — none of them obvious, and
 * all of them silent if they break: a bad assumption here doesn't
 * throw, it just quietly drops query params or sends people to the
 * home page.
 *
 * These are pinned against the library on purpose. If a TanStack
 * upgrade changes fragment semantics, this fails here rather than in
 * production.
 */
import { describe, expect, it } from "vitest";
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import {
  setFragmentParam,
  splitFragment,
} from "@/features/dataset/VisualizeTab";

function mkRouter() {
  const root = createRootRoute();
  const index = createRoute({ getParentRoute: () => root, path: "/" });
  const browser = createRoute({ getParentRoute: () => root, path: "/browser" });
  const dataset = createRoute({
    getParentRoute: () => root,
    path: "/dataset/$id",
  });
  return createRouter({
    routeTree: root.addChildren([index, browser, dataset]),
    history: createHashHistory(),
  });
}

describe("hash routing assumptions", () => {
  it("parses the route out of the fragment", () => {
    window.history.replaceState({}, "", "/mnt/#/dataset/123");
    const r = mkRouter();
    expect(r.state.location.pathname).toBe("/dataset/123");
  });

  it("parses search params living inside the fragment", () => {
    window.history.replaceState({}, "", "/mnt/#/browser?s=abc&sort=x");
    const r = mkRouter();
    expect(r.state.location.pathname).toBe("/browser");
    expect(r.state.location.search).toMatchObject({ s: "abc", sort: "x" });
  });

  it("keeps a secondary #app-state fragment separate from the route", () => {
    window.history.replaceState({}, "", "/mnt/#/dataset/9#genes=1,2");
    const r = mkRouter();
    expect(r.state.location.pathname).toBe("/dataset/9");
    expect(r.state.location.hash).toBe("genes=1,2");
  });

  it("builds share hrefs that carry the /mnt mount point", () => {
    window.history.replaceState({}, "", "/mnt/#/browser");
    const r = mkRouter();
    const built = r.buildLocation({ to: "/browser", search: { s: "abc" } });
    const href = r.history.createHref(built.publicHref);
    expect(href).toBe("/mnt/#/browser?s=abc");
    expect(new URL(href, "https://example.org").toString()).toBe(
      "https://example.org/mnt/#/browser?s=abc",
    );
  });
});

// The Visualize tab stores its gene selection in the fragment too, so
// it has to share that space with the route. Splitting it wrong is how
// you get a refresh that lands on the home page.
describe("splitFragment", () => {
  it("treats a lone param string as entirely ours (browser history)", () => {
    expect(splitFragment("#genes=1,2")).toEqual({
      route: "",
      params: "genes=1,2",
    });
  });

  it("separates route from params (hash history)", () => {
    expect(splitFragment("#/dataset/9#genes=1,2")).toEqual({
      route: "/dataset/9",
      params: "genes=1,2",
    });
  });

  it("handles a route with no params", () => {
    expect(splitFragment("#/dataset/9")).toEqual({
      route: "/dataset/9",
      params: "",
    });
  });

  it("handles an empty fragment", () => {
    expect(splitFragment("")).toEqual({ route: "", params: "" });
  });
});

// The Visualize tab writes two independent params into that shared
// space — the loose gene ids and the picked GO terms — from two
// effects that fire on the same render. They went through separate
// copies of this rebuild, and the second to run clobbered the first;
// worse, one copy dropped the leading "#" off the route and took the
// whole app off its route. One writer now, pinned here.
describe("setFragmentParam", () => {
  it("adds a param without disturbing the route", () => {
    window.history.replaceState({}, "", "/#/dataset/9?tab=visualize");
    setFragmentParam("go", "GO:0005840");
    expect(window.location.hash).toBe("#/dataset/9?tab=visualize#go=GO%3A0005840");
  });

  it("keeps a param another writer just set", () => {
    window.history.replaceState({}, "", "/#/dataset/9#genes=1,2");
    setFragmentParam("go", "GO:0005840");
    const { route, params } = splitFragment(window.location.hash);
    expect(route).toBe("/dataset/9");
    const p = new URLSearchParams(params);
    expect(p.get("genes")).toBe("1,2");
    expect(p.get("go")).toBe("GO:0005840");
  });

  it("clears one param and leaves the other", () => {
    window.history.replaceState({}, "", "/#/dataset/9#genes=1,2&go=GO%3A1");
    setFragmentParam("go", null);
    const { params } = splitFragment(window.location.hash);
    const p = new URLSearchParams(params);
    expect(p.get("genes")).toBe("1,2");
    expect(p.get("go")).toBeNull();
  });

  it("keeps the route when the last param goes", () => {
    window.history.replaceState({}, "", "/#/dataset/9#go=GO%3A1");
    setFragmentParam("go", null);
    expect(window.location.hash).toBe("#/dataset/9");
  });

  it("preserves a sub-path mount", () => {
    window.history.replaceState({}, "", "/mnt/#/dataset/9");
    setFragmentParam("go", "GO:1");
    expect(window.location.pathname).toBe("/mnt/");
    expect(window.location.hash).toBe("#/dataset/9#go=GO%3A1");
  });
});
