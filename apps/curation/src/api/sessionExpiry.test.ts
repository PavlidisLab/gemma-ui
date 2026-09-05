/**
 * @vitest-environment jsdom
 *
 * An auth refusal must announce that the SESSION went.
 *
 * `useMe` is deliberately locked down (5-minute staleTime, no refetch
 * on focus / mount / reconnect) so the app does not flood gemma-rest
 * with AccessDeniedException traces on every window transition. The
 * cost is that an expiry mid-session is otherwise invisible — the app
 * still renders the curator's name while every request fails on its
 * own. Paul, 2026-08-31: "it's hard to tell when I am logged out."
 *
 * 🛑 **Gemma never sends 401.** Measured 2026-09-05 against gemma2: an
 * anonymous caller gets `403 "Access is denied"` on
 * `/datasets/657/annotation-sets` and on `/me` itself. A 401-only
 * trigger therefore never fired, and the curator saw a raw
 * "403 Forbidden — Access is denied" where the login page belonged.
 *
 * The discriminator is `/me` — it answers for the SESSION, not for any
 * entity's ACL. These tests pin BOTH directions, because widening to a
 * bare "403 ⇒ signed out" would sign a curator out over the 1,920
 * FactorValues on prod that have no ACL object-identity row.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { api } from "./client";

/** Let the fire-and-forget `/me` probe settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

function body(status: number) {
  return status === 204 ? null : JSON.stringify({ error: "no" });
}

/** Answers `/me` with `meStatus`, everything else with `status`. */
function stubFetch(status: number, meStatus?: number) {
  return vi.fn(async (url: string) => {
    const isMe = String(url).split("?")[0].endsWith("/rest/v2/me");
    const s = isMe && meStatus !== undefined ? meStatus : status;
    return new Response(body(s), {
      status: s,
      headers: { "content-type": "application/json" },
    });
  });
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

  it("🛑 does NOT fire on 403 when /me says the session is live", async () => {
    // 1,920 FactorValues on prod have no ACL object-identity row, and
    // a design commit against one refuses an ADMIN too. Signing the
    // curator out over that would be wrong and would bury the real
    // message.
    vi.stubGlobal("fetch", stubFetch(403, 200));
    await expect(api.get("/rest/v2/datasets/1")).rejects.toThrow();
    await flush();
    expect(fired).toBe(0);
  });

  it("DOES fire on 403 when /me is also refused — Gemma's signed-out shape", async () => {
    vi.stubGlobal("fetch", stubFetch(403, 403));
    await expect(api.get("/rest/v2/datasets/1")).rejects.toThrow();
    await flush();
    expect(fired).toBe(1);
  });

  it("fires once on a 403 from /me itself, without re-probing", async () => {
    const f = stubFetch(403, 403);
    vi.stubGlobal("fetch", f);
    await expect(api.get("/rest/v2/me")).rejects.toThrow();
    await flush();
    expect(fired).toBe(1);
    // The failing call itself; no probe on top of it.
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("probes /me ONCE for a burst of parallel 403s", async () => {
    const f = stubFetch(403, 403);
    vi.stubGlobal("fetch", f);
    await Promise.all(
      [1, 2, 3, 4].map((i) =>
        expect(api.get(`/rest/v2/datasets/${i}`)).rejects.toThrow(),
      ),
    );
    await flush();
    const meCalls = f.mock.calls.filter(([u]) =>
      String(u).endsWith("/rest/v2/me"),
    );
    expect(meCalls).toHaveLength(1);
  });

  it("does NOT fire when the /me probe 404s — local_api has no /me", async () => {
    vi.stubGlobal("fetch", stubFetch(403, 404));
    await expect(api.get("/rest/v2/datasets/1")).rejects.toThrow();
    await flush();
    expect(fired).toBe(0);
  });

  it("does NOT fire when the /me probe fails outright", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/rest/v2/me")) throw new Error("offline");
        return new Response(body(403), {
          status: 403,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    await expect(api.get("/rest/v2/datasets/1")).rejects.toThrow();
    await flush();
    expect(fired).toBe(0);
  });

  it("does not fire on the ordinary failures", async () => {
    for (const status of [400, 404, 409, 500, 502]) {
      vi.stubGlobal("fetch", stubFetch(status));
      await expect(api.get("/rest/v2/datasets/1")).rejects.toThrow();
    }
    await flush();
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
    await flush();
    expect(fired).toBe(0);
  });
});

/**
 * The relay's passthrough shape.
 *
 * `/curation-*` forwards to Gemma and returns its failure as
 * `{detail: {error, upstreamMessage, upstream}}` — a FastAPI `detail`
 * whose value is an object. Stringifying it handed the curator a JSON
 * blob; `upstreamMessage` is Gemma's own sentence and is what a curator
 * can act on.
 */
describe("readErrorBody — the relay passthrough", () => {
  afterEach(() => vi.unstubAllGlobals());

  const relayBody = {
    detail: {
      error: "upstream POST curation/preflight -> 400",
      upstreamMessage:
        "design references unknown sample short name 'GSE7866_bioMaterial_2' for this dataset.",
      upstream: '{"apiVersion":"2.9.4","buildInfo":{},"error":{"code":400}}',
    },
  };

  function stubJson(status: number, payload: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  }

  it("surfaces Gemma's sentence, not the wrapper", async () => {
    stubJson(400, relayBody);
    await expect(api.post("/curation-preflight/657", {})).rejects.toThrow(
      /unknown sample short name 'GSE7866_bioMaterial_2'/,
    );
  });

  it("🛑 does not stringify the detail object into the message", async () => {
    stubJson(400, relayBody);
    await expect(api.post("/curation-preflight/657", {})).rejects.not.toThrow(
      /upstreamMessage/,
    );
  });

  it("still reads a plain string detail (local_api / FastAPI)", async () => {
    stubJson(409, { detail: "draft already in flight" });
    await expect(api.post("/curation-draft/657", {})).rejects.toThrow(
      /draft already in flight/,
    );
  });

  it("falls back to stringify when detail is an object with no upstreamMessage", async () => {
    stubJson(409, { detail: { error: "conflict", draftRetained: true } });
    await expect(api.post("/curation-draft/657", {})).rejects.toThrow(
      /draftRetained/,
    );
  });
});
