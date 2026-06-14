import { describe, expect, it } from "vitest";
import {
  factorElementKey,
  tagElementKey,
} from "./proposalDispositions";

/**
 * Regression tests pinning the URI-anchored proposal-element key
 * shape introduced 2026-06-13 (continuity sweep). The prior key
 * format was ``factor:<id>:<idx>`` which let an agent re-run with
 * re-ordered factors silently re-target a different element's
 * localStorage disposition row.
 *
 * Contract:
 *   - keys with category URI present should not depend on list
 *     index — re-ordering factors does not change the key
 *   - keys with no URI fall back to a normalised label so the
 *     curator's dispositions still persist across runs that didn't
 *     resolve a URI
 *   - URIs and labels are case-insensitive on the key axis (server
 *     can re-emit with different casing without re-orphaning the
 *     row)
 *   - tag keys combine (category, value) on each axis (URI or label)
 *     so two tags sharing a category but differing on value get
 *     distinct keys
 */

describe("factorElementKey — URI-anchored stable identity", () => {
  it("keys on category URI when present", () => {
    const k = factorElementKey("p1", {
      category: { uri: "EFO:0000513", label: "genotype" },
    });
    expect(k).toContain("uri:");
    expect(k).toContain("efo:0000513");
  });

  it("falls back to category label when URI is missing", () => {
    const k = factorElementKey("p1", {
      category: { uri: null, label: "treatment" },
    });
    expect(k).toContain("lbl:");
    expect(k).toContain("treatment");
  });

  it("is index-independent — reordering two factors does not change a key", () => {
    const a = { category: { uri: "X:1", label: "x" } };
    const b = { category: { uri: "X:2", label: "y" } };
    const orderAB = [a, b];
    const orderBA = [b, a];
    expect(factorElementKey("p1", orderAB[0])).toBe(
      factorElementKey("p1", orderBA[1]),
    );
    expect(factorElementKey("p1", orderAB[1])).toBe(
      factorElementKey("p1", orderBA[0]),
    );
  });

  it("normalises URI casing", () => {
    const k1 = factorElementKey("p1", { category: { uri: "EFO:000123" } });
    const k2 = factorElementKey("p1", { category: { uri: "efo:000123" } });
    expect(k1).toBe(k2);
  });

  it("normalises label casing + trimming", () => {
    const k1 = factorElementKey("p1", { category: { label: "  Treatment  " } });
    const k2 = factorElementKey("p1", { category: { label: "treatment" } });
    expect(k1).toBe(k2);
  });

  it("handles a missing/null category gracefully (degrades to ?)", () => {
    const k = factorElementKey("p1", { category: null });
    expect(k).toBe("factor:p1:lbl:?");
  });

  it("includes the proposal id in the key so two proposals don't collide", () => {
    const f = { category: { uri: "X:1" } };
    expect(factorElementKey("p1", f)).not.toBe(factorElementKey("p2", f));
  });
});

describe("tagElementKey — URI-anchored stable identity", () => {
  it("keys on (category, value) URI pair when both present", () => {
    const k = tagElementKey("p1", {
      category: { uri: "EFO:0000408", label: "disease" },
      value: { uri: "MONDO:001", label: "AD" },
    });
    expect(k).toContain("uri:");
    expect(k).toContain("efo:0000408");
    expect(k).toContain("mondo:001");
  });

  it("falls back to label pair when either URI is missing", () => {
    const k = tagElementKey("p1", {
      category: { uri: null, label: "disease" },
      value: { uri: "MONDO:001", label: "AD" },
    });
    expect(k).toContain("lbl:");
    expect(k).toContain("disease");
    expect(k).toContain("ad");
  });

  it("distinguishes tags sharing a category but differing on value", () => {
    const a = {
      category: { uri: "EFO:001", label: "disease" },
      value: { uri: "MONDO:1", label: "X" },
    };
    const b = {
      category: { uri: "EFO:001", label: "disease" },
      value: { uri: "MONDO:2", label: "Y" },
    };
    expect(tagElementKey("p1", a)).not.toBe(tagElementKey("p1", b));
  });

  it("is index-independent across reorder", () => {
    const a = {
      category: { uri: "C:1" },
      value: { uri: "V:1" },
    };
    const b = {
      category: { uri: "C:1" },
      value: { uri: "V:2" },
    };
    const orderAB = [a, b];
    const orderBA = [b, a];
    expect(tagElementKey("p1", orderAB[0])).toBe(
      tagElementKey("p1", orderBA[1]),
    );
  });

  it("normalises casing on both axes", () => {
    const k1 = tagElementKey("p1", {
      category: { uri: "C:1" },
      value: { uri: "V:1" },
    });
    const k2 = tagElementKey("p1", {
      category: { uri: "c:1" },
      value: { uri: "v:1" },
    });
    expect(k1).toBe(k2);
  });
});
