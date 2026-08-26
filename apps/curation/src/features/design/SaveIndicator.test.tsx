/**
 * @vitest-environment jsdom
 *
 * The save indicator is the only place the app promises a curator that
 * their work is safe, so the wording is the thing under test — not the
 * markup.
 *
 * Every failure state must say WHERE THE WORK IS. A curator who reads
 * "Save failed" and cannot tell whether their afternoon survived will
 * either redo it or abandon it, and both are worse than the failure.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SaveIndicator, formatSavedAt } from "./SaveIndicator";

const body = () => document.body.textContent ?? "";

describe("what it says", () => {
  it("says nothing before the curator has touched anything", () => {
    const { container } = render(<SaveIndicator state={{ kind: "idle" }} />);
    // "Saved" on arrival would claim a write that never happened.
    expect(container).toBeEmptyDOMElement();
  });

  it("stamps the time on a save", () => {
    render(<SaveIndicator state={{ kind: "saved", at: "2026-08-25T19:04:00Z" }} />);
    expect(body()).toMatch(/^Saved \d{1,2}:\d{2}/);
  });

  it("survives a savedAt it cannot parse rather than printing 'Invalid Date'", () => {
    render(<SaveIndicator state={{ kind: "saved", at: "not a date" }} />);
    expect(body()).toBe("Saved");
    expect(body()).not.toMatch(/invalid/i);
  });
});

describe("every failure says where the work is", () => {
  it("offline: kept locally", () => {
    render(<SaveIndicator state={{ kind: "offline", detail: "unreachable" }} />);
    expect(body()).toMatch(/kept locally/i);
  });

  it("failed: kept locally, and offers the retry", async () => {
    const onRetry = vi.fn();
    render(<SaveIndicator state={{ kind: "failed", detail: "boom" }} onRetry={onRetry} />);
    expect(body()).toMatch(/kept locally/i);
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("conflict: says the draft is safe, because today's UI silently discards it", () => {
    render(
      <SaveIndicator
        state={{ kind: "conflict", detail: "baseline moved", draftRetained: true }}
      />,
    );
    expect(body()).toMatch(/your draft is safe/i);
  });

  it("conflict: does NOT claim safety when the server did not say so", () => {
    render(
      <SaveIndicator
        state={{ kind: "conflict", detail: "baseline moved", draftRetained: false }}
      />,
    );
    expect(body()).not.toMatch(/safe/i);
  });

  it("never tells the curator their work is gone", () => {
    for (const state of [
      { kind: "offline", detail: "x" },
      { kind: "failed", detail: "x" },
      { kind: "conflict", detail: "x", draftRetained: true },
    ] as const) {
      const { unmount } = render(<SaveIndicator state={state} />);
      expect(body()).not.toMatch(/lost|discarded|gone/i);
      unmount();
    }
  });
});

describe("formatSavedAt", () => {
  it("renders hours and minutes, and empty for junk", () => {
    expect(formatSavedAt("2026-08-25T19:04:00Z")).toMatch(/\d{1,2}:\d{2}/);
    expect(formatSavedAt("nope")).toBe("");
  });
});
