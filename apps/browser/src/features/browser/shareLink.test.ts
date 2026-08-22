import { describe, expect, it } from "vitest";
import {
  decodeSearchSettings,
  encodeSearchSettings,
  isEmptySettings,
} from "./shareLink";
import { emptySearchSettings } from "@/lib/types";
import type { SearchSettings } from "@/lib/types";

const DISEASE = "http://www.ebi.ac.uk/efo/EFO_0000408";
const ALZHEIMER = "http://purl.obolibrary.org/obo/MONDO_0004975";

function settings(patch: Partial<SearchSettings> = {}): SearchSettings {
  return { ...emptySearchSettings(), ...patch };
}

const full = () =>
  settings({
    query: "hippocampus",
    currentQuery: "hippocampus",
    taxon: [{ id: 2 }] as SearchSettings["taxon"],
    platforms: [{ id: 96 }, { id: 570 }] as SearchSettings["platforms"],
    technologyTypes: ["SEQUENCING"],
    annotations: [
      {
        classUri: DISEASE,
        className: "disease",
        termUri: ALZHEIMER,
        termName: "Alzheimer disease",
      },
    ],
    negativeAnnotations: [
      { classUri: null, className: null, termUri: null, termName: "excluded thing" },
    ],
    categories: [{ classUri: "http://www.ebi.ac.uk/efo/EFO_0000651", className: "phenotype" }],
    negativeCategories: [{ classUri: null, className: "some category" }],
    ignoreExcludedTerms: true,
  });

describe("share link round-trip", () => {
  it("restores everything that affects the result set", () => {
    const decoded = decodeSearchSettings(encodeSearchSettings(full()));
    expect(decoded).not.toBeNull();
    const s = { ...emptySearchSettings(), ...decoded! };
    const want = full();
    expect(s.query).toBe(want.query);
    expect(s.currentQuery).toBe(want.query);
    expect(s.taxon.map((t) => t.id)).toEqual([2]);
    expect(s.platforms.map((p) => p.id)).toEqual([96, 570]);
    expect(s.technologyTypes).toEqual(["SEQUENCING"]);
    expect(s.annotations).toEqual(want.annotations);
    expect(s.negativeAnnotations).toEqual(want.negativeAnnotations);
    expect(s.categories).toEqual(want.categories);
    expect(s.negativeCategories).toEqual(want.negativeCategories);
    expect(s.ignoreExcludedTerms).toBe(true);
  });

  it("carries taxa and platforms as ids only", () => {
    // Their labels come back from the live list, so putting them in
    // the URL would only make it longer and let it go stale.
    const b64 = encodeSearchSettings(full()).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
    expect(raw).not.toContain("Mus musculus");
    expect(raw).toContain('"tx":[2]');
  });

  it("survives non-Latin1 characters in a term label", () => {
    // btoa() throws on these; the codec goes through TextEncoder.
    const label = "α-synuclein ± 5 µM – dosed";
    const decoded = decodeSearchSettings(
      encodeSearchSettings(
        settings({
          annotations: [
            { classUri: DISEASE, className: "disease", termUri: null, termName: label },
          ],
        }),
      ),
    );
    expect(decoded?.annotations?.[0].termName).toBe(label);
  });

  it("omits absent sections instead of encoding empty arrays", () => {
    const decoded = decodeSearchSettings(
      encodeSearchSettings(settings({ query: "x" })),
    );
    expect(decoded).toEqual({ query: "x", currentQuery: "x" });
  });

  it("produces a URL-safe payload", () => {
    const enc = encodeSearchSettings(full());
    expect(enc).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(encodeURIComponent(enc)).toBe(enc);
  });
});

describe("share link — bad input lands you somewhere usable", () => {
  it("returns null for a value we did not write", () => {
    for (const bad of ["", "not-base64!!", "Zm9v", btoa("[1,2,3]"), btoa("null")]) {
      expect(decodeSearchSettings(bad)).toBeNull();
    }
  });

  it("drops one malformed entry without discarding the rest of the filter", () => {
    const payload = btoa(
      JSON.stringify({
        an: [
          ["c", "cn", "t", "tn"],
          ["wrong", "arity"],
          [null, null, null, null],
        ],
        tx: [1, "nope", 3],
      }),
    );
    const decoded = decodeSearchSettings(payload);
    // The one good term survives; the short tuple and the term with
    // neither URI nor name are dropped.
    expect(decoded?.annotations).toHaveLength(1);
    expect(decoded?.taxon?.map((t) => t.id)).toEqual([1, 3]);
  });

  it("ignores a section of the wrong type", () => {
    const decoded = decodeSearchSettings(
      btoa(JSON.stringify({ q: 42, tt: "SEQUENCING", an: "nope" })),
    );
    expect(decoded).toEqual({});
  });
});

describe("isEmptySettings", () => {
  it("is true for untouched settings", () => {
    expect(isEmptySettings(settings())).toBe(true);
  });

  it("is false once anything is set", () => {
    expect(isEmptySettings(settings({ query: "x" }))).toBe(false);
    expect(isEmptySettings(settings({ ignoreExcludedTerms: true }))).toBe(false);
    expect(isEmptySettings(settings({ technologyTypes: ["SEQUENCING"] }))).toBe(false);
  });

  it("ignores currentQuery, which is only what's typed so far", () => {
    expect(isEmptySettings(settings({ currentQuery: "half-typed" }))).toBe(true);
  });
});
