import { describe, expect, it } from "vitest";
import {
  BULK_ACCEPT_NOTE,
  DERIVED_REASON_NOTE,
  IMPLICIT_REJECT_NOTE,
  withDerivedReasonNote,
} from "./auditPresentation";

// These notes leave the UI. The agents-side gold-apply pass reads them
// back to judge how much weight a disposition carries, so the wording
// is a wire contract — changing it changes how a curator's decision is
// scored. Handoff
// ``CAB_TO_UI_2026_08_10_IMPLICIT_ACCEPT_WORDING_AND_SWALLOWED_ERRORS``.
describe("bulk-resolution disposition notes", () => {
  it("the accept note reads as an act, not a lapse", () => {
    // "accept remaining" is not the dialog's default; picking it is a
    // deliberate choice, and the note has to say so or the gold pass
    // downgrades it and re-asks an answered question.
    expect(BULK_ACCEPT_NOTE).toMatch(/^Bulk accept —/);
    expect(BULK_ACCEPT_NOTE).not.toMatch(/implicit/i);
    expect(BULK_ACCEPT_NOTE).toContain('"accept remaining"');
  });

  it("but still flags that nobody looked at it one by one", () => {
    // The useful signal, and the only thing the old wording got right.
    expect(BULK_ACCEPT_NOTE).toContain("not individually reviewed");
  });

  it("the reject note stays 'implicit' — it IS the default", () => {
    expect(IMPLICIT_REJECT_NOTE).toMatch(/^Implicit reject —/);
  });

  it("the two are distinguishable by prefix alone", () => {
    // The gold pass keys off the leading phrase; identical or
    // prefix-colliding notes would collapse two opposite decisions.
    const acceptPrefix = BULK_ACCEPT_NOTE.split("—")[0].trim();
    const rejectPrefix = IMPLICIT_REJECT_NOTE.split("—")[0].trim();
    expect(acceptPrefix).not.toBe(rejectPrefix);
  });
});

// Third note in the same family, and the same wire contract: it leaves
// the UI and the gold-apply pass reads it. This one marks a REASON SLUG
// as derived rather than picked — the distinction that 72 `well_evidenced`
// rows (23% of curator rows in the store) had no way to express, which
// let a fallback be counted as a verdict (cab, 2026-08-17).
describe("derived-reason provenance note", () => {
  it("says the curator did not pick the reason", () => {
    // The whole point. Anything tallying reason slugs must be able to
    // exclude these without inferring it from an absent note — absence
    // is not a signal, a curator can simply not type one.
    expect(DERIVED_REASON_NOTE).toMatch(/not picked by the curator/i);
  });

  it("is distinguishable from the two bulk notes by prefix", () => {
    const prefixes = [
      BULK_ACCEPT_NOTE,
      IMPLICIT_REJECT_NOTE,
      DERIVED_REASON_NOTE,
    ].map((n) => n.split("—")[0].trim());
    expect(new Set(prefixes).size).toBe(3);
  });

  it("appends to the curator's note instead of replacing it", () => {
    // 🛑 The one-click paths can carry a typed note from the editor.
    // Overwriting it would destroy curator input to record bookkeeping —
    // strictly worse than the problem being fixed.
    const composed = withDerivedReasonNote("paper says adult mice");
    expect(composed).toContain("paper says adult mice");
    expect(composed).toContain(DERIVED_REASON_NOTE);
    expect(composed.indexOf("paper says adult mice")).toBeLessThan(
      composed.indexOf(DERIVED_REASON_NOTE),
    );
  });

  it("stands alone when the curator typed nothing", () => {
    expect(withDerivedReasonNote("")).toBe(DERIVED_REASON_NOTE);
    expect(withDerivedReasonNote(undefined)).toBe(DERIVED_REASON_NOTE);
    expect(withDerivedReasonNote("   ")).toBe(DERIVED_REASON_NOTE);
  });
});
