import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.fn<(url: string, body?: unknown) => Promise<unknown>>(
  async () => ({ applied: true }),
);
vi.mock("./client", async (orig) => {
  const actual = await orig<typeof import("./client")>();
  return { ...actual, api: { ...actual.api, post } };
});

const { preflightCuration, commitCuration, signCuration, conflictOf } =
  await import("./curationCommit");
const { ApiError } = await import("./client");

beforeEach(() => post.mockClear());

describe("the commit chain's URLs", () => {
  it("preflight and commit hit the relay, not Gemma", async () => {
    // The UI is a read-only client of Gemma; the agent writes.
    await preflightCuration(9001, {});
    await commitCuration(9001, {});
    expect(post.mock.calls[0][0]).toBe("/curation-preflight/9001");
    expect(post.mock.calls[1][0]).toBe("/curation-commit/9001");
  });

  it("threads baselineLastModified — that is what detects a stale edit", async () => {
    await commitCuration(9001, {}, { baselineLastModified: "2026-08-26T20:00:00Z" });
    expect(post.mock.calls[0][0]).toContain(
      "baselineLastModified=2026-08-26T20%3A00%3A00Z",
    );
  });

  it("🛑 never sends `force` — sign is the route for consequences", async () => {
    await commitCuration(9001, {}, { baselineLastModified: "x", onBehalfOf: "alice" });
    expect(post.mock.calls[0][0]).not.toContain("force");
  });

  it("omits absent params rather than sending empties", async () => {
    // `?onBehalfOf=` is not the same request as no onBehalfOf at all.
    await commitCuration(9001, {}, { onBehalfOf: "" });
    expect(post.mock.calls[0][0]).toBe("/curation-commit/9001");
  });

  it("passes the document through as the body", async () => {
    const doc = { baseline: { lastModified: "t" }, tags: { deletedIds: [7] } };
    await preflightCuration("9001", doc);
    expect(post.mock.calls[0][1]).toEqual(doc);
  });

  it("sign defaults to an empty body rather than sending nothing", async () => {
    await signCuration(9001);
    expect(post.mock.calls[0][0]).toBe("/curation-sign/9001");
    expect(post.mock.calls[0][1]).toEqual({});
  });
});

describe("conflictOf", () => {
  it("reads a refusal reason off the relay's 409", () => {
    const err = new ApiError("failed: 409", 409, "Conflict", "refused", {
      detail: { reason: "LOCK_REQUIRED", retryableAfterReread: false },
    });
    expect(conflictOf(err)?.reason).toBe("LOCK_REQUIRED");
  });
});
