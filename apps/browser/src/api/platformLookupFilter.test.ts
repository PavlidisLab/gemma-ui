// The platform detail page is /platforms/$shortName, but the param is
// not always a short name: `platformRouteParam` falls back to the
// numeric id when the short name can't sit in a URL segment
// (HG-U133A/B/Plus_2 → /platforms/226), and people type ids by hand.
// Before this, every such URL filtered `shortName = 226` and landed on
// "not found".
import { describe, expect, it } from "vitest";
import { platformLookupFilter } from "./endpoints";
import { platformRouteParam } from "@/lib/platformConstants";

describe("platformLookupFilter", () => {
  it("reads an all-digit param as the platform id", () => {
    expect(platformLookupFilter("226")).toBe("id = 226");
    expect(platformLookupFilter(" 1 ")).toBe("id = 1");
  });

  it("reads anything else as a short name", () => {
    expect(platformLookupFilter("GPL96")).toBe("shortName = GPL96");
    expect(platformLookupFilter("Generic_human")).toBe("shortName = Generic_human");
  });

  it("finds the platform behind every param platformRouteParam emits", () => {
    const slashed = { id: 226, shortName: "HG-U133A/B/Plus_2" };
    expect(platformLookupFilter(platformRouteParam(slashed))).toBe("id = 226");
    const plain = { id: 1, shortName: "GPL96" };
    expect(platformLookupFilter(platformRouteParam(plain))).toBe("shortName = GPL96");
  });
});
