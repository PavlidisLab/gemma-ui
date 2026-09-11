/**
 * Which upstream a dev-server request actually reaches.
 *
 * 🛑 Vite tests a regex proxy key against ``req.url``, which carries
 * the QUERY STRING. An entry anchored with a bare ``$`` therefore stops
 * matching as soon as its caller adds a parameter, and the request
 * falls through to the ``/rest`` catch-all — the curation store in
 * local mode, which has none of these Gemma-only routes and answers
 * 404. The hooks read a 404 as an ordinary "nothing recorded", so the
 * misroute surfaces as a confident wrong answer rather than an error:
 * ``/cellTypeAssignment?exclude=cellTypeIds`` reported no cell-type
 * assignment on datasets that have one.
 *
 * The URLs below are built the way the hooks build them, so a caller
 * that starts sending a parameter fails here rather than in the panel.
 */
import { describe, expect, it } from "vitest";

import viteConfig from "../../vite.config";

type ProxyTable = Record<string, { target?: string } | string>;

function proxyTable(): ProxyTable {
  const conf = viteConfig({ command: "serve", mode: "test" }) as {
    server?: { proxy?: ProxyTable };
  };
  return conf.server?.proxy ?? {};
}

/** Vite's own rule: a key starting with ``^`` is a regex tested against
 *  the full request url; anything else is a path prefix. First match in
 *  declaration order wins. */
function matchedKey(proxy: ProxyTable, url: string): string | undefined {
  return Object.keys(proxy).find((key) =>
    key.startsWith("^") ? new RegExp(key).test(url) : url.startsWith(key),
  );
}

/** Every anchored key, and a request url a caller sends to it. The
 *  ``?``-bearing entries are the ones the bare-``$`` defect hides. */
const ROUTED: Array<[string, string]> = [
  // api/cellTypeAssignment.ts — `exclude=cellTypeIds` keeps an 809 KB
  // response down to ten numbers, and is sent on every call.
  [
    "/rest/v2/datasets/27438/cellTypeAssignment?exclude=cellTypeIds",
    "^/rest/v2/datasets/\\d+/cellTypeAssignment(\\?.*)?$",
  ],
  // api/experimentSets.ts builds its own query string.
  [
    "/rest/v2/experiment-sets?offset=0&limit=200",
    "^/rest/v2/experiment-sets(\\?.*)?$",
  ],
  ["/rest/v2/datasets/27438/subSets", "^/rest/v2/datasets/\\d+/subSets(\\?.*)?$"],
  [
    "/rest/v2/datasets/27438/sourceMetadata",
    "^/rest/v2/datasets/\\d+/sourceMetadata(\\?.*)?$",
  ],
  ["/rest/v2/me", "^/rest/v2/(login|logout|me)(\\?.*)?$"],
  ["/rest/v2/login", "^/rest/v2/(login|logout|me)(\\?.*)?$"],
  ["/rest/v2/logout", "^/rest/v2/(login|logout|me)(\\?.*)?$"],
  [
    "/rest/v2/datasets/27438/svd?component=1",
    "^/rest/v2/datasets/\\d+/(svd|sample-correlation|mean-variance).*",
  ],
  [
    "/rest/v2/datasets/27438/auditEvents",
    "^/rest/v2/datasets/\\d+/auditEvents.*",
  ],
];

describe("dev-server proxy routing", () => {
  const proxy = proxyTable();

  it.each(ROUTED)("routes %s by its own entry", (url, key) => {
    expect(matchedKey(proxy, url)).toBe(key);
  });

  it("🛑 no anchored key loses its route to a query string", () => {
    // The whole defect class in one assertion: appending a parameter
    // must never move a request onto a different entry.
    for (const [url, key] of ROUTED) {
      const withParam = url.includes("?") ? url : `${url}?probe=1`;
      expect(matchedKey(proxy, withParam), withParam).toBe(key);
    }
  });

  it("🛑 an anchored key never ends in a bare $", () => {
    // A future entry written with `…$` would 404 the first time its
    // caller added a parameter, and the hook would read that 404 as an
    // ordinary empty answer.
    for (const key of Object.keys(proxy)) {
      if (!key.startsWith("^") || !key.endsWith("$")) continue;
      expect(key, key).toMatch(/\(\\\?\.\*\)\?\$$/);
    }
  });

  it("keeps the catch-all last among the /rest entries", () => {
    // Declaration order is the routing rule, so a Gemma-only exception
    // placed after `/rest` would never be reached.
    const keys = Object.keys(proxy);
    const restExceptions = keys
      .map((k, i) => [k, i] as const)
      .filter(([k]) => k.startsWith("^/rest"))
      .map(([, i]) => i);
    expect(Math.max(...restExceptions)).toBeLessThan(keys.indexOf("/rest"));
  });
});
