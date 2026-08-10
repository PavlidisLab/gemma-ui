import { describe, expect, it } from "vitest";
import type { Factor, FactorValue } from "@/features/experiment/types";
import {
  GEMMA_BASELINE_TERMS,
  GEMMA_BASELINE_URIS,
  gemmaAutoBaselineFvs,
  gemmaAutoDetectsBaseline,
  gemmaBaselineTermOf,
  isGemmaBaselineTerm,
  normalizeBaselineTerm,
} from "./gemmaBaseline";

// Parity with ``BaselineSelection.java``. When the backend adds a term
// or a URI, these are the tests that should fail first — a mirror that
// drifts means the UI and the DEA disagree about which level is the
// reference, silently.

function fv(over: Partial<FactorValue> = {}): FactorValue {
  return {
    id: 1,
    free_text_label: "",
    is_baseline: false,
    biomaterial_short_names: [],
    statements: [],
    ...over,
  };
}

function factor(fvs: FactorValue[]): Factor {
  return {
    id: 1,
    name: "f",
    category: { label: "treatment", uri: null },
    description: "",
    type: "categorical",
    factor_values: fvs,
  };
}

describe("gemmaBaseline — the term list matches the Java", () => {
  it("carries every term in controlGroupTerms", () => {
    // Transcribed from BaselineSelection.java, in its own order.
    for (const t of [
      "baseline participant role",
      "baseline",
      "control diet",
      "control group",
      "control",
      "initial time point",
      "normal",
      "placebo",
      "reference subject role",
      "reference substance role",
      "to be treated with placebo role",
      "untreated",
      "wild type control",
      "wild type genotype",
      "wild type",
      "female",
      "control role",
      "negative control role",
      "normal control group",
      "normal littermate",
      "normal littermates",
    ]) {
      expect(GEMMA_BASELINE_TERMS.has(t)).toBe(true);
    }
    expect(GEMMA_BASELINE_TERMS.size).toBe(21);
  });

  it("carries every URI in controlGroupUris, female included", () => {
    expect(GEMMA_BASELINE_URIS.size).toBe(14);
    expect(
      GEMMA_BASELINE_URIS.has("http://purl.obolibrary.org/obo/PATO_0000383"),
    ).toBe(true);
    expect(
      GEMMA_BASELINE_URIS.has("http://purl.obolibrary.org/obo/OBI_0000025"),
    ).toBe(true);
    // Retired namespaces still appear on imported designs.
    expect(
      GEMMA_BASELINE_URIS.has(
        "http://mged.sourceforge.net/ontologies/MGEDOntology.owl#wild_type",
      ),
    ).toBe(true);
  });

  it("normalizes the way normalizeTerm does — case, underscores, spacing", () => {
    expect(normalizeBaselineTerm("Normal_Control_Group")).toBe(
      "normal control group",
    );
    expect(normalizeBaselineTerm("  wild   type  ")).toBe("wild type");
    expect(isGemmaBaselineTerm("WILD_TYPE")).toBe(true);
    expect(isGemmaBaselineTerm("normal diet")).toBe(false);
  });
});

describe("gemmaBaseline — which FVs Gemma picks up unmarked", () => {
  it("matches a URI on a statement subject", () => {
    expect(
      gemmaAutoDetectsBaseline(
        fv({
          free_text_label: "vehicle",
          statements: [
            {
              category: null,
              subject: {
                label: "reference substance role",
                uri: "http://purl.obolibrary.org/obo/OBI_0000025",
              },
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("matches a URI on a statement object — the `has role` shape", () => {
    expect(
      gemmaAutoDetectsBaseline(
        fv({
          free_text_label: "DMSO",
          statements: [
            {
              category: null,
              subject: { label: "DMSO", uri: null },
              predicate: {
                label: "has role",
                uri: "http://purl.obolibrary.org/obo/RO_0000087",
              },
              object: {
                label: "reference substance role",
                uri: "http://purl.obolibrary.org/obo/OBI_0000025",
              },
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("matches free text only where the position carries no URI", () => {
    // Java checks the label ONLY when the URI is null — a grounded term
    // is judged on its URI, so a value labelled "control" but grounded
    // to something else is not a baseline.
    expect(
      gemmaAutoDetectsBaseline(
        fv({
          statements: [
            {
              category: null,
              subject: {
                label: "control",
                uri: "http://purl.obolibrary.org/obo/CL_0000000",
              },
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("falls back to the FV's own value when it has no statements", () => {
    expect(gemmaAutoDetectsBaseline(fv({ free_text_label: "untreated" }))).toBe(
      true,
    );
    expect(gemmaAutoDetectsBaseline(fv({ free_text_label: "10 mg/kg" }))).toBe(
      false,
    );
  });

  it("never picks a continuous FV — measurement short-circuits", () => {
    expect(
      gemmaAutoDetectsBaseline(
        fv({ free_text_label: "normal", numeric_value: 3 }),
      ),
    ).toBe(false);
  });

  it("reports the term that matched, for curator-facing copy", () => {
    expect(gemmaBaselineTermOf(fv({ free_text_label: "female" }))).toBe(
      "female",
    );
    expect(gemmaBaselineTermOf(fv({ free_text_label: "male" }))).toBeNull();
  });

  it("puts a forced `control` FV first, as getBaselineLevels does", () => {
    // isForcedBaseline wins over a plain baseline-condition match, even
    // when the plain one comes first in factor order.
    const f = factor([
      fv({ id: 1, free_text_label: "untreated" }),
      fv({
        id: 2,
        free_text_label: "sham",
        statements: [
          {
            category: null,
            subject: {
              label: "control",
              uri: "http://www.ebi.ac.uk/efo/EFO_0001461",
            },
          },
        ],
      }),
    ]);
    expect(gemmaAutoBaselineFvs(f).map((x) => x.fv_id)).toEqual([2, 1]);
  });
});
