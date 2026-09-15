import { describe, expect, it } from "vitest";
import { canCurate } from "./auth";

describe("canCurate", () => {
  it("is true for an administrator or a curator", () => {
    expect(canCurate({ authorities: ["GROUP_ADMIN", "GROUP_USER"] })).toBe(true);
    expect(canCurate({ authorities: ["GROUP_CURATOR", "GROUP_USER"] })).toBe(true);
  });

  it("is false for a plain user, an agent, or nobody signed in", () => {
    expect(canCurate({ authorities: ["GROUP_USER"] })).toBe(false);
    expect(canCurate({ authorities: ["GROUP_AGENT"] })).toBe(false);
    expect(canCurate({ authorities: null })).toBe(false);
    expect(canCurate(null)).toBe(false);
    expect(canCurate(undefined)).toBe(false);
  });
});
