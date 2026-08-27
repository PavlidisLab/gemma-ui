import { describe, expect, it } from "vitest";
import { ApiError } from "./client";
import { commitConflictOf } from "./commitConflict";

/** A 409 shaped the way the commit relay sends one. */
const conflict = (body: unknown) =>
  new ApiError(
    "PUT /rest/v2/… failed: 409 Conflict",
    409,
    "Conflict",
    "flattened sentence for display",
    body,
  );

describe("commitConflictOf", () => {
  it("🛑 reads the reason from `body`, not from the flattened `detail`", () => {
    // The whole point: `reason` is a SIBLING of `detail`, never inside
    // it. A regex over `detail` can never find it.
    const c = commitConflictOf(
      conflict({ reason: "STALE_BASELINE", retryableAfterReread: true }),
    );
    expect(c?.reason).toBe("STALE_BASELINE");
  });

  it("marks only STALE_BASELINE as worth retrying after a re-read", () => {
    const reread = (r: string) =>
      commitConflictOf(conflict({ reason: r }))?.retryableAfterReread;
    expect(reread("STALE_BASELINE")).toBe(true);
    expect(reread("REQUIRES_FORCE")).toBe(false);
    expect(reread("LOCK_REQUIRED")).toBe(false);
    expect(reread("PUBLICATION_REJECTED")).toBe(false);
    expect(reread("UNSPECIFIED")).toBe(false);
  });

  it("lets the server overrule the per-reason default", () => {
    // The default for LOCK_REQUIRED is false; a server that says
    // otherwise knows something we don't.
    const c = commitConflictOf(
      conflict({ reason: "LOCK_REQUIRED", retryableAfterReread: true }),
    );
    expect(c?.retryableAfterReread).toBe(true);
  });

  it("never tells the curator to force — REQUIRES_FORCE routes to sign", () => {
    const c = commitConflictOf(conflict({ reason: "REQUIRES_FORCE" }));
    expect(c?.nextMove).toMatch(/sign off/i);
    expect(c?.nextMove).not.toMatch(/force/i);
  });

  it("finds the reason one level down, where the relay nests it", () => {
    const c = commitConflictOf(
      conflict({ detail: { reason: "LOCK_REQUIRED", upstream: "…" } }),
    );
    expect(c?.reason).toBe("LOCK_REQUIRED");
  });

  it("falls back to UNSPECIFIED for a reason it does not know", () => {
    // A new server code must not crash or masquerade as a known one.
    const c = commitConflictOf(conflict({ reason: "SOME_NEW_CODE" }));
    expect(c?.reason).toBe("UNSPECIFIED");
    expect(c?.retryableAfterReread).toBe(false);
  });

  it("shows the server's message verbatim, or the detail when absent", () => {
    expect(
      commitConflictOf(
        conflict({ reason: "LOCK_REQUIRED", message: "held by alice until 14:05" }),
      )?.message,
    ).toBe("held by alice until 14:05");
    expect(commitConflictOf(conflict({ reason: "LOCK_REQUIRED" }))?.message).toBe(
      "flattened sentence for display",
    );
  });

  it("reads Gemma's own shape — error.errors[].reason, two levels down", () => {
    // Verified against gemma2's OpenAPI: WellComposedErrorBody carries
    // `errors: [{reason, message, location, locationType}]`. Handling
    // only the relay's flat shape would return null here, which reads
    // identically to "the server gave no reason".
    const c = commitConflictOf(
      conflict({
        apiVersion: "2.9.4",
        buildInfo: { gitHash: "69c1c11b" },
        error: {
          code: 409,
          message: "Sign-off requires the curation lock and nobody holds it.",
          errors: [{ reason: "LOCK_REQUIRED", message: "no lock held" }],
        },
      }),
    );
    expect(c?.reason).toBe("LOCK_REQUIRED");
    expect(c?.message).toMatch(/nobody holds it/);
    expect(c?.retryableAfterReread).toBe(false);
  });

  it("returns null when there is no structured reason — today's servers", () => {
    // Tolerate-null: nothing renders differently until the relay lands.
    expect(commitConflictOf(conflict({ detail: "plain string" }))).toBeNull();
    expect(commitConflictOf(conflict(undefined))).toBeNull();
  });

  it("returns null for anything that is not a 409", () => {
    const e = new ApiError("failed: 422", 422, "Unprocessable", "d", {
      reason: "STALE_BASELINE",
    });
    expect(commitConflictOf(e)).toBeNull();
    expect(commitConflictOf(new Error("boom"))).toBeNull();
    expect(commitConflictOf(null)).toBeNull();
  });
});
