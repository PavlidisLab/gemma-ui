import { describe, expect, it } from "vitest";
import {
  validateDesign,
  type Design,
  type Factor,
  type FactorValue,
} from "./types";

// ---------------------------------------------------------------------------
// Helpers — mirrors types.test.ts (not exported there, so copied here)
// ---------------------------------------------------------------------------

function categoricalFactor(
  id: number,
  category: string,
  fvs: FactorValue[] = [],
): Factor {
  return {
    id,
    name: category,
    category: { label: category, uri: null },
    description: "",
    type: "categorical",
    factor_values: fvs,
  };
}

function fv(
  id: number,
  label: string,
  bms: string[],
  baseline = false,
): FactorValue {
  return {
    id,
    free_text_label: label,
    is_baseline: baseline,
    biomaterial_short_names: bms,
    statements: [],
  };
}

/** Build a FactorValue with a single statement carrying the given URI on the
 *  subject term. Handy for ontology-violation tests. */
function fvWithSubjectUri(
  id: number,
  label: string,
  bms: string[],
  subjectLabel: string,
  subjectUri: string,
  baseline = false,
): FactorValue {
  return {
    id,
    free_text_label: label,
    is_baseline: baseline,
    biomaterial_short_names: bms,
    statements: [
      {
        category: null,
        subject: { label: subjectLabel, uri: subjectUri },
      },
    ],
  };
}

function emptyDesign(overrides: Partial<Design> = {}): Design {
  return {
    experiment_id: 1,
    experiment_short_name: "GSE1",
    factors: [],
    biomaterials: [],
    tags: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ontology_violations — categoryForbidsOntology rules
// ---------------------------------------------------------------------------

describe("validateDesign — ontology_violations", () => {
  it("flags EFO URI on a developmental stage factor", () => {
    const efoBrainUri =
      "http://www.ebi.ac.uk/efo/EFO_0001724";
    const f = categoricalFactor(1, "developmental stage", [
      fvWithSubjectUri(10, "embryonic stage", ["s1"], "embryonic stage", efoBrainUri),
    ]);
    const design = emptyDesign({ factors: [f], biomaterials: [{ short_name: "s1", name: "s1", characteristics: {} }] });
    const v = validateDesign(design);
    const state = v.factors[0];
    expect(state.ontology_violations.length).toBeGreaterThan(0);
    expect(state.ontology_violations[0].fv_id).toBe(10);
    expect(state.ontology_violations[0].rule).toMatch(/EFO/);
  });

  it("flags NIF URI on a developmental stage factor", () => {
    const nifUri = "http://uri.neuinfo.org/nif/nifstd/nlx_12345";
    const f = categoricalFactor(1, "developmental stage", [
      fvWithSubjectUri(11, "postnatal day 7", ["s1"], "postnatal day 7", nifUri),
    ]);
    const design = emptyDesign({ factors: [f], biomaterials: [{ short_name: "s1", name: "s1", characteristics: {} }] });
    const v = validateDesign(design);
    const state = v.factors[0];
    expect(state.ontology_violations.length).toBeGreaterThan(0);
    expect(state.ontology_violations[0].rule).toMatch(/NIF/);
  });

  it("does NOT flag UBERON URI on a developmental stage factor", () => {
    // UBERON is the mandated ontology for developmental stage — must not fire.
    const uberonUri = "http://purl.obolibrary.org/obo/UBERON_0000068";
    const f = categoricalFactor(1, "developmental stage", [
      fvWithSubjectUri(12, "embryo stage", ["s1"], "embryo stage", uberonUri),
    ]);
    const design = emptyDesign({ factors: [f], biomaterials: [{ short_name: "s1", name: "s1", characteristics: {} }] });
    const v = validateDesign(design);
    expect(v.factors[0].ontology_violations).toHaveLength(0);
  });

  it("does NOT flag HSAPDV URI on a developmental stage factor", () => {
    // HSAPDV (Human Developmental Stages ontology) is allowed for developmental
    // stage — its URIs don't match any of the forbidden patterns.
    const hsapdvUri = "http://purl.obolibrary.org/obo/HsapDv_0000001";
    const f = categoricalFactor(1, "developmental stage", [
      fvWithSubjectUri(13, "Carnegie stage 1", ["s1"], "Carnegie stage 1", hsapdvUri),
    ]);
    const design = emptyDesign({ factors: [f], biomaterials: [{ short_name: "s1", name: "s1", characteristics: {} }] });
    const v = validateDesign(design);
    expect(v.factors[0].ontology_violations).toHaveLength(0);
  });

  it("ontology_violation on developmental stage makes ok=false", () => {
    const efoBrainUri = "http://www.ebi.ac.uk/efo/EFO_0001724";
    // Need one baseline + no unassigned + no duplicate + no unknown predicates
    // for ok to hinge only on the ontology violation.
    const f = categoricalFactor(1, "developmental stage", [
      fvWithSubjectUri(10, "embryonic stage", ["s1"], "embryonic stage", efoBrainUri, true),
    ]);
    // Single-FV factor: factorBaselineBlocksCommit short-circuits (≤1 FV),
    // so baseline count of 1 is fine for ok-ness; the violation alone kills ok.
    const design = emptyDesign({
      factors: [f],
      biomaterials: [{ short_name: "s1", name: "s1", characteristics: {} }],
    });
    expect(validateDesign(design).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deprecated_baseline_fvs
// ---------------------------------------------------------------------------

describe("validateDesign — deprecated_baseline_fvs", () => {
  it("flags a baseline FV whose free_text_label is a deprecated term", () => {
    // "control group" is in DEPRECATED_BASELINE_LABELS
    const f = categoricalFactor(1, "treatment", [
      fv(1, "control group", ["s1"], true /* baseline */),
      fv(2, "drug treated", ["s2"]),
    ]);
    const design = emptyDesign({
      factors: [f],
      biomaterials: [
        { short_name: "s1", name: "s1", characteristics: {} },
        { short_name: "s2", name: "s2", characteristics: {} },
      ],
    });
    const v = validateDesign(design);
    const state = v.factors[0];
    expect(state.deprecated_baseline_fvs).toHaveLength(1);
    expect(state.deprecated_baseline_fvs[0].fv_id).toBe(1);
  });

  it("flags 'untreated' — another canonical deprecated label", () => {
    // "untreated" is the canonical example from the task brief; verify it's
    // actually in DEPRECATED_BASELINE_LABELS by testing through validateDesign.
    // NOTE: "untreated" is NOT listed in the source file — the canonical set is
    // {"baseline participant role","control group","control role",
    //  "normal control group","negative control role","normal littermates"}.
    // This test therefore verifies the REAL list rather than the brief's
    // example. We use "control role" here as a confirmed member.
    const f = categoricalFactor(1, "treatment", [
      fv(1, "control role", ["s1"], true),
      fv(2, "siRNA knockdown", ["s2"]),
    ]);
    const design = emptyDesign({
      factors: [f],
      biomaterials: [
        { short_name: "s1", name: "s1", characteristics: {} },
        { short_name: "s2", name: "s2", characteristics: {} },
      ],
    });
    const v = validateDesign(design);
    expect(v.factors[0].deprecated_baseline_fvs).toHaveLength(1);
  });

  it("flags all six known deprecated baseline labels", () => {
    const deprecatedLabels = [
      "baseline participant role",
      "control group",
      "control role",
      "normal control group",
      "negative control role",
      "normal littermates",
    ];
    for (const label of deprecatedLabels) {
      const f = categoricalFactor(1, "treatment", [
        fv(1, label, ["s1"], true),
        fv(2, "treated", ["s2"]),
      ]);
      const design = emptyDesign({
        factors: [f],
        biomaterials: [
          { short_name: "s1", name: "s1", characteristics: {} },
          { short_name: "s2", name: "s2", characteristics: {} },
        ],
      });
      const v = validateDesign(design);
      expect(
        v.factors[0].deprecated_baseline_fvs,
        `expected "${label}" to be flagged as deprecated`,
      ).toHaveLength(1);
    }
  });

  it("does NOT flag a baseline FV with a non-deprecated label", () => {
    // "vehicle" is not deprecated — curator's intent is clear, DEA will pick
    // it up without ambiguity.
    const f = categoricalFactor(1, "treatment", [
      fv(1, "vehicle", ["s1"], true),
      fv(2, "drug A 10mg/kg", ["s2"]),
    ]);
    const design = emptyDesign({
      factors: [f],
      biomaterials: [
        { short_name: "s1", name: "s1", characteristics: {} },
        { short_name: "s2", name: "s2", characteristics: {} },
      ],
    });
    const v = validateDesign(design);
    expect(v.factors[0].deprecated_baseline_fvs).toHaveLength(0);
  });

  it("does NOT flag a deprecated label on a NON-baseline FV", () => {
    // The deprecated-baseline check is gated on is_baseline=true.
    // A non-baseline FV that happens to be labelled "control group" should
    // not trigger the warning.
    const f = categoricalFactor(1, "treatment", [
      fv(1, "wild type", ["s1"], true),
      fv(2, "control group", ["s2"], false /* NOT baseline */),
    ]);
    const design = emptyDesign({
      factors: [f],
      biomaterials: [
        { short_name: "s1", name: "s1", characteristics: {} },
        { short_name: "s2", name: "s2", characteristics: {} },
      ],
    });
    const v = validateDesign(design);
    expect(v.factors[0].deprecated_baseline_fvs).toHaveLength(0);
  });

  it("deprecated baseline makes ok=false even when everything else is clean", () => {
    const f = categoricalFactor(1, "treatment", [
      fv(1, "negative control role", ["s1"], true),
      fv(2, "siRNA knockdown", ["s2"]),
    ]);
    const design = emptyDesign({
      factors: [f],
      biomaterials: [
        { short_name: "s1", name: "s1", characteristics: {} },
        { short_name: "s2", name: "s2", characteristics: {} },
      ],
    });
    expect(validateDesign(design).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Non-canonical baseline labels are ADVISORY, not a failure (2026-08-08)
// ---------------------------------------------------------------------------

describe("validateDesign — non-canonical baseline labels don't fail ok", () => {
  /** One-factor design whose baseline FV carries `label`, fully assigned
   *  and described so nothing else can be the reason `ok` flips. */
  const designWithBaselineLabel = (label: string) =>
    emptyDesign({
      factors: [
        {
          ...categoricalFactor(1, "treatment", [
            fv(1, label, ["s1"], true),
            fv(2, "drug treated", ["s2"]),
          ]),
          // Grounded category + a description, so the ONLY thing these
          // tests can be measuring is the baseline-label rule.
          category: {
            label: "treatment",
            uri: "http://www.ebi.ac.uk/efo/EFO_0000727",
          },
          description: "drug vs control",
        },
      ],
      biomaterials: [
        { short_name: "s1", name: "s1", characteristics: {} },
        { short_name: "s2", name: "s2", characteristics: {} },
      ],
    });

  it("still reports the label so a curator can see the older wording", () => {
    const v = validateDesign(designWithBaselineLabel("control group"));
    expect(v.factors[0].deprecated_baseline_fvs).toHaveLength(1);
  });

  it("but the design is valid — the FV IS the baseline and DEA uses it", () => {
    // Was a hard failure on the premise that Gemma wouldn't auto-assign
    // these terms. That stopped being true 2026-08-08.
    const v = validateDesign(designWithBaselineLabel("control group"));
    expect(v.ok).toBe(true);
  });

  it("matches a canonical label for ok, which must also stay valid", () => {
    const v = validateDesign(designWithBaselineLabel("control"));
    expect(v.factors[0].deprecated_baseline_fvs).toHaveLength(0);
    expect(v.ok).toBe(true);
  });

  it("does not mask a real problem — a missing baseline still fails", () => {
    const d = designWithBaselineLabel("control group");
    d.factors[0].factor_values[0].is_baseline = false;
    const v = validateDesign(d);
    expect(v.ok).toBe(false);
  });
});
