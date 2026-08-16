import { describe, expect, it } from "vitest";

import type { Design } from "@/features/experiment/types";

import {
  applyLabelFix,
  applyTermRebind,
  collectTerms,
  isBareAccessionLabel,
  termKey,
} from "./collectTerms";

function design(overrides: Partial<Design> = {}): Design {
  return {
    tags: [],
    factors: [],
    biomaterials: [],
    name: "",
    title: "",
    description: "",
    experimentId: 1,
    experimentShortName: "GSE0",
    taxon: null,
    publications: [],
    ...overrides,
  } as unknown as Design;
}

const uriOf = (id: string) => `http://purl.obolibrary.org/obo/${id}`;

describe("collectTerms", () => {
  it("collects tag category and value", () => {
    const out = collectTerms(
      design({
        tags: [
          {
            id: 1,
            category: { label: "cell line", uri: uriOf("EFO_0000322") },
            value: { label: "CGR8 cell", uri: uriOf("CLO_0002405") },
          },
        ],
      } as unknown as Partial<Design>),
    );
    expect(out.map((t) => t.label).sort()).toEqual(["CGR8 cell", "cell line"]);
  });

  it("skips a term with no URI — free text is not the index's business", () => {
    const out = collectTerms(
      design({
        tags: [
          {
            id: 1,
            category: { label: "cell line", uri: null },
            value: { label: "some in-house line", uri: null },
          },
        ],
      } as unknown as Partial<Design>),
    );
    expect(out).toHaveLength(0);
  });

  it("skips inferred tags — projections, not curated claims", () => {
    const out = collectTerms(
      design({
        tags: [
          {
            id: 1,
            inferred: true,
            category: { label: "organism part", uri: uriOf("EFO_0000635") },
            value: { label: "liver", uri: uriOf("UBERON_0002107") },
          },
        ],
      } as unknown as Partial<Design>),
    );
    expect(out).toHaveLength(0);
  });

  it("collects subject and object, but NOT the predicate", () => {
    const out = collectTerms(
      design({
        factors: [
          {
            id: 1,
            name: "genotype",
            category: { label: "genotype", uri: uriOf("EFO_0000513") },
            factor_values: [
              {
                id: 9,
                free_text_label: "Dmd mdx",
                statements: [
                  {
                    subject: { label: "Dmd", uri: uriOf("NCBI_1756") },
                    predicate: {
                      label: "has_genotype",
                      uri: uriOf("GENO_0000222"),
                    },
                    object: { label: "mdx", uri: uriOf("TGEMO_00001") },
                  },
                ],
              },
            ],
          },
        ],
      } as unknown as Partial<Design>),
    );
    // `has_genotype` is absent on purpose. Predicates are relations,
    // not classes, so the index can never name one — collecting them
    // produced an "not checked" row per statement on correct data.
    // They're constrained by the generated allow-list instead.
    expect(out.map((t) => t.label).sort()).toEqual(["Dmd", "genotype", "mdx"]);
    expect(out.map((t) => t.label)).not.toContain("has_genotype");
  });

  // The whole point of the feature: `Hek293F` bound to EFO_0022515 is a
  // different verdict from `HEK-293S` bound to the same URI. Deduping on
  // URI would keep one and silently discard the other — which is the
  // one we are looking for.
  it("does NOT collapse two labels sharing one URI", () => {
    const out = collectTerms(
      design({
        tags: [
          {
            id: 1,
            category: { label: "cell line", uri: uriOf("EFO_0000322") },
            value: { label: "Hek293F", uri: uriOf("EFO_0022515") },
          },
          {
            id: 2,
            category: { label: "cell line", uri: uriOf("EFO_0000322") },
            value: { label: "HEK-293S", uri: uriOf("EFO_0022515") },
          },
        ],
      } as unknown as Partial<Design>),
    );
    const labels = out.map((t) => t.label).sort();
    expect(labels).toContain("Hek293F");
    expect(labels).toContain("HEK-293S");
  });

  it("collapses the identical pair repeated across many samples into one check", () => {
    const bms = Array.from({ length: 200 }, (_, i) => ({
      short_name: `GSM${i}`,
      name: "",
      characteristics: { BioSource: "liver" },
      characteristic_uris: {
        BioSource: { value_uri: uriOf("UBERON_0002107") },
      },
    }));
    const out = collectTerms(
      design({ biomaterials: bms } as unknown as Partial<Design>),
    );
    expect(out).toHaveLength(1);
    expect(out[0].origin).toBe("sample_characteristic");
    // Reports the span rather than an arbitrary first-seen sample.
    expect(out[0].where).toContain("200 samples");
  });

  it("ignores a characteristic with a URI but no value label", () => {
    const out = collectTerms(
      design({
        biomaterials: [
          {
            short_name: "GSM1",
            name: "",
            characteristics: {},
            characteristic_uris: {
              BioSource: { value_uri: uriOf("UBERON_0002107") },
            },
          },
        ],
      } as unknown as Partial<Design>),
    );
    expect(out).toHaveLength(0);
  });

  it("ids are the (label, uri) key so verdicts map straight back", () => {
    const out = collectTerms(
      design({
        tags: [
          {
            id: 1,
            category: { label: "cell line", uri: uriOf("EFO_0000322") },
            value: { label: "CGR8 cell", uri: uriOf("CLO_0002405") },
          },
        ],
      } as unknown as Partial<Design>),
    );
    const v = out.find((t) => t.label === "CGR8 cell")!;
    expect(v.id).toBe(termKey("CGR8 cell", uriOf("CLO_0002405")));
  });

  it("returns empty for a null design rather than throwing", () => {
    expect(collectTerms(null)).toEqual([]);
  });
});

describe("applyLabelFix", () => {
  const CLO = uriOf("CLO_0002405");

  function withTag(label: string, uri: string): Design {
    return design({
      tags: [
        {
          id: 7,
          category: { label: "cell line", uri: uriOf("EFO_0000322") },
          value: { label, uri },
        },
      ],
    } as unknown as Partial<Design>);
  }

  it("relabels a tag value and leaves the URI alone", () => {
    const d = withTag("cgr8", CLO);
    const ref = collectTerms(d).find((t) => t.label === "cgr8")!;
    const next = applyLabelFix(d, ref, "CGR8 cell")!;
    expect(next.tags[0].value.label).toBe("CGR8 cell");
    // A relabel, never a rebind — the binding is the authority here.
    expect(next.tags[0].value.uri).toBe(CLO);
  });

  // The verdict described the label as it was at validation time. If
  // the draft moved on, applying is writing on a stale claim — which
  // is the silent-corruption shape this whole feature exists to catch.
  it("refuses when the label changed since the run", () => {
    const d = withTag("cgr8", CLO);
    const ref = collectTerms(d).find((t) => t.label === "cgr8")!;
    const edited = withTag("something else", CLO);
    expect(applyLabelFix(edited, ref, "CGR8 cell")).toBeNull();
  });

  it("refuses when the row was deleted since the run", () => {
    const d = withTag("cgr8", CLO);
    const ref = collectTerms(d).find((t) => t.label === "cgr8")!;
    expect(applyLabelFix(design({ tags: [] }), ref, "CGR8 cell")).toBeNull();
  });

  // Biomaterial characteristics come off the Gemma import and aren't
  // editable here, so they must report without offering a Fix.
  it("gives a sample characteristic no locator, so it cannot be fixed", () => {
    const d = design({
      biomaterials: [
        {
          short_name: "GSM1",
          name: "",
          characteristics: { BioSource: "BRM" },
          characteristic_uris: {
            BioSource: { value_uri: uriOf("CHEBI_50845") },
          },
        },
      ],
    } as unknown as Partial<Design>);
    const ref = collectTerms(d)[0];
    expect(ref.origin).toBe("sample_characteristic");
    expect(ref.locator).toBeUndefined();
    expect(applyLabelFix(d, ref, "doxycycline")).toBeNull();
  });

  it("relabels a factor-value statement slot in place", () => {
    const d = design({
      factors: [
        {
          id: 3,
          name: "treatment",
          category: { label: "treatment", uri: uriOf("EFO_0000727") },
          factor_values: [
            {
              id: 11,
              free_text_label: "dose",
              statements: [
                {
                  subject: { label: "20 mg/kg", uri: uriOf("EFO_0002902") },
                },
              ],
            },
          ],
        },
      ],
    } as unknown as Partial<Design>);
    const ref = collectTerms(d).find((t) => t.label === "20 mg/kg")!;
    const next = applyLabelFix(d, ref, "milligram per kilogram")!;
    expect(next.factors[0].factor_values[0].statements[0].subject.label).toBe(
      "milligram per kilogram",
    );
  });
});

// The one rebind the file permits, and only because `replaced_by` is
// the ontology naming its own successor — following it obeys the
// binding rather than overruling it.
describe("applyTermRebind", () => {
  const DEPRECATED = uriOf("EFO_0000410");
  const SUCCESSOR = uriOf("MONDO_0000001");

  function withTag(label: string, uri: string): Design {
    return design({
      tags: [
        {
          id: 7,
          category: { label: "cell line", uri: uriOf("EFO_0000322") },
          value: { label, uri },
        },
      ],
    } as unknown as Partial<Design>);
  }

  it("moves BOTH the label and the URI", () => {
    const d = withTag("old staging", DEPRECATED);
    const ref = collectTerms(d).find((t) => t.label === "old staging")!;
    const next = applyTermRebind(d, ref, {
      label: "disease",
      uri: SUCCESSOR,
    })!;
    expect(next.tags[0].value.label).toBe("disease");
    expect(next.tags[0].value.uri).toBe(SUCCESSOR);
  });

  it("moves a statement slot's label and URI together", () => {
    const d = design({
      factors: [
        {
          id: 3,
          name: "treatment",
          category: { label: "treatment", uri: uriOf("EFO_0000727") },
          factor_values: [
            {
              id: 11,
              free_text_label: "dose",
              statements: [
                { subject: { label: "old staging", uri: DEPRECATED } },
              ],
            },
          ],
        },
      ],
    } as unknown as Partial<Design>);
    const ref = collectTerms(d).find((t) => t.label === "old staging")!;
    const next = applyTermRebind(d, ref, { label: "disease", uri: SUCCESSOR })!;
    const slot = next.factors[0].factor_values[0].statements[0].subject;
    expect(slot.label).toBe("disease");
    expect(slot.uri).toBe(SUCCESSOR);
  });

  // Shares the staleness guard, because a rebind on a stale verdict is
  // the same silent corruption as a relabel on one — worse, since it
  // moves the binding too.
  it("refuses when the slot moved on since the run", () => {
    const d = withTag("old staging", DEPRECATED);
    const ref = collectTerms(d).find((t) => t.label === "old staging")!;
    const edited = withTag("something else", DEPRECATED);
    expect(
      applyTermRebind(edited, ref, { label: "disease", uri: SUCCESSOR }),
    ).toBeNull();
  });

  // A deprecated term with no declared successor must never be
  // rewritten to a guess.
  it("refuses without a replacement URI or label", () => {
    const d = withTag("old staging", DEPRECATED);
    const ref = collectTerms(d).find((t) => t.label === "old staging")!;
    expect(applyTermRebind(d, ref, { label: "disease", uri: "" })).toBeNull();
    expect(applyTermRebind(d, ref, { label: "", uri: SUCCESSOR })).toBeNull();
  });

  it("cannot touch a sample characteristic — no locator", () => {
    const d = design({
      biomaterials: [
        {
          short_name: "GSM1",
          name: "",
          characteristics: { BioSource: "BRM" },
          characteristic_uris: { BioSource: { value_uri: DEPRECATED } },
        },
      ],
    } as unknown as Partial<Design>);
    const ref = collectTerms(d)[0];
    expect(
      applyTermRebind(d, ref, { label: "disease", uri: SUCCESSOR }),
    ).toBeNull();
  });
});

describe("isBareAccessionLabel", () => {
  // The case Cab flagged: CLO holds the catalogue accession as the
  // primary label while the name everyone says is a synonym. Telling a
  // curator "PC-9 → term is RCB4455 cell" is technically true and
  // unusable — they can't check it, and it reads as a bug.
  it("recognises registry accessions used as labels", () => {
    expect(isBareAccessionLabel("RCB4455 cell")).toBe(true);
    expect(isBareAccessionLabel("RCB1154 cell")).toBe(true);
    expect(isBareAccessionLabel("CVCL_0132")).toBe(true);
    expect(isBareAccessionLabel("ACC 305 cell")).toBe(true);
  });

  // False negatives are the expensive direction: a real name wrongly
  // flagged would put a pointless "(also: …)" on every row.
  it("leaves real names alone", () => {
    expect(isBareAccessionLabel("PC-9")).toBe(false);
    expect(isBareAccessionLabel("melanoma")).toBe(false);
    expect(isBareAccessionLabel("left occipital lobe")).toBe(false);
    expect(isBareAccessionLabel("HEK-293F")).toBe(false);
    expect(isBareAccessionLabel("CGR8 cell")).toBe(false);
  });

  it("handles empty and missing input", () => {
    expect(isBareAccessionLabel("")).toBe(false);
    expect(isBareAccessionLabel(null)).toBe(false);
    expect(isBareAccessionLabel(undefined)).toBe(false);
  });
});
