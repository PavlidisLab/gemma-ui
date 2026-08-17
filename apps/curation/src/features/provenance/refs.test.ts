import { describe, expect, it } from "vitest";

import type { Design, Factor, Tag } from "@/features/experiment/types";

import { factorRef, factorRefId, provenanceRefs, tagRef, tagRefId } from "./refs";

const factor = (over: Partial<Factor> = {}): Factor =>
  ({
    id: 3,
    name: "strain",
    category: { label: "strain", uri: "http://www.ebi.ac.uk/efo/EFO_0005135" },
    description: "",
    type: "categorical",
    factor_values: [],
    ...over,
  }) as Factor;

const tag = (over: Partial<Tag> = {}): Tag =>
  ({
    id: 7,
    category: { label: "disease", uri: "http://www.ebi.ac.uk/efo/EFO_0000408" },
    value: { label: "melanoma", uri: "http://purl.obolibrary.org/obo/MONDO_0005105" },
    ...over,
  }) as Tag;

describe("provenance refs", () => {
  // 🛑 The whole point of the ref: identity travels with it, so the
  // server can match on the strongest key it recognises. A ref that
  // shipped only the slug would be keyed on a mutable string.
  it("carries every factor identity we hold", () => {
    const r = factorRef(factor({ gemma_factor_id: 13531 }));
    expect(r.gemma_factor_id).toBe(13531);
    expect(r.local_factor_id).toBeNull();
    expect(r.category_uri).toContain("EFO_0005135");
    expect(r.kind).toBe("factor");
  });

  it("nulls the identities a factor doesn't carry rather than omitting them", () => {
    const r = factorRef(factor());
    expect(r.gemma_factor_id).toBeNull();
    expect(r.local_factor_id).toBeNull();
  });

  // A tag's identity IS its (category, value) URI pair — cab's call,
  // and the reason tags don't need the factor-id treatment.
  it("carries the tag's category + value URIs", () => {
    const r = tagRef(tag());
    expect(r.category_uri).toContain("EFO_0000408");
    expect(r.value_uri).toContain("MONDO_0005105");
    expect(r.kind).toBe("tag");
  });

  // The handle is what the dot and the panel agree on; if these two
  // ever disagree the trace lands on nothing and the disc never shows.
  it("the ref_id a dot computes matches the one the panel sent", () => {
    expect(factorRef(factor()).ref_id).toBe(factorRefId(3));
    expect(tagRef(tag()).ref_id).toBe(tagRefId(7));
  });

  it("covers every factor and tag on the design", () => {
    const design = {
      experiment_id: 1,
      experiment_short_name: "GSE1",
      factors: [factor(), factor({ id: 4 })],
      biomaterials: [],
      tags: [tag(), tag({ id: 8 })],
    } as Design;
    expect(provenanceRefs(design).map((r) => r.ref_id)).toEqual([
      "factor:3",
      "factor:4",
      "tag:7",
      "tag:8",
    ]);
  });

  // An inferred tag is the one class a curator cannot edit, so the
  // trace is the only way to see where it came from — it must not be
  // filtered out.
  it("includes inferred tags", () => {
    const design = {
      experiment_id: 1,
      experiment_short_name: "GSE1",
      factors: [],
      biomaterials: [],
      tags: [tag({ id: 9, inferred: true })],
    } as Design;
    expect(provenanceRefs(design)).toHaveLength(1);
  });

  it("is empty for no design", () => {
    expect(provenanceRefs(null)).toEqual([]);
  });
});
