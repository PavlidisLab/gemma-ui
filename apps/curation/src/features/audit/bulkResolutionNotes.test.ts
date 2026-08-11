import { describe, expect, it } from "vitest";
import {
  BULK_ACCEPT_NOTE,
  IMPLICIT_REJECT_NOTE,
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
