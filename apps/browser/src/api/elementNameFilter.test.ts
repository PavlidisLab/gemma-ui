import { describe, expect, it } from "vitest";
import { elementNameFilter } from "./endpoints";

/**
 * Probe-name search is a PREFIX match, and the server escapes any
 * wildcard supplied — measured on `e6d6d6a055`:
 *
 *   filter=name = 1007_s_at         → 1 row
 *   filter=name like 1007_s_at      → 1 row
 *   filter=name like AFFX-BioB-3_at → 1 row
 *   filter=name like 1007           → 1 row
 *   filter=name like AFFX-BioB      → 3 rows
 *   filter=name like '%1007%'       → 0 rows   ← the wildcard is literal
 *
 * The underscore cases returned 0 earlier the same day: `_` is a
 * single-character SQL wildcard and was escaped without an `escape`
 * clause, which made nearly every Affymetrix probe name unsearchable.
 * This file briefly encoded a client-side workaround that cut names
 * back to their first segment. That is gone — the server fix covers
 * every filtered endpoint — and this note is here so the truncation
 * doesn't get reinvented from a stale memory of the symptom.
 */
describe("elementNameFilter", () => {
  it("prefix-matches the name as typed", () => {
    expect(elementNameFilter("AFFX")).toBe("name like AFFX");
  });

  it("keeps an underscore, which the server now handles", () => {
    expect(elementNameFilter("1007_s_at")).toBe("name like 1007_s_at");
    expect(elementNameFilter("AFFX-BioB-3_at")).toBe("name like AFFX-BioB-3_at");
  });

  it("never emits a wildcard, which the server escapes into a literal", () => {
    for (const q of ["%1007%", "1007%", "%", "100%7"]) {
      expect(elementNameFilter(q)).not.toContain("%");
    }
  });

  it("trims, so a trailing space doesn't become part of the prefix", () => {
    expect(elementNameFilter("  AFFX  ")).toBe("name like AFFX");
  });

  // Measured on gemma2: `name like foo bar` → 400, `name like "foo bar"`
  // → 200. The value used to be emitted bare, so a two-word search was
  // a parse error rather than an empty result.
  it("quotes an interior space instead of emitting a parse error", () => {
    expect(elementNameFilter("foo bar")).toBe('name like "foo bar"');
  });

  it("quotes the other characters the grammar reserves", () => {
    // FilterArg.g4: STRING is ~[()," ], so each of these has to be
    // quoted rather than passed through.
    expect(elementNameFilter("a(b")).toBe('name like "a(b"');
    expect(elementNameFilter("a,b")).toBe('name like "a,b"');
    expect(elementNameFilter('a"b')).toBe('name like "a\\"b"');
  });

  it("leaves a name the grammar accepts unquoted", () => {
    // Hyphens, underscores, dots and apostrophes are all plain CHARs.
    expect(elementNameFilter("AFFX-BioB-3_at")).toBe("name like AFFX-BioB-3_at");
    expect(elementNameFilter("AF'FX")).toBe("name like AF'FX");
  });
});
