import { describe, expect, it } from "vitest";
import { augmentInferredFromFactors } from "./augmentFactorTags";
import type { Factor, Tag } from "@/features/experiment/types";

/**
 * Tests for the factor→inferred-tag projection. It should:
 *   1. Synth one chip per CATEGORICAL factor, distinct FV labels
 *      comma-joined + sorted.
 *   2. De-duplicate FV labels (a treatment factor with several DMSO
 *      arms must not repeat the "DMSO" chip once per arm).
 *   3. SKIP continuous factors entirely — their per-sample numeric
 *      measurements don't belong in the tag row (design review 2026-07-21).
 *   4. Pass direct tags through untouched.
 */

function factor(overrides: Partial<Factor>): Factor {
  return {
    id: 1,
    name: "f",
    category: { label: "treatment", uri: "http://x/EFO_0000727" },
    type: "categorical",
    factor_values: [],
    ...overrides,
  } as Factor;
}

const fv = (free_text_label: string) =>
  ({ id: 0, free_text_label, biomaterial_short_names: [], statements: [] }) as any;

describe("augmentInferredFromFactors", () => {
  it("de-duplicates repeated FV labels into a single chip value", () => {
    const f = factor({
      factor_values: [fv("DMSO"), fv("DMSO"), fv("DMSO"), fv("TCDD"), fv("TCDD")],
    });
    const out = augmentInferredFromFactors([], [f]);
    expect(out).toHaveLength(1);
    // sorted, unique
    expect(out[0].value.label).toBe("DMSO, TCDD");
    expect(out[0].inferred).toBe(true);
    expect(out[0].inferred_source).toBe("FactorValue");
  });

  it("skips continuous factors entirely (no numeric-measurement chips)", () => {
    const cont = factor({
      category: { label: "expression level", uri: null },
      type: "continuous",
      factor_values: [fv("1.691"), fv("1.973"), fv("2.198"), fv("2.428")],
    });
    const out = augmentInferredFromFactors([], [cont]);
    expect(out).toHaveLength(0);
  });

  it("keeps categorical factors while dropping continuous ones in the same design", () => {
    const cat = factor({ factor_values: [fv("DMSO"), fv("TCDD")] });
    const cont = factor({
      id: 2,
      category: { label: "age", uri: null },
      type: "continuous",
      factor_values: [fv("3.4"), fv("5.1")],
    });
    const out = augmentInferredFromFactors([], [cat, cont]);
    expect(out).toHaveLength(1);
    expect(out[0].category.label).toBe("treatment");
  });

  it("passes direct tags through untouched", () => {
    const direct: Tag = {
      id: 9,
      category: { label: "genotype", uri: null },
      value: { label: "Trp53", uri: null },
    };
    const out = augmentInferredFromFactors([direct], []);
    expect(out).toEqual([direct]);
  });
});

describe("augmentInferredFromFactors — a statement's own category", () => {
  // GSE9012 (experiment 14475), verbatim: a `genotype` factor whose
  // two FVs each carry a second statement categorised `organism part`.
  // Those are the only organism-part facts in the design — no EE tag
  // and no sample characteristic carries one — so before this the
  // overview showed no anatomy at all while Gemma's own annotations
  // endpoint (and therefore the public browser) showed the carcinoma.
  const stmtFv = (
    id: number,
    free_text_label: string,
    statements: unknown[],
  ) =>
    ({ id, free_text_label, is_baseline: false, biomaterial_short_names: [], statements }) as never;

  const gse9012 = (): Factor[] => [
    factor({
      id: 1,
      name: "genotype",
      category: { label: "genotype", uri: "http://www.ebi.ac.uk/efo/EFO_0000513" },
      factor_values: [
        stmtFv(1, "Trim24 KO", [
          { category: { label: "genotype", uri: null }, subject: { label: "Trim24", uri: null } },
          {
            category: { label: "organism part", uri: "http://www.ebi.ac.uk/efo/EFO_0000635" },
            subject: { label: "hepatocellular carcinoma", uri: null },
          },
        ]),
        stmtFv(2, "wild type", [
          { category: { label: "genotype", uri: null }, subject: { label: "wild type genotype", uri: null } },
          {
            category: { label: "organism part", uri: "http://www.ebi.ac.uk/efo/EFO_0000635" },
            subject: { label: "liver", uri: null },
          },
        ]),
      ],
    }),
  ];

  it("surfaces organism part from a genotype factor's statements", () => {
    const out = augmentInferredFromFactors([], gse9012());
    const organ = out.find((t) => t.category?.label === "organism part");
    expect(organ).toBeDefined();
    expect(organ!.value?.label).toBe("hepatocellular carcinoma, liver");
    expect(organ!.inferred).toBe(true);
    expect(organ!.inferred_source).toBe("Statement");
  });

  it("carries the statement category's own URI, not the factor's", () => {
    const out = augmentInferredFromFactors([], gse9012());
    const organ = out.find((t) => t.category?.label === "organism part");
    expect(organ!.category?.uri).toBe("http://www.ebi.ac.uk/efo/EFO_0000635");
  });

  it("still emits the factor's own chip, unchanged", () => {
    // Additive: the existing projection is not replaced.
    const out = augmentInferredFromFactors([], gse9012());
    const geno = out.find((t) => t.category?.label === "genotype");
    expect(geno!.value?.label).toBe("Trim24 KO, wild type");
    expect(geno!.inferred_source).toBe("FactorValue");
  });

  it("does not repeat a statement that shares its factor's category", () => {
    // Only divergent categories get their own chip; the rest are
    // already covered by the factor projection.
    const out = augmentInferredFromFactors([], gse9012());
    expect(out.filter((t) => t.category?.label === "genotype")).toHaveLength(1);
  });

  it("merges one category across several factors into a single chip", () => {
    const factors = [
      ...gse9012(),
      factor({
        id: 2,
        name: "treatment",
        category: { label: "treatment", uri: null },
        factor_values: [
          stmtFv(3, "dosed", [
            { category: { label: "organism part", uri: null }, subject: { label: "liver", uri: null } },
          ]),
        ],
      }),
    ];
    const organ = augmentInferredFromFactors([], factors).filter(
      (t) => t.category?.label === "organism part",
    );
    expect(organ).toHaveLength(1);
    // "liver" appears in both factors and is listed once.
    expect(organ[0].value?.label).toBe("hepatocellular carcinoma, liver");
  });

  it("ignores statements with no category or no subject", () => {
    const factors = [
      factor({
        id: 1,
        name: "genotype",
        category: { label: "genotype", uri: null },
        factor_values: [
          stmtFv(1, "x", [
            { subject: { label: "no category", uri: null } },
            { category: { label: "organism part", uri: null }, subject: { label: "  ", uri: null } },
          ]),
        ],
      }),
    ];
    expect(
      augmentInferredFromFactors([], factors).some(
        (t) => t.category?.label === "organism part",
      ),
    ).toBe(false);
  });
});

/**
 * A qualified FV statement renders IN FULL, not as its leading term.
 * GSE276387 (eid 40317) is the case: a `disease` factor whose three
 * arms are all led by `lung adenocarcinoma` and differ only in their
 * `has modifier` object. Showing the subject alone renders all three
 * arms as the same word.
 */
describe("augmentInferredFromFactors — full statements", () => {
  const stmt = (
    subject: string,
    predicate?: string,
    object?: string,
    category = "disease",
  ) =>
    ({
      category: { label: category, uri: null },
      subject: { label: subject, uri: "http://purl.obolibrary.org/obo/MONDO_0005061" },
      predicate: predicate ? { label: predicate, uri: null } : null,
      object: object ? { label: object, uri: null } : null,
      supporting_evidence: [],
    }) as any;

  const fvWith = (free_text_label: string, statements: unknown[]) =>
    ({ id: 0, free_text_label, biomaterial_short_names: [], statements }) as any;

  it("shows a qualified statement in full, not just the subject", () => {
    const f = factor({
      category: { label: "disease", uri: "http://www.ebi.ac.uk/efo/EFO_0000408" },
      factor_values: [
        fvWith("lung adenocarcinoma with organoid", [
          stmt("lung adenocarcinoma", "has modifier", "organoid"),
        ]),
        fvWith("lung adenocarcinoma", [stmt("lung adenocarcinoma")]),
      ],
    });
    const out = augmentInferredFromFactors([], [f]);
    expect(out).toHaveLength(1);
    const values = out[0].value.label.split(", ");
    expect(values).toContain("lung adenocarcinoma has modifier organoid");
    // The unqualified arm keeps the curator's own free text.
    expect(values).toContain("lung adenocarcinoma");
  });

  it("never emits a comma inside a statement (the renderer splits on it)", () => {
    const f = factor({
      factor_values: [
        fvWith("treated", [stmt("dexamethasone", "has dose", "10 nM", "treatment")]),
      ],
    });
    const out = augmentInferredFromFactors([], [f]);
    expect(out[0].value.label).toBe("dexamethasone has dose 10 nM");
  });

  it("carries predicate + object on a cross-category statement too", () => {
    const f = factor({
      category: { label: "genotype", uri: null },
      factor_values: [
        fvWith("mutant", [
          stmt("genotype-only", undefined, undefined, "genotype"),
          stmt("hepatocellular carcinoma", "has modifier", "metastatic", "organism part"),
        ]),
      ],
    });
    const out = augmentInferredFromFactors([], [f]);
    const organismPart = out.find((t) => t.category.label === "organism part");
    expect(organismPart?.value.label).toBe(
      "hepatocellular carcinoma has modifier metastatic",
    );
  });
});
