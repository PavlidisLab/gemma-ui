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

  it("unmarking it changes nothing — Gemma reads the term either way", () => {
    // The flag is not what makes this the baseline. Gemma's
    // ``isBaselineCondition`` matches the FV's own value against
    // ``controlGroupTerms``, "control group" among them, so DEA lands
    // on it whether or not a curator ticked the box. Asking for the
    // tick is asking for work with no downstream effect.
    const d = designWithBaselineLabel("control group");
    d.factors[0].factor_values[0].is_baseline = false;
    const v = validateDesign(d);
    expect(v.factors[0].gemma_auto_baseline).toHaveLength(1);
    expect(v.factors[0].baseline_satisfied).toBe(true);
    expect(v.ok).toBe(true);
  });

  it("does not mask a real problem — a factor with NO reference still fails", () => {
    // Neither FV says control, neither is marked: Gemma would fall
    // through to its arbitrary pick, which is the case the warning
    // exists for.
    const d = designWithBaselineLabel("high dose");
    d.factors[0].factor_values[0].is_baseline = false;
    const v = validateDesign(d);
    expect(v.factors[0].gemma_auto_baseline).toHaveLength(0);
    expect(v.factors[0].baseline_satisfied).toBe(false);
    expect(v.ok).toBe(false);
  });
});

// Parity with Gemma's detector — backend commit be7b55b8fe, handoff
// CAB_BASELINE_DETECTION_2026_08_08.md.
describe("validateDesign — non-canonical labels match the way Gemma matches", () => {
  const withLabel = (label: string) =>
    emptyDesign({
      factors: [
        {
          ...categoricalFactor(1, "treatment", [
            fv(1, label, ["s1"], true),
            fv(2, "drug treated", ["s2"]),
          ]),
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

  it("matches the singular 'normal littermate' Gemma also carries", () => {
    expect(
      validateDesign(withLabel("normal littermate")).factors[0]
        .deprecated_baseline_fvs,
    ).toHaveLength(1);
  });

  it("reads underscores as spaces, as Gemma does", () => {
    expect(
      validateDesign(withLabel("Normal_Control_Group")).factors[0]
        .deprecated_baseline_fvs,
    ).toHaveLength(1);
  });

  it("still doesn't match a real value that merely looks similar", () => {
    expect(
      validateDesign(withLabel("normal diet")).factors[0]
        .deprecated_baseline_fvs,
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Gemma already knows the baseline — stop asking the curator to pick one
// ---------------------------------------------------------------------------
// ``BaselineSelection.getBaselineLevels`` takes an explicitly-marked FV
// first, then the first FV whose statements carry a term or URI it
// recognises, and only picks arbitrarily when neither exists. So a sex
// factor holding "female", or a treatment factor holding "reference
// substance role", has its reference level decided — marking one
// changes nothing downstream.
describe("validateDesign — a baseline Gemma detects needs no marking", () => {
  /** Two-FV factor, fully assigned + described, nothing marked. */
  const factorWith = (
    category: string,
    fvs: FactorValue[],
    categoryUri: string,
  ): Design =>
    emptyDesign({
      factors: [
        {
          ...categoricalFactor(1, category, fvs),
          category: { label: category, uri: categoryUri },
          description: `${category} contrast`,
        },
      ],
      biomaterials: [
        { short_name: "s1", name: "s1", characteristics: {} },
        { short_name: "s2", name: "s2", characteristics: {} },
      ],
    });

  const SEX_URI = "http://purl.obolibrary.org/obo/PATO_0000047";
  const TREATMENT_URI = "http://www.ebi.ac.uk/efo/EFO_0000727";

  it("a sex factor with female is satisfied — female IS Gemma's reference", () => {
    const d = factorWith(
      "biological sex",
      [
        fvWithSubjectUri(1, "female", ["s1"], "female",
          "http://purl.obolibrary.org/obo/PATO_0000383"),
        fvWithSubjectUri(2, "male", ["s2"], "male",
          "http://purl.obolibrary.org/obo/PATO_0000384"),
      ],
      SEX_URI,
    );
    const v = validateDesign(d);
    // Nothing marked, and nothing to mark: PATO_0000383 is in Gemma's
    // ``controlGroupUris``. (``ok`` isn't asserted here — the helper
    // builds statements with no category, which fails a different rule.)
    expect(v.factors[0].baseline_count).toBe(0);
    expect(v.factors[0].baseline_satisfied).toBe(true);
    expect(v.factors[0].gemma_auto_baseline[0].matched).toBe("female");
  });

  it("matches female by free text too — the label is in Gemma's term set", () => {
    const d = factorWith(
      "biological sex",
      [fv(1, "female", ["s1"]), fv(2, "male", ["s2"])],
      SEX_URI,
    );
    const v = validateDesign(d);
    expect(v.factors[0].baseline_satisfied).toBe(true);
    // …and the design commits with no baseline marked at all.
    expect(v.ok).toBe(true);
  });

  it("a reference-substance-role control is satisfied unmarked", () => {
    const d = factorWith(
      "treatment",
      [
        fvWithSubjectUri(1, "DMSO", ["s1"], "reference substance role",
          "http://purl.obolibrary.org/obo/OBI_0000025"),
        fv(2, "compound X", ["s2"]),
      ],
      TREATMENT_URI,
    );
    expect(validateDesign(d).factors[0].baseline_satisfied).toBe(true);
  });

  it("flags a marked 'male' on a factor where female is the standard", () => {
    // The explicit flag outranks the term (``getIsBaseline()`` decides
    // first), so this silently makes male the reference. Advisory, not
    // a failure — forcing a baseline is legitimate, it just has to be
    // deliberate.
    const d = factorWith(
      "biological sex",
      [fv(1, "female", ["s1"]), fv(2, "male", ["s2"], true)],
      SEX_URI,
    );
    const v = validateDesign(d);
    expect(v.factors[0].nonstandard_marked_baseline).toEqual({
      fv_id: 2,
      label: "male",
      standard: "female",
    });
    expect(v.ok).toBe(true);
  });

  it("says nothing when the marked FV IS the standard one", () => {
    const d = factorWith(
      "biological sex",
      [fv(1, "female", ["s1"], true), fv(2, "male", ["s2"])],
      SEX_URI,
    );
    expect(validateDesign(d).factors[0].nonstandard_marked_baseline).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// overfull_statement_groups — more pairs than Gemma's two slots hold
// ---------------------------------------------------------------------------

describe("validateDesign — overfull_statement_groups", () => {
  /** One FV whose single subject carries N (predicate, object) pairs,
   *  spelled the way the UI stores them: flat rows sharing
   *  (category, subject). */
  /** Pairs of ONE Gemma statement unless a per-pair id says otherwise.
   *  A two-pair statement arrives as two rows sharing one `gemma_id`,
   *  so the id — not the subject — is what groups them. */
  const fvWithPairs = (
    id: number,
    subject: string,
    pairs: Array<[string, string] | [string, string, number]>,
    stmtId = 900 + id,
  ): FactorValue => ({
    id,
    free_text_label: subject,
    is_baseline: false,
    biomaterial_short_names: ["s1"],
    statements: pairs.map(([p, o, own]) => ({
      gemma_id: typeof own === "number" ? own : stmtId,
      category: { label: "treatment", uri: "http://x/EFO_1" },
      subject: { label: subject, uri: "http://x/CHEBI_1" },
      predicate: { label: p, uri: null },
      object: { label: o, uri: null },
    })),
  });

  const designWith = (fvs: FactorValue[]): Design =>
    emptyDesign({
      factors: [categoricalFactor(1, "treatment", fvs)],
      biomaterials: [{ short_name: "s1", name: "s1", characteristics: {} }],
    });

  it("says nothing at one or two pairs", () => {
    for (const n of [1, 2]) {
      const pairs: [string, string][] = Array.from({ length: n }, (_, i) => [
        `p${i}`,
        `o${i}`,
      ]);
      const state = validateDesign(designWith([fvWithPairs(1, "vpa", pairs)]));
      expect(state.factors[0].overfull_statement_groups).toEqual([]);
    }
  });

  it("flags a third pair on ONE statement — the write Gemma truncates", () => {
    // Real shape, experiment 24995: valproic acid carrying delivered
    // to / delivered at dose / delivered for duration, all on one
    // statement. Gemma holds two pairs and drops the third silently.
    const state = validateDesign(
      designWith([
        fvWithPairs(7, "valproic acid", [
          ["delivered to", "mother"],
          ["delivered at dose", "20 g/kg"],
          ["delivered for duration", "2 week"],
        ]),
      ]),
    );
    expect(state.factors[0].overfull_statement_groups).toEqual([
      { fv_id: 7, subject: "valproic acid", pairs: 3 },
    ]);
  });

  it("🛑 says nothing when one subject's pairs are spread over TWO statements", () => {
    // The shape a background on a compound genotype needs, and the one
    // the old per-subject count flagged: nothing is dropped, because a
    // FactorValue holds a Set<Statement> and two statements on one
    // subject both persist (gembro, 2026-08-29). Confirmed on the wire:
    // a two-pair statement arrives as two rows sharing one id, so
    // different ids are genuinely different statements.
    const state = validateDesign(
      designWith([
        fvWithPairs(7, "Bmal1 knockout", [
          ["has_genotype", "homozygous negative", 100],
          ["targeted to", "astrocyte", 100],
          ["has background", "C57BL/6", 101],
        ]),
      ]),
    );
    expect(state.factors[0].overfull_statement_groups).toEqual([]);
  });

  it("a curator's uncommitted pairs are each their own statement", () => {
    // No `gemma_id` yet — the commit sends one item per pair and each
    // becomes its own statement, so an uncommitted row cannot be over
    // a ceiling that applies to a statement it does not share.
    const fv = fvWithPairs(7, "vpa", [
      ["delivered to", "mother"],
      ["delivered at dose", "20 g/kg"],
      ["delivered for duration", "2 week"],
    ]);
    const fresh = {
      ...fv,
      statements: fv.statements.map((s) => ({ ...s, gemma_id: null })),
    };
    const state = validateDesign(designWith([fresh]));
    expect(state.factors[0].overfull_statement_groups).toEqual([]);
  });

  it("counts per statement, not per factor value", () => {
    // Two statements with two pairs each is fine — the ceiling is on
    // one statement, not on how many an FV carries.
    const state = validateDesign(
      designWith([
        {
          id: 3,
          free_text_label: "combo",
          is_baseline: false,
          biomaterial_short_names: ["s1"],
          statements: [
            ...fvWithPairs(
              3,
              "drug a",
              [
                ["delivered at dose", "1"],
                ["delivered for duration", "2 d"],
              ],
              810,
            ).statements,
            ...fvWithPairs(
              3,
              "drug b",
              [
                ["delivered at dose", "3"],
                ["delivered for duration", "4 d"],
              ],
              811,
            ).statements,
          ],
        },
      ]),
    );
    expect(state.factors[0].overfull_statement_groups).toEqual([]);
  });

  it("ignores placeholder rows with no predicate and no object", () => {
    // The row "+ pred/obj" adds before the curator fills it in must not
    // trip the flag mid-edit.
    const base = fvWithPairs(4, "vpa", [
      ["delivered to", "mother"],
      ["delivered at dose", "20 g/kg"],
    ]);
    const withBlank: FactorValue = {
      ...base,
      statements: [
        ...base.statements,
        {
          category: { label: "treatment", uri: "http://x/EFO_1" },
          subject: { label: "vpa", uri: "http://x/CHEBI_1" },
          predicate: null,
          object: null,
        },
      ],
    };
    const state = validateDesign(designWith([withBlank]));
    expect(state.factors[0].overfull_statement_groups).toEqual([]);
  });

  it("is reported, and the design does not read as valid while it stands", () => {
    // It is part of `ok` (2026-08-20) but NOT a commit blocker — only a
    // free-text category and an unknown predicate stop the commit bar.
    // A curator sees a design that is not valid and can still commit.
    const clean = designWith([
      {
        ...fvWithPairs(1, "vpa", [
          ["delivered to", "mother"],
          ["delivered at dose", "20 g/kg"],
        ]),
        is_baseline: true,
      },
    ]);
    clean.factors[0].description = "treatment arm";
    const okState = validateDesign(clean);

    const over = designWith([
      {
        ...fvWithPairs(1, "vpa", [
          ["delivered to", "mother"],
          ["delivered at dose", "20 g/kg"],
          ["delivered for duration", "2 week"],
        ]),
        is_baseline: true,
      },
    ]);
    over.factors[0].description = "treatment arm";
    const overState = validateDesign(over);

    expect(overState.factors[0].overfull_statement_groups).toHaveLength(1);
    expect(overState.ok).toBe(okState.ok);
  });
});

// ---------------------------------------------------------------------------
// empty_factor_values — a level nothing is assigned to
//
// The inverse of unassigned_biomaterials, and NOT covered by it: a
// factor can account for every sample and still carry a level holding
// none. Advisory (Paul, 2026-08-20) — an empty level is the normal
// shape of a value the curator just added.
// ---------------------------------------------------------------------------

describe("validateDesign — empty_factor_values", () => {
  const twoSamples = [
    { short_name: "s1", name: "s1", characteristics: {} },
    { short_name: "s2", name: "s2", characteristics: {} },
  ];

  it("says nothing when every value holds samples", () => {
    const design = emptyDesign({
      factors: [
        categoricalFactor(1, "treatment", [
          fv(1, "control", ["s1"], true),
          fv(2, "drug", ["s2"]),
        ]),
      ],
      biomaterials: twoSamples,
    });
    expect(validateDesign(design).factors[0].empty_factor_values).toEqual([]);
  });

  it("flags a value with no samples even when every sample IS assigned", () => {
    // Both samples accounted for across control + drug, so
    // ``unassigned_biomaterials`` is clean — the leftover third level
    // is invisible to it.
    const design = emptyDesign({
      factors: [
        categoricalFactor(1, "treatment", [
          fv(1, "control", ["s1"], true),
          fv(2, "drug", ["s2"]),
          fv(3, "vehicle", []),
        ]),
      ],
      biomaterials: twoSamples,
    });
    const state = validateDesign(design).factors[0];
    expect(state.unassigned_biomaterials).toEqual([]);
    expect(state.empty_factor_values).toEqual([
      { fv_id: 3, label: "vehicle" },
    ]);
  });

  it("names an unlabelled value by its single statement's subject", () => {
    // Matches how the FV card titles itself, so the note names what the
    // curator sees rather than a bare id.
    const design = emptyDesign({
      factors: [
        categoricalFactor(1, "treatment", [
          fv(1, "control", ["s1", "s2"], true),
          fvWithSubjectUri(9, "", [], "valproic acid", "http://x/CHEBI_1"),
        ]),
      ],
      biomaterials: twoSamples,
    });
    expect(validateDesign(design).factors[0].empty_factor_values).toEqual([
      { fv_id: 9, label: "valproic acid" },
    ]);
  });

  it("falls back to the id when there is no label and no subject", () => {
    const design = emptyDesign({
      factors: [
        categoricalFactor(1, "treatment", [
          fv(1, "control", ["s1", "s2"], true),
          fv(4, "", []),
        ]),
      ],
      biomaterials: twoSamples,
    });
    expect(validateDesign(design).factors[0].empty_factor_values).toEqual([
      { fv_id: 4, label: "FV 4" },
    ]);
  });

  it("is advisory — an empty level does not fail ok", () => {
    const build = (fvs: FactorValue[]): Design => {
      const d = emptyDesign({
        factors: [categoricalFactor(1, "treatment", fvs)],
        biomaterials: twoSamples,
      });
      // Ground the category + describe the factor so the baseline
      // design really is valid — otherwise both sides are ok=false for
      // unrelated reasons and the comparison proves nothing.
      d.factors[0].category = {
        label: "treatment",
        uri: "http://www.ebi.ac.uk/efo/EFO_0000727",
      };
      d.factors[0].description = "treatment arm";
      return d;
    };
    const clean = validateDesign(
      build([fv(1, "control", ["s1"], true), fv(2, "drug", ["s2"])]),
    );
    const withEmpty = validateDesign(
      build([
        fv(1, "control", ["s1"], true),
        fv(2, "drug", ["s2"]),
        fv(3, "vehicle", []),
      ]),
    );
    expect(withEmpty.factors[0].empty_factor_values).toHaveLength(1);
    expect(withEmpty.ok).toBe(clean.ok);
    expect(clean.ok).toBe(true);
  });

  it("stays quiet on continuous factors", () => {
    // Per-sample measurements, not a discrete partition — the same
    // reason unassigned / baseline checks skip these.
    const design = emptyDesign({
      factors: [
        {
          ...categoricalFactor(1, "age", [fv(1, "", [])]),
          type: "continuous",
        },
      ],
      biomaterials: twoSamples,
    });
    expect(validateDesign(design).factors[0].empty_factor_values).toEqual([]);
  });
});
