/**
 * Gemma answers an XHR with HTTP 200 even when the request failed.
 *
 * `AbstractExceptionMapper.getResponseBuilder`:
 *
 *     Response.status( isXmlHttpRequest( request ) ? Response.Status.OK
 *                                                  : getStatus( exception ) )
 *
 * and `RestAuthEntryPoint` does the same for 401. The trigger is the
 * `X-Requested-With: XMLHttpRequest` header this client always sends,
 * so `r.ok` is true for a 400, a 404 and a 401 alike and the real code
 * travels in the body as `error.code`.
 *
 * Every body below is verbatim from build `e4e12f906e` on 2026-08-29,
 * fetched from the page itself — the same request answers 400 from curl
 * and 200 from the browser, and that difference is the whole point.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiGet } from "./client";

function respond(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      statusText: "",
      json: async () => body,
      clone: () => ({ json: async () => body }),
      text: async () => JSON.stringify(body),
    })),
  );
}

afterEach(() => vi.unstubAllGlobals());

/** The 400 the admin page's `isPublic` count actually received. */
const BAD_FILTER_200 = {
  apiVersion: "2.9.4",
  buildInfo: { version: "2.0.0-alpha-SNAPSHOT", gitHash: "e4e12f906e" },
  error: {
    code: 400,
    message:
      "The entity cannot be filtered by isPublic: The property of isPublic is unknown",
    errors: [{ reason: "java.lang.IllegalArgumentException" }],
  },
};

describe("apiGet against Gemma's XHR error envelope", () => {
  it("🛑 throws on a 200 that carries error.code", async () => {
    // Before this, `r.ok` was true, the envelope was returned as data,
    // and the admin card rendered `[object Object]` where a count
    // belonged — then summed it into `NaN`.
    respond(200, BAD_FILTER_200);
    await expect(apiGet("/rest/v2/datasets/count")).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  it("takes the code from the BODY, not the HTTP status", async () => {
    respond(200, BAD_FILTER_200);
    const err: ApiError = await apiGet<never>("/rest/v2/datasets/count").catch(
      (e: unknown) => e as ApiError,
    );
    expect(err.status).toBe(400);
    expect(err.detail).toMatch(/property of isPublic is unknown/);
  });

  it("does the same for the 401 the auth entry point wraps", async () => {
    // `RestAuthEntryPoint` returns 200 + this body for an XHR, so the
    // browser's native basic-auth popup never fires. LoginModal has had
    // a `status === 401` branch all along that could not fire.
    respond(200, {
      apiVersion: "2.9.4",
      error: { code: 401, message: "Provide valid credentials" },
    });
    const err: ApiError = await apiGet<never>("/rest/v2/me").catch(
      (e: unknown) => e as ApiError,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
  });

  it("passes a successful body straight through", async () => {
    respond(200, { data: 25695 });
    await expect(apiGet("/rest/v2/datasets/count")).resolves.toEqual({
      data: 25695,
    });
  });

  it("does not mistake a payload FIELD named error for the envelope", async () => {
    // The envelope test is `error.code` being a number. A payload that
    // merely carries the word must survive — a false positive here
    // turns working data into a thrown request.
    respond(200, { data: { name: "job", error: "something went wrong" } });
    await expect(apiGet("/rest/v2/admin/jobs")).resolves.toBeTruthy();
    respond(200, { data: { error: { message: "no code here" } } });
    await expect(apiGet("/rest/v2/admin/jobs")).resolves.toBeTruthy();
  });

  it("still throws on an honest non-2xx", async () => {
    respond(500, { error: { code: 500, message: "boom" } });
    await expect(apiGet("/rest/v2/datasets")).rejects.toBeInstanceOf(ApiError);
  });
});
