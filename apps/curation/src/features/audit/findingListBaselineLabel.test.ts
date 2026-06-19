import { describe, expect, it } from "vitest";
import { AUDIT_PANEL_BASELINE_LABEL } from "./findingList";

/**
 * Regression test locking the audit-panel baseline label.
 *
 * Spec (Paul 2026-06-15):
 *   "it should be just 'current' EVERYWHERE in the panel"
 *
 * The audit/findings panel always frames the baseline column as
 * "Current" — the curator's working state — regardless of which
 * source the chip strip's ``baseline`` resolved to (``live`` /
 * ``polished:cyan`` / ``preboard`` / an opaque ``curation_id``).
 * Replacing the constant with a chip-driven dynamic label
 * (``sourceLabel(chip.baseline, curations)``) leaks "LIVE GEMMA" /
 * "Cyan polished" etc. back into the per-card chip-strip locate-label
 * — what Paul reverted.
 *
 * If a future refactor tries to make this dynamic again, this test
 * fails and the spec gets re-read.
 */
describe("AUDIT_PANEL_BASELINE_LABEL — audit panel always frames LEFT as 'Current'", () => {
  it("equals the literal string \"Current\"", () => {
    expect(AUDIT_PANEL_BASELINE_LABEL).toBe("Current");
  });

  it("is not 'Live Gemma' / 'Gemma' / 'live' — the chip-strip source label belongs in the chip strip, not the panel", () => {
    expect(AUDIT_PANEL_BASELINE_LABEL).not.toBe("Live Gemma");
    expect(AUDIT_PANEL_BASELINE_LABEL).not.toBe("Gemma");
    expect(AUDIT_PANEL_BASELINE_LABEL).not.toBe("live");
    expect(AUDIT_PANEL_BASELINE_LABEL).not.toBe("LIVE GEMMA");
  });

  it("is non-empty (the column header would render blank otherwise)", () => {
    expect(AUDIT_PANEL_BASELINE_LABEL.length).toBeGreaterThan(0);
  });
});
