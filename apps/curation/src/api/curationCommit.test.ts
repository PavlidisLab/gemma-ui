import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.fn<(url: string, body?: unknown) => Promise<unknown>>(
  async () => ({ applied: true }),
);
vi.mock("./client", async (orig) => {
  const actual = await orig<typeof import("./client")>();
  return { ...actual, api: { ...actual.api, post } };
});

const {
  preflightCuration,
  commitCuration,
  signCuration,
  conflictOf,
  tagDeletionShortfall,
  tagDeletionShortfallMessage,
} = await import("./curationCommit");
const { ApiError, snakeify } = await import("./client");

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

describe("tagDeletionShortfall", () => {
  // Gemma's spelling, through the client boundary, as the commit path
  // reads it.
  const reportDeleting = (deleted: number) =>
    snakeify({
      applied: true,
      changes: { tags: { created: 0, updated: 0, deleted, unchanged: 3 } },
    }) as never;
  const doc = { tags: { deletedIds: [9018, 9019] } };

  it("🛑 reports a deletion Gemma skipped on a 200", () => {
    expect(tagDeletionShortfall(doc, reportDeleting(1))).toEqual({
      sent: 2,
      deleted: 1,
    });
  });

  it("is null when every id was deleted", () => {
    expect(tagDeletionShortfall(doc, reportDeleting(2))).toBeNull();
  });

  it("is null when the commit deleted no tags", () => {
    expect(tagDeletionShortfall({ design: {} }, reportDeleting(0))).toBeNull();
  });

  it("counts a report with no tag tally as nothing deleted", () => {
    expect(
      tagDeletionShortfall(doc, snakeify({ applied: true }) as never),
    ).toEqual({ sent: 2, deleted: 0 });
  });

  it("puts both counts in the curator's sentence", () => {
    expect(tagDeletionShortfallMessage({ sent: 2, deleted: 1 })).toContain(
      "deleted 1 of the 2 tags",
    );
  });
});
