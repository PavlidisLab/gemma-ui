/**
 * A scratchpad is never closed.
 *
 * 🛑 There are FOUR close affordances — `NextActionBar` and
 * `TicketActionsBar` on the detail page, the dashboard row's Close, and
 * the audit sidebar's offer-to-close. The first pass gated them one at
 * a time and missed the second; Paul found it next to Export within the
 * hour. This is the single gate they all ask, and the test exists so a
 * fifth button has something to fail against.
 */
import { describe, expect, it } from "vitest";

import { canCloseTicket, closeBlockedReason } from "./tickets";

describe("canCloseTicket", () => {
  it("refuses a scratchpad", () => {
    expect(canCloseTicket({ type: "SCRATCHPAD" })).toBe(false);
  });

  it("allows every other type", () => {
    for (const type of [
      "CURATION",
      "QUALITY_REVIEW",
      "BATCH_INFO_NEEDED",
      "REALIGNMENT_NEEDED",
      "PRELOAD",
      "SCREENING",
      "REVIEW",
      "GENERIC",
    ] as const) {
      expect(canCloseTicket({ type })).toBe(true);
    }
  });
});

describe("closeBlockedReason", () => {
  it("says why, in terms of what to do instead", () => {
    // The curator needs the alternative, not just the refusal:
    // finishing with a dataset on a scratchpad means removing it.
    expect(closeBlockedReason({ type: "SCRATCHPAD" })).toMatch(/removing it/i);
  });

  it("🛑 is empty when nothing is blocked", () => {
    // Callers fall back to their own tooltip with `reason || "…"`, so a
    // non-empty string here would replace every ordinary close tooltip
    // with an explanation of a rule that does not apply.
    expect(closeBlockedReason({ type: "CURATION" })).toBe("");
  });
});
