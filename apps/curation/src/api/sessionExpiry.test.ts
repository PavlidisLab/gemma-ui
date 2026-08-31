/**
 * @vitest-environment jsdom
 *
 * A 401 must announce that the SESSION went.
 *
 * `useMe` is deliberately locked down (5-minute staleTime, no refetch
 * on focus / mount / reconnect) so the app does not flood gemma-rest
 * with AccessDeniedException traces on every window transition. The
 * cost is that an expiry mid-session is otherwise invisible — the app
 * still renders the curator's name while every request fails on its
 * own. Paul, 2026-08-31: "it's hard to tell when I am logged out."
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { api } from "./client";

function stubFetch(status: number) {
  return vi.fn(async () =>
    new Response(status === 204 ? null : JSON.stringify({ error: "no" }), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("session-expiry signal", () => {
  let fired: number;
  const onExpired = () => {
    fired += 1;
  };

  beforeEach(() => {
    fired = 0;
    window.addEventListener("gca:session-expired", onExpired);
  });
  afterEach(() => {
    window.removeEventListener("gca:session-expired", onExpired);
    vi.unstubAllGlobals();
  });

  it("fires on 401", async () => {
    vi.stubGlobal("fetch", stubFetch(401));
    await expect(api.get("/rest/v2/datasets/1")).rejects.toThrow();
    expect(fired).toBe(1);
  });

  it("🛑 does NOT fire on 403 — that is an ACL gap, not a signed-out curator", async () => {
    // 1,920 FactorValues on prod have no ACL object-identity row, and
    // a design commit against one refuses an ADMIN too. Signing the
    // curator out over that would be wrong and would bury the real
    // message.
    vi.stubGlobal("fetch", stubFetch(403));
    await expect(api.get("/rest/v2/datasets/1")).rejects.toThrow();
    expect(fired).toBe(0);
  });

  it("does not fire on the ordinary failures", async () => {
    for (const status of [400, 404, 409, 500, 502]) {
      vi.stubGlobal("fetch", stubFetch(status));
      await expect(api.get("/rest/v2/datasets/1")).rejects.toThrow();
    }
    expect(fired).toBe(0);
  });

  it("does not fire on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await api.get("/rest/v2/datasets/1");
    expect(fired).toBe(0);
  });
});
