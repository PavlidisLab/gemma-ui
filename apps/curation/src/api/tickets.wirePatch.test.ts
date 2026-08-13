import { describe, expect, it } from "vitest";
import { toWirePatch } from "./tickets";

/**
 * Clearing a triage decision is ``""`` on the wire, not ``null``.
 *
 * Verified against the live store 2026-08-12: PATCHing
 * ``{"triage_disposition": null}`` returns 200, applies the rest of the
 * patch, and leaves the disposition untouched — the handler skips any
 * field that arrives as ``None``. PATCHing ``""`` clears it. Every
 * "click again to undecide" path depends on this translation.
 */
describe("toWirePatch", () => {
  it("sends the empty-string sentinel when clearing", () => {
    expect(toWirePatch({ triage_disposition: null, status: "NOT_DONE" })).toEqual(
      { triage_disposition: "", status: "NOT_DONE" },
    );
  });

  it("passes a real decision through untouched", () => {
    expect(toWirePatch({ triage_disposition: "include", status: "DONE" })).toEqual(
      { triage_disposition: "include", status: "DONE" },
    );
    expect(toWirePatch({ triage_disposition: "exclude", status: "DONE" })).toEqual(
      { triage_disposition: "exclude", status: "DONE" },
    );
  });

  it("leaves the field absent when the caller didn't set it", () => {
    // Absent must stay absent — that IS how "don't touch this field" is
    // expressed, and turning it into "" would clear a decision the
    // caller never meant to touch.
    expect(toWirePatch({ status: "UNDERWAY" })).toEqual({ status: "UNDERWAY" });
    expect("triage_disposition" in toWirePatch({ status: "UNDERWAY" })).toBe(
      false,
    );
  });

  it("does not mutate the caller's object", () => {
    const patch = { triage_disposition: null } as const;
    toWirePatch(patch);
    expect(patch.triage_disposition).toBeNull();
  });
});
