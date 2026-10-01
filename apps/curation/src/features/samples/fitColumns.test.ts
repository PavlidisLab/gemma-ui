/**
 * Fitting a column to its own content — the width the curator would
 * otherwise drag for.
 */
import { describe, expect, it } from "vitest";

import {
  CELL_PADDING,
  FIT_MAX,
  FIT_MIN,
  HEADER_CHROME,
  fitColumnWidths,
} from "./fitColumns";

/** One px per character — the arithmetic stays readable. */
const measure = (t: string) => t.length;

describe("fitColumnWidths", () => {
  it("fits the widest value, not the first or the last", () => {
    const w = fitColumnWidths(
      [{ key: "char:tissue", header: "tissue", values: ["a".repeat(200), "b", "c"] }],
      measure,
    );
    expect(w["char:tissue"]).toBe(200 + CELL_PADDING);
  });

  it("never gets narrower than its own header", () => {
    const w = fitColumnWidths(
      [{ key: "char:x", header: "a".repeat(300), values: ["b"] }],
      measure,
    );
    expect(w["char:x"]).toBe(300 + HEADER_CHROME + CELL_PADDING);
  });

  it("adds a cell's furniture to the value, so a dropdown's arrow has room", () => {
    const plain = fitColumnWidths(
      [{ key: "f", header: "h", values: ["a".repeat(100)] }],
      measure,
    );
    const withSelect = fitColumnWidths(
      [{ key: "f", header: "h", values: ["a".repeat(100)], chrome: 40 }],
      measure,
    );
    expect(withSelect["f"] - plain["f"]).toBe(40);
  });

  it("🛑 caps a run-on description rather than pushing every other column off screen", () => {
    const w = fitColumnWidths(
      [{ key: "description", header: "description", values: ["a".repeat(4000)] }],
      measure,
    );
    expect(w["description"]).toBe(FIT_MAX);
  });

  it("keeps an empty column readable", () => {
    const w = fitColumnWidths([{ key: "name", header: "", values: [] }], measure);
    expect(w["name"]).toBe(FIT_MIN);
  });

  it("ignores blanks — an em-dash placeholder is not content", () => {
    const w = fitColumnWidths(
      [{ key: "name", header: "name", values: ["", "a".repeat(100), ""] }],
      measure,
    );
    expect(w["name"]).toBe(100 + CELL_PADDING);
  });

  it("answers for every column it is given, keyed by colKey", () => {
    const w = fitColumnWidths(
      [
        { key: "short_name", header: "short name", values: ["GSM1234567"] },
        { key: "factor:42", header: "treatment", values: ["Adoptive cell transfer"] },
      ],
      measure,
    );
    expect(Object.keys(w).sort()).toEqual(["factor:42", "short_name"]);
  });
});
