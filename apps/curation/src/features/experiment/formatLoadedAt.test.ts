/**
 * The load date must carry its year when it is not this year.
 *
 * `2009-08-29T20:13:35.000+00:00` rendered as "loaded Aug 29, 01:13 PM"
 * on 2026-08-30 — a seventeen-year-old load reading as YESTERDAY, with
 * the year reachable only by hovering. Paul: "this makes it seem
 * recent, but it's not until you see the tooltip."
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { formatLoadedAt } from "./ExperimentBanner";

afterEach(() => vi.useRealTimers());

describe("formatLoadedAt", () => {
  it("🛑 shows the year on an old load, even one whose month and day look current", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T12:00:00Z"));
    const out = formatLoadedAt("2009-08-29T20:13:35.000+00:00");
    expect(out).toMatch(/2009/);
  });

  it("stays short for a load in the current year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T12:00:00Z"));
    const out = formatLoadedAt("2026-01-15T09:00:00.000+00:00");
    expect(out).not.toMatch(/2026/);
    expect(out).toMatch(/Jan/);
  });

  it("passes an unparseable value through rather than inventing a date", () => {
    expect(formatLoadedAt("not a date")).toBe("not a date");
    expect(formatLoadedAt("")).toBe("");
  });
});
