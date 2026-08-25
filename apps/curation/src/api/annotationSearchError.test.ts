/**
 * @vitest-environment jsdom
 *
 * Two backends answer through one client and they shape errors
 * differently — FastAPI's `{detail}` for local_api, Gemma's
 * `{apiVersion, buildInfo, error: {code, message}}` for gemma-rest.
 * Only the first was understood, so a Gemma error reached the caller as
 * the whole envelope stringified, buildInfo and all.
 *
 * That stopped being cosmetic on 2026-08-25, when `/annotations/search`
 * began answering `400 Invalid search query: cell OR` — the first Gemma
 * error worth putting in front of a curator word for word.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { api, ApiError } from "./client";
import { annotationSearchMessage } from "./annotations";

function respondWith(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

afterEach(() => vi.unstubAllGlobals());

/** Call it, require that it rejected with an ApiError, and hand the
 *  error back typed. `.catch(e => e)` yields `unknown`, which every
 *  assertion below then has to widen past. */
async function failing(call: () => Promise<unknown>): Promise<ApiError> {
  try {
    await call();
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error("expected the request to reject");
}


describe("error-body reading", () => {
  it("pulls the bare sentence out of Gemma's envelope", async () => {
    respondWith(400, {
      apiVersion: "2.9.4",
      buildInfo: { version: "2.0.0-alpha-SNAPSHOT", gitHash: "8b76ee195c" },
      error: { code: 400, message: "Invalid search query: cell OR" },
    });

    const err = await failing(() => api.get("/rest/v2/annotations/search"));
    expect(err.status).toBe(400);
    expect(err.detail).toBe("Invalid search query: cell OR");
    // The thing that used to happen: the curator got the build metadata.
    expect(err.detail).not.toContain("buildInfo");
    expect(err.detail).not.toContain("apiVersion");
  });

  it("still prefers FastAPI's detail — local_api is the other backend", async () => {
    respondWith(404, { detail: "no Gemma dataset matches reference='GSE0'" });
    const err = await failing(() => api.get("/rest/v2/tickets/from-accession"));
    expect(err.detail).toBe("no Gemma dataset matches reference='GSE0'");
  });

  it("falls back to the stringified body for a shape it doesn't know", async () => {
    respondWith(500, { something: "else" });
    const err = await failing(() => api.get("/x"));
    expect(err.detail).toBe('{"something":"else"}');
  });
});

describe("annotationSearchMessage", () => {
  it("appends the operator hint to a 400 — the server says what, not why", () => {
    const m = annotationSearchMessage(
      new ApiError("x", 400, "Bad Request", "Invalid search query: cell OR"),
    );
    expect(m).toContain("Invalid search query: cell OR");
    // Lowercasing really is the fix: `cell or` is 200, `cell OR` is 400.
    expect(m).toMatch(/lowercase/i);
  });

  it("leaves any other status to say its own piece", () => {
    expect(
      annotationSearchMessage(new ApiError("x", 503, "Unavailable", "index rebuilding")),
    ).toBe("index rebuilding");
  });

  it("handles a plain Error and a non-Error alike", () => {
    expect(annotationSearchMessage(new Error("offline"))).toBe("offline");
    expect(annotationSearchMessage("nope")).toBe("Catalog search failed.");
  });
});
