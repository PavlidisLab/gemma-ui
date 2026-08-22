import { describe, expect, it } from "vitest";
import { elementNameFilter } from "./endpoints";

/**
 * The probe-name search is not `name like '%q%'`, and every reason it
 * isn't was measured against the deployed Gemma build on 2026-08-22:
 *
 *   filter=name = 1007_s_at         → 1 row
 *   filter=name like 1007           → 1 row
 *   filter=name like '%1007%'       → 0 rows   (wildcards are escaped)
 *   filter=name like 1007_s_at      → 0 rows   (underscore is escaped)
 *   filter=name like AFFX-BioB-3    → 1 row
 *   filter=name like AFFX-BioB-3_at → 0 rows
 *
 * Both constraints live in Gemma's shared filter machinery, so they
 * apply to every `like` in the API and are not ours to fix. This file
 * exists so a future "surely we can just pass the whole name" doesn't
 * quietly reintroduce a search that returns zero for correct input.
 */
describe("elementNameFilter", () => {
  it("prefix-matches a plain name", () => {
    expect(elementNameFilter("AFFX")).toEqual({
      filter: "name like AFFX",
      prefix: "AFFX",
      truncated: false,
    });
  });

  it("cuts a full Affymetrix name back to its first segment", () => {
    // `name like 1007_s_at` returns nothing on the real server; `1007`
    // finds the probe the visitor typed.
    expect(elementNameFilter("1007_s_at")).toEqual({
      filter: "name like 1007",
      prefix: "1007",
      truncated: true,
    });
  });

  it("flags the truncation so the UI can say what it searched", () => {
    expect(elementNameFilter("AFFX-BioB-3_at").truncated).toBe(true);
    expect(elementNameFilter("AFFX-BioB-3").truncated).toBe(false);
  });

  it("never emits a wildcard, which the server escapes into a literal", () => {
    for (const q of ["%1007%", "1007%", "%", "100%7"]) {
      expect(elementNameFilter(q).filter).not.toContain("%");
    }
  });

  it("strips quotes rather than letting them reach the filter parser", () => {
    expect(elementNameFilter(`AF'FX"`).filter).toBe("name like AFFX");
  });

  it("falls back to an exact match when there is no prefix to search", () => {
    // Leading underscore: everything before the first `_` is empty, so
    // there is no prefix. Exact is the only form that can match.
    expect(elementNameFilter("_at")).toEqual({
      filter: "name = _at",
      prefix: "_at",
      truncated: false,
    });
  });

  it("trims, so a trailing space doesn't become part of the prefix", () => {
    expect(elementNameFilter("  AFFX  ").filter).toBe("name like AFFX");
  });
});
