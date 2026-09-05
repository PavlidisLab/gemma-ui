/**
 * Signing in has to drop the cached answers fetched while anonymous.
 *
 * The bug this pins: the datasets table showed 23k results / 942 pages
 * to an anonymous visitor, and kept showing them after sign-in. Page 2
 * is a different query key (`offset` is part of it), so it fetched
 * fresh and correctly reported 25k — then flipping back to page 1
 * served the stale anonymous entry again. Nothing in the data query
 * keys mentions the session, so only an explicit invalidation clears
 * them.
 */
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { invalidateAfterIdentityChange } from "./auth";

function seed(): QueryClient {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // The two pages the visitor browsed while anonymous, plus the
  // facet queries alongside them.
  qc.setQueryData(["datasets", { offset: 0, limit: 25 }], { totalElements: 23_000 });
  qc.setQueryData(["datasets", { offset: 25, limit: 25 }], { totalElements: 23_000 });
  qc.setQueryData(["taxa", { filter: [] }], []);
  qc.setQueryData(["auth", "me", "cookie"], null);
  qc.setQueryData(["openapi"], { components: {} });
  return qc;
}

const invalidated = (qc: QueryClient, key: unknown[]) =>
  qc.getQueryState(key)?.isInvalidated ?? false;

describe("invalidateAfterIdentityChange", () => {
  it("invalidates every cached data page, not just the active one", () => {
    const qc = seed();
    invalidateAfterIdentityChange(qc);
    expect(invalidated(qc, ["datasets", { offset: 0, limit: 25 }])).toBe(true);
    expect(invalidated(qc, ["datasets", { offset: 25, limit: 25 }])).toBe(true);
    expect(invalidated(qc, ["taxa", { filter: [] }])).toBe(true);
    expect(invalidated(qc, ["auth", "me", "cookie"])).toBe(true);
  });

  it("spares the OpenAPI spec — large, and identical to every caller", () => {
    const qc = seed();
    invalidateAfterIdentityChange(qc);
    expect(invalidated(qc, ["openapi"])).toBe(false);
  });
});
