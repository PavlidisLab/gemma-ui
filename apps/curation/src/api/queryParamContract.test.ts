/**
 * Every query parameter we send to Gemma must be one Gemma declares.
 *
 * 🛑 An unknown query parameter is becoming a **400** instead of a
 * silent drop. Merged, not yet deployed — gemma2 serves `e800aa7874`,
 * where a garbage parameter still answers 200 (measured 2026-08-31).
 *
 * The silent drop is the worse half anyway: gembro sampled
 * 5,556 live requests to frink and found exactly one bad parameter in
 * the whole window, and it was ours —
 * `GET /rest/v2/tickets?include_targets=false`, answered 200 with 92 KB
 * of the targets we asked not to receive.
 *
 * The failure mode is snake_case against a camelCase API: it looks
 * right, it has always returned 200, and it has never once worked.
 *
 * This pins the three call sites that were wrong. It is deliberately a
 * string check on the built URL rather than a mock of the API — the
 * point is what goes on the wire.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const mode = vi.hoisted(() => ({ current: "remote" as "remote" | "local" }));
vi.mock("@/lib/gemmaMode", async (orig) => {
  const actual = await orig<typeof import("@/lib/gemmaMode")>();
  return {
    ...actual,
    resolveGemmaMode: () => ({ ...actual.resolveGemmaMode(), mode: mode.current }),
    useGemmaMode: () => ({ ...actual.resolveGemmaMode(), mode: mode.current }),
  };
});

const urls = vi.hoisted(() => ({ seen: [] as string[] }));
vi.mock("@/api/client", async (orig) => {
  const actual = await orig<typeof import("@/api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: async (u: string) => {
        urls.seen.push(u);
        return [];
      },
    },
  };
});

import { experimentTicketsQueryOptions } from "./tickets";

/** Names `/tickets` actually declares, off the live spec. */
const TICKET_PARAMS = new Set([
  "openOnly", "assignee", "priority", "type", "state",
  "targetType", "updatedSince", "offset", "limit", "cursor",
]);

function paramsOf(url: string): string[] {
  const q = url.split("?")[1];
  return q ? q.split("&").map((kv) => kv.split("=")[0]) : [];
}

describe("query-parameter contract", () => {
  beforeEach(() => {
    urls.seen = [];
  });

  it("🛑 remote sends no snake_case ticket filters — Gemma 400s them", async () => {
    mode.current = "remote";
    await experimentTicketsQueryOptions(27103).queryFn();
    const url = urls.seen[0];
    expect(url).not.toMatch(/target_id|target_type|include_targets/);
    for (const p of paramsOf(url)) {
      expect(TICKET_PARAMS.has(p) || p === "").toBe(true);
    }
  });

  it("remote asks the per-dataset route, which resolves membership server-side", async () => {
    mode.current = "remote";
    await experimentTicketsQueryOptions(27103).queryFn();
    // Verified on 27103: returns ticket 6, finding the experiment
    // inside a 500-target ticket. Gemma has no target-id filter, so
    // there is nothing to rename the old parameters to.
    expect(urls.seen[0]).toBe("/rest/v2/datasets/27103/tickets");
  });

  it("local keeps the store's own filters — they are real there", async () => {
    mode.current = "local";
    await experimentTicketsQueryOptions(27103).queryFn();
    expect(urls.seen[0]).toContain("target_id=27103");
    expect(urls.seen[0]).toContain("/curation/v1/tickets");
  });
});
