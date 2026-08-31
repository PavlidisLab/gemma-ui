/**
 * The curation-details write body.
 *
 * Gemma's `CurationDetailsUpdateRequest` is camelCase —
 * `{troubled, needsAttention, curationNote, note}` — read off the live
 * OpenAPI on gemma2 `96e7a5d790`, 2026-08-31. `client.ts` normalizes
 * RESPONSES only, so a snake_case patch went out untouched and the
 * flag toggle reported "save failed".
 */
import { describe, expect, it } from "vitest";
import { __test } from "./curation";

const wire = __test.toCurationDetailsWire;

describe("toCurationDetailsWire", () => {
  it("🛑 sends needsAttention, not needs_attention", () => {
    expect(wire({ needs_attention: true })).toEqual({ needsAttention: true });
  });

  it("sends curationNote, not curation_note", () => {
    expect(wire({ curation_note: "x" })).toEqual({ curationNote: "x" });
  });

  it("keeps `note` and `curationNote` separate — different destinations", () => {
    // `note` titles the ticket a flag-on opens and comments the ticket
    // a flag-off resolves; `curationNote` is the dataset's own note.
    expect(wire({ note: "why", curation_note: "the note" })).toEqual({
      note: "why",
      curationNote: "the note",
    });
  });

  it("omits absent keys so the server leaves those fields alone", () => {
    expect(wire({ troubled: false })).toEqual({ troubled: false });
    expect(Object.keys(wire({ troubled: false }))).toEqual(["troubled"]);
  });

  it("sends an explicit false rather than dropping it", () => {
    // Clearing a flag is `false`, not absence — a falsy-value check
    // here would make the flag impossible to turn off.
    expect(wire({ needs_attention: false })).toEqual({ needsAttention: false });
  });
});
