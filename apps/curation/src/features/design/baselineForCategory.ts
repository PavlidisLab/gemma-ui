import type { OntologyTerm } from "@/features/experiment/types";

/**
 * Per Confluence `Curating-Baseline-Factor-Values`, the right
 * baseline term depends on the factor's EFC. This map encodes the
 * canonical pick for each category Gemma supports — used by the
 * "set baseline" one-click wizard so curators don't have to look
 * up the right term per category.
 *
 * URIs taken from the Baseline page; verified against
 * Use-of-predicates and the Genotype-EFCs page (which uses
 * EFO_0001416 by typo — the canonical value is EFO_0001461).
 */
export interface BaselineTemplate {
  /** The Statement object (`object + has role + this`). */
  baselineTerm: OntologyTerm;
  /** Optional default subject — for genotype, "Wild type genotype"
   *  is used as the subject directly (no `has role` wrapper). */
  asStandalone: boolean;
  /** Free-text label suggested for the FV (curator can edit). */
  fvLabel: string;
  /** Short curator-facing rationale. */
  rationale: string;
}

const HAS_ROLE: OntologyTerm = {
  label: "has role",
  uri: "http://purl.obolibrary.org/obo/RO_0000087",
};

const TERMS = {
  control: {
    label: "control",
    uri: "http://www.ebi.ac.uk/efo/EFO_0001461",
  } satisfies OntologyTerm,
  reference_subject: {
    label: "reference subject role",
    uri: "http://purl.obolibrary.org/obo/OBI_0000220",
  } satisfies OntologyTerm,
  reference_substance: {
    label: "reference substance role",
    uri: "http://purl.obolibrary.org/obo/OBI_0000025",
  } satisfies OntologyTerm,
  wild_type: {
    label: "wild type genotype",
    uri: "http://www.ebi.ac.uk/efo/EFO_0005168",
  } satisfies OntologyTerm,
  initial_time_point: {
    label: "initial time point",
    uri: "http://www.ebi.ac.uk/efo/EFO_0004425",
  } satisfies OntologyTerm,
};

/**
 * Pick the canonical baseline template for a factor category.
 * Returns `null` if the category isn't recognized — the caller
 * should fall back to a generic "control" or prompt the curator.
 */
export function baselineFor(category: OntologyTerm | null): BaselineTemplate | null {
  if (!category) return null;
  const k = category.label.trim().toLowerCase();
  switch (k) {
    case "genotype":
      return {
        baselineTerm: TERMS.wild_type,
        asStandalone: true,
        fvLabel: "wild type",
        rationale:
          "Genotype EFC: wild type genotype (EFO_0005168) — used directly as the subject.",
      };
    case "treatment":
    case "diet":
      // Confluence DMSO example (verbatim): "if DMSO is being used
      // as the control treatment, the baseline factor value should
      // be Dimethyl sulfoxide + has role (RO_0000087) + reference
      // substance role". I.e. the SUBJECT is the actual control
      // substance, not the literal string "no treatment". Leave
      // ``fvLabel`` empty so the wizard uses whatever's already on
      // the FV (e.g. "DMSO") rather than overwriting with placeholder
      // copy. The mutation only falls back to ``fvLabel`` when the
      // FV has no label yet.
      return {
        baselineTerm: TERMS.reference_substance,
        asStandalone: false,
        fvLabel: "",
        rationale:
          "Treatment / Diet EFC: reference substance role (OBI_0000025) " +
          "attached to the actual control substance (e.g. DMSO + has " +
          "role + reference substance role). Per Confluence " +
          "Curating-Baseline-Factor-Values.",
      };
    case "disease":
    case "disease model":
    case "disease staging":
      // Per Confluence Curating-Baseline-Factor-Values:
      //   - Two controls (sham + no-surgery as in GSE52004): the
      //     main control is tagged with `Control` (EFO_0001461) —
      //     "the addition of this tag will force the specific FC
      //     to be set as the baseline during DEA". The secondary
      //     control gets `reference subject role`.
      //   - Single-arm disease vs control: still use `Control` for
      //     the main / only control.
      // ``Control`` is therefore the right *default* for a disease
      // factor's baseline. ``reference subject role`` is the
      // *secondary* pattern, only when there are two controls and
      // the curator manually picks it for the non-main one.
      return {
        baselineTerm: TERMS.control,
        asStandalone: false,
        fvLabel: "",
        rationale:
          "Disease EFC: Control (EFO_0001461) on the main control. " +
          "Per Confluence — `Control` forces the FC to be the DEA " +
          "baseline. If there's a secondary control (e.g. sham + " +
          "no-surgery), tag it with reference subject role (OBI_0000220) " +
          "manually instead.",
      };
    case "timepoint":
      return {
        baselineTerm: TERMS.initial_time_point,
        asStandalone: true,
        fvLabel: "0h",
        rationale:
          "Timepoint EFC: initial time point (EFO_0004425) — Gemma uses this as the DEA baseline.",
      };
    case "biological sex":
    case "cell line":
    case "cell type":
    case "organism part":
    case "strain":
    case "developmental stage":
    case "age":
    case "phenotype":
    case "population":
    case "clinical history":
    case "environmental history":
    case "collection of material":
      // No canonical baseline — Gemma picks a value at random for
      // categories without an obvious reference. Surface "control"
      // as the safest fallback; curator should usually pick a
      // specific reference subject role manually.
      return {
        baselineTerm: TERMS.control,
        asStandalone: false,
        fvLabel: "control",
        rationale: `${category.label} doesn't have a canonical baseline — Gemma picks at random unless one FV is marked. "control" (EFO_0001461) is the safest default; verify before commit.`,
      };
    default:
      return null;
  }
}

export const HAS_ROLE_PREDICATE = HAS_ROLE;
