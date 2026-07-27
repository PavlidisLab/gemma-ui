import { describe, expect, it } from "vitest";
import {
  isSideEmpty,
  rowAgreement,
  sidesAgree,
  type SideValue,
} from "./rowComparison";

const term = (label: string, uri: string | null = null): SideValue => ({
  label,
  uri,
});

/** The "explicit empty" SideValue — a side that was looked up and
 *  found to carry no data. Distinct from ``null`` which means "no
 *  data was sourced for this side". The distinction is load-bearing
 *  for the 2026-05-20 bug where agent_extra tag findings were
 *  rendering as "everyone agrees" because the empty gold side was
 *  being silently filtered out. */
const empty: SideValue = { label: "", uri: null };

describe("isSideEmpty", () => {
  it("null is empty", () => {
    expect(isSideEmpty(null)).toBe(true);
  });
  it("empty SideValue is empty", () => {
    expect(isSideEmpty(empty)).toBe(true);
    expect(isSideEmpty({ label: "", uri: null })).toBe(true);
  });
  it("label-only is non-empty", () => {
    expect(isSideEmpty(term("foo"))).toBe(false);
  });
  it("URI-only is non-empty", () => {
    expect(isSideEmpty(term("", "http://x"))).toBe(false);
  });
});

describe("sidesAgree", () => {
  it("both null → agree", () => {
    expect(sidesAgree(null, null)).toBe(true);
  });

  it("one null, one present → disagree", () => {
    expect(sidesAgree(null, term("foo"))).toBe(false);
    expect(sidesAgree(term("foo"), null)).toBe(false);
  });

  it("both empty-but-present → agree", () => {
    expect(sidesAgree(empty, empty)).toBe(true);
  });

  it("empty + non-empty → disagree (the 2026-05-20 bug)", () => {
    // The case that broke: agent_extra tag finding where gold was
    // looked up and confirmed not to have the proposed tag. Earlier
    // code filtered the empty side out and reported agreement.
    expect(sidesAgree(empty, term("obesity"))).toBe(false);
    expect(sidesAgree(term("obesity"), empty)).toBe(false);
  });

  it("matching labels → agree", () => {
    expect(sidesAgree(term("obesity"), term("obesity"))).toBe(true);
    expect(sidesAgree(term("Obesity"), term("OBESITY"))).toBe(true);
  });

  it("different labels → disagree", () => {
    expect(sidesAgree(term("obesity"), term("cancer"))).toBe(false);
  });

  it("matching URIs → agree (regardless of label drift)", () => {
    // The "Homozygous negative ≠ Homozygous negative" case from the
    // earlier rendering bug — different canonical URIs for what
    // appeared to be the same term. The URI-equality short-circuit
    // covers the inverse: matching URIs win.
    expect(
      sidesAgree(
        term("disease model", "http://efo/EFO_0000408"),
        term("Disease Model", "http://efo/EFO_0000408"),
      ),
    ).toBe(true);
  });

  it("label match wins when URIs differ", () => {
    // Different URIs but matching labels still agree — the labels
    // are what the curator reads on screen. From the editor's
    // ``rowMatches`` flip in commit f68611a.
    expect(
      sidesAgree(
        term("Homozygous negative", "http://obo/TGEMO_00001"),
        term("Homozygous negative", "http://other/X"),
      ),
    ).toBe(true);
  });
});

describe("rowAgreement", () => {
  // The proposal side is always present. Currently / reference are
  // optional. The "everyone agrees" badge in the editor renders only
  // when this function returns true for every row in the card.

  it("proposal-only → trivially agree (no other side to disagree with)", () => {
    expect(rowAgreement(term("X"), null, null)).toBe(true);
  });

  it("proposal + matching currently → agree", () => {
    expect(rowAgreement(term("X"), term("X"), null)).toBe(true);
  });

  it("proposal + matching currently + matching reference → agree", () => {
    expect(rowAgreement(term("X"), term("X"), term("X"))).toBe(true);
  });

  it("agent_extra tag case → disagree (the 2026-05-20 bug)", () => {
    // The exact shape that triggered the bug: agent proposed adding
    // a tag (proposal=non-empty); gold was confirmed to not carry
    // it (currently=explicit empty); no reference data. The pre-fix
    // logic returned true (filtered out the empty side); the
    // post-fix returns false.
    expect(rowAgreement(term("obesity"), empty, null)).toBe(false);
  });

  it("agent_extra + matching gold → agree (tag already in design)", () => {
    expect(rowAgreement(term("obesity"), term("obesity"), null)).toBe(true);
  });

  it("proposal differs from currently → disagree", () => {
    expect(rowAgreement(term("App"), term("APP"), null)).toBe(true);
    expect(rowAgreement(term("App"), term("Rpl22"), null)).toBe(false);
  });

  it("proposal matches currently but reference differs → disagree", () => {
    // Three-way: Curator A has X, Curator B said X, Gemma has Y → real
    // disagreement on the Gemma column.
    expect(rowAgreement(term("X"), term("X"), term("Y"))).toBe(false);
  });

  it("explicit-empty reference with non-empty proposal → disagree", () => {
    // Future-proofing: when Gemma snapshot data ships and confirms
    // Gemma doesn't have what the agent proposed, the same
    // empty-vs-non-empty rule should fire on the reference side.
    expect(rowAgreement(term("X"), term("X"), empty)).toBe(false);
  });

  it("all explicit-empty → agree (nothing on any side)", () => {
    // Degenerate but valid: proposal is also empty. All three say
    // "no entry". Agreement.
    expect(rowAgreement(empty, empty, empty)).toBe(true);
  });
});
