/**
 * @vitest-environment jsdom
 *
 * Gemma wraps its errors as `{apiVersion, buildInfo, error: {code,
 * message}}`. `readErr` knew about `error` but stringified it, so the
 * caller got `{"code":400,"message":"…"}` — the sentence was in there,
 * inside JSON nobody should have to read.
 *
 * It matters now because `/annotations/search` answers `400 Invalid
 * search query: tumour OR normal` as of gemma2 `8b76ee195c`
 * (2026-08-25), and the selector renders a failed search and an empty
 * one identically.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { apiGet, ApiError } from "./client";
import { annotationSearchMessage } from "./endpoints";

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


describe("readErr", () => {
  it("pulls the bare sentence out of Gemma's envelope", async () => {
    respondWith(400, {
      apiVersion: "2.9.4",
      buildInfo: { gitHash: "8b76ee195c" },
      error: { code: 400, message: "Invalid search query: tumour OR normal" },
    });

    const err = await failing(() => apiGet("/rest/v2/annotations/search"));
    expect(err.detail).toBe("Invalid search query: tumour OR normal");
    expect(err.detail).not.toContain('"code"');
  });

  it("keeps a plain-string error as-is", async () => {
    respondWith(500, { error: "boom" });
    const err = await failing(() => apiGet("/x"));
    expect(err.detail).toBe("boom");
  });

  it("falls back to the stringified object when there is no message", async () => {
    respondWith(500, { error: { code: 500 } });
    const err = await failing(() => apiGet("/x"));
    expect(err.detail).toBe('{"code":500}');
  });
});

describe("annotationSearchMessage", () => {
  const badQuery = () =>
    new ApiError("x", 400, "Bad Request", "Invalid search query: tumour OR normal");

  it("leads with the server's own sentence", () => {
    const m = annotationSearchMessage(badQuery(), "tumour OR normal");
    expect(m.startsWith("Invalid search query: tumour OR normal")).toBe(true);
  });

  it("appends the operator hint when the query used an operator", () => {
    const m = annotationSearchMessage(badQuery(), "tumour OR normal");
    expect(m).toMatch(/search operators/i);
    expect(m).toMatch(/one term at a time/i);
  });

  /**
   * Measured on gemma2 `38c877d85b` (2026-08-26): `cell OR neuron`,
   * `cell OR normal` and `tumour OR brain` all answer 200, while
   * `normal OR brain` and `tumour OR normal` answer 400. Capitals are
   * not the discriminator, so the hint must not claim they are — and it
   * must not tell anyone to lowercase, because `normal or brain` is a
   * 200 with zero hits: a silently empty result in place of an error.
   */
  it("does not blame capitalisation, and does not advise lowercasing", () => {
    const m = annotationSearchMessage(badQuery(), "tumour OR normal");
    expect(m).not.toMatch(/lowercase/i);
    expect(m).not.toMatch(/capital/i);
  });

  it("withholds the operator hint when the query used no operator", () => {
    const m = annotationSearchMessage(
      new ApiError("x", 400, "Bad Request", "Invalid search query: something else"),
      "something else",
    );
    expect(m).toBe("Invalid search query: something else");
  });

  // A term that merely CONTAINS an operator is not using one.
  it.each(["ANDROGEN", "NOTCH signalling", "ORF1ab", "androgen or brain"])(
    "treats %j as operator-free",
    (query) => {
      const m = annotationSearchMessage(
        new ApiError("x", 400, "Bad Request", "Invalid search query"),
        query,
      );
      expect(m).toBe("Invalid search query");
    },
  );

  it.each(["cell OR", "OR cell", "AND", "NOT cell", "a AND b"])(
    "treats %j as using an operator",
    (query) => {
      expect(
        annotationSearchMessage(
          new ApiError("x", 400, "Bad Request", "Invalid search query"),
          query,
        ),
      ).toMatch(/one term at a time/i);
    },
  );

  it("keeps the hint when the caller offers no query at all", () => {
    expect(annotationSearchMessage(badQuery())).toMatch(/one term at a time/i);
  });

  it("leaves any other status to say its own piece", () => {
    expect(
      annotationSearchMessage(new ApiError("x", 503, "Unavailable", "index rebuilding")),
    ).toBe("index rebuilding");
  });

  it("handles a plain Error and a non-Error alike", () => {
    expect(annotationSearchMessage(new Error("offline"))).toBe("offline");
    expect(annotationSearchMessage(null)).toBe("Search failed.");
  });
});
