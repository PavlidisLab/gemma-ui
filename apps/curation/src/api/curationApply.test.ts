import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.fn<(url: string, body?: unknown) => Promise<unknown>>(
  async () => ({ status: "ready" }),
);
vi.mock("./client", async (orig) => {
  const actual = await orig<typeof import("./client")>();
  return { ...actual, api: { ...actual.api, post } };
});

const { applyFinding, applyRefusalOf } = await import("./curationCommit");
const { ApiError } = await import("./client");

beforeEach(() => post.mockClear());

describe("applyFinding — the one-click route", () => {
  it("posts to the agent relay, naming the set, the finding and the curator", async () => {
    await applyFinding(20113, "6b9e7182c33ceb6a", { onBehalfOf: "alice" });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe(
      "/curation-apply/20113/6b9e7182c33ceb6a?onBehalfOf=alice",
    );
  });

  it("sends dryRun only for a dry run, and threads the baseline token", async () => {
    await applyFinding(1, "f", { onBehalfOf: "a", dryRun: true });
    await applyFinding(1, "f", {
      onBehalfOf: "a",
      baselineLastModified: "2026-09-13T20:00:00Z",
    });
    expect(post.mock.calls[0][0]).toContain("dryRun=true");
    expect(post.mock.calls[1][0]).not.toContain("dryRun");
    expect(post.mock.calls[1][0]).toContain(
      "baselineLastModified=2026-09-13T20%3A00%3A00Z",
    );
  });

  it("sends the curator's reason in the body, and an empty body without one", async () => {
    await applyFinding(1, "f", { onBehalfOf: "a", reason: "well_evidenced: named in methods" });
    await applyFinding(1, "f", { onBehalfOf: "a" });
    expect(post.mock.calls[0][1]).toEqual({ reason: "well_evidenced: named in methods" });
    expect(post.mock.calls[1][1]).toEqual({});
  });

  it("🛑 never sends `force` — the route answers REQUIRES_FORCE with a 409", async () => {
    await applyFinding(1, "f", { onBehalfOf: "a" });
    expect(post.mock.calls[0][0]).not.toContain("force");
  });
});

describe("applyRefusalOf", () => {
  const refused = new ApiError("422", 422, "Unprocessable", "{}", {
    detail: {
      error: "refused",
      status: "refused",
      detail: "the plan would delete a pair the finding does not name",
    },
  });

  it("reads the agent's reason off a refused apply", () => {
    expect(applyRefusalOf(refused)).toBe(
      "the plan would delete a pair the finding does not name",
    );
  });

  it("is null for a request-validation 422, a 409, and a plain error", () => {
    const validation = new ApiError("422", 422, "Unprocessable", "x", {
      detail: [{ loc: ["query", "onBehalfOf"], msg: "field required" }],
    });
    const conflict = new ApiError("409", 409, "Conflict", "x", {});
    expect(applyRefusalOf(validation)).toBeNull();
    expect(applyRefusalOf(conflict)).toBeNull();
    expect(applyRefusalOf(new Error("boom"))).toBeNull();
  });
});
