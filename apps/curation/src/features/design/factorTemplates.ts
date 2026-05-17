import type {
  Factor,
  FactorType,
  FactorValue,
  OntologyTerm,
  Statement,
} from "@/features/experiment/types";
import { STATEMENT_TEMPLATES } from "./statementTemplates";

/**
 * Light "factor recipes" the curator can drop in from a menu — they
 * pre-fill the factor's name, **category** (with the canonical
 * EFO/PATO URI), type, description, and a small set of seeded FVs
 * (baseline + starter) where the canonical pattern is unambiguous.
 *
 * The starter FV's first statement is built via the existing
 * ``STATEMENT_TEMPLATES`` registry so the predicate (``has_genotype``,
 * ``delivered at dose``, …) is pre-set — the curator just fills the
 * subject / object terms.
 *
 * Deliberately *light*: no closed FV value libraries (e.g. "male /
 * female" for sex), no multi-statement FVs. Templates that don't
 * have a clear default pattern (tissue, cell type, dev stage, sex,
 * batch) seed no FVs at all — the curator types them in.
 */
export interface FactorTemplate {
  /** Stable id for the menu / persistence keys. */
  id: string;
  /** Short label shown in the dropdown. */
  label: string;
  /** One-line description shown under the label. */
  description: string;
  /** Pre-filled factor scaffold. */
  factor: {
    name: string;
    category: OntologyTerm;
    type: FactorType;
    description: string;
  };
  /** FVs to seed on insert. ``is_baseline: true`` marks the
   *  baseline; ``statementTemplateIds`` references entries in
   *  ``STATEMENT_TEMPLATES`` so the predicate is pre-set on each
   *  seeded statement. Curator fills subject / object. */
  fvs?: TemplateFv[];
}

export interface TemplateFv {
  label: string;
  is_baseline?: boolean;
  /** Statement-template ids from ``STATEMENT_TEMPLATES``. Empty /
   *  missing → seed one empty statement carrying just the factor's
   *  category, matching the default ``addFactorValue`` shape. */
  statementTemplateIds?: string[];
}

const cat = (label: string, uri: string | null): OntologyTerm => ({
  label,
  uri,
});

// Canonical EFC category URIs from
// ``gemma_curation_agents/mock_gemma_curation_api/categories.py``
// (mirrors ``EFO.factor.categories.txt`` in the Gemma java repo).
const EFO = (id: string) => `http://www.ebi.ac.uk/efo/EFO_${id}`;
const PATO = (id: string) => `http://purl.obolibrary.org/obo/PATO_${id}`;

export const FACTOR_TEMPLATES: FactorTemplate[] = [
  {
    id: "treatment",
    label: "Treatment / drug",
    description: "Drug or compound treatment vs vehicle. Drug FV gets a 'delivered at dose' statement.",
    factor: {
      name: "treatment",
      category: cat("treatment", EFO("0000727")),
      type: "categorical",
      description: "Drug or compound treatment vs vehicle/control.",
    },
    fvs: [
      { label: "vehicle", is_baseline: true },
      // "drug + delivered at dose + (free-text dose)" — see
      // ``statementTemplates.ts:treatment-dose``. Subject = drug
      // (CHEBI), object = dose free text.
      { label: "drug", statementTemplateIds: ["treatment-dose"] },
    ],
  },
  {
    id: "genotype",
    label: "Genotype",
    description: "Gene perturbation (KO) vs wild-type. KO FV gets a 'has_genotype + Homozygous negative' statement.",
    factor: {
      name: "genotype",
      category: cat("genotype", EFO("0000513")),
      type: "categorical",
      description: "Gene perturbation vs wild-type.",
    },
    fvs: [
      { label: "wild type", is_baseline: true },
      // "gene + has_genotype + Homozygous negative" — see
      // ``statementTemplates.ts:genotype-ko``. Subject = gene
      // (NCBI_GENE), object pre-filled with TGEMO Homozygous
      // negative.
      { label: "knockout", statementTemplateIds: ["genotype-ko"] },
    ],
  },
  {
    id: "disease",
    label: "Disease state",
    description: "Diseased vs healthy. Curator picks the right pattern (induced by, located in, has disease) per case.",
    factor: {
      name: "disease state",
      category: cat("disease", EFO("0000408")),
      type: "categorical",
      description: "Diseased vs healthy condition.",
    },
    fvs: [
      { label: "healthy", is_baseline: true },
      // No fixed predicate — disease can be subject-only ("samples
      // from patients with X"), or layered with induced by /
      // located in / has disease. Curator picks via the per-FV
      // ``+ from template`` picker.
      { label: "diseased" },
    ],
  },
  {
    id: "organism-part",
    label: "Tissue / organism part",
    description: "Anatomical site (UBERON terms). No baseline / starter FVs.",
    factor: {
      name: "organism part",
      category: cat("organism part", EFO("0000635")),
      type: "categorical",
      description: "Anatomical site / tissue (UBERON).",
    },
  },
  {
    id: "cell-type",
    label: "Cell type",
    description: "Cell type (CL ontology). No baseline / starter FVs.",
    factor: {
      name: "cell type",
      category: cat("cell type", EFO("0000324")),
      type: "categorical",
      description: "Cell type (CL).",
    },
  },
  {
    id: "developmental-stage",
    label: "Developmental stage",
    description: "Age / stage (UBERON DV terms). No baseline.",
    factor: {
      name: "developmental stage",
      category: cat("developmental stage", EFO("0000399")),
      type: "categorical",
      description: "Developmental stage (UBERON DV).",
    },
  },
  {
    id: "biological-sex",
    label: "Biological sex",
    description: "Sex factor — no natural baseline.",
    factor: {
      name: "sex",
      category: cat("biological sex", PATO("0000047")),
      type: "categorical",
      description: "Biological sex.",
    },
  },
  {
    id: "batch",
    label: "Batch / block",
    description:
      "Nuisance factor for technical batch effects. Validator skips the baseline check on block / batch factors.",
    factor: {
      // ``block`` is the canonical category label the validator
      // recognises (see ``NO_BASELINE_CATEGORIES`` in
      // ``features/experiment/types.ts``). No URI in the EFO
      // category list — leave null and let the curator wire one if
      // they want.
      name: "batch",
      category: cat("block", null),
      type: "categorical",
      description: "Nuisance factor for technical batch effects.",
    },
  },
];

/**
 * Build the in-memory ``Factor`` shape for a template, ready to
 * splice into the design. Caller provides the fresh ``factorId``
 * plus a function that yields a fresh ``fvId`` for each seeded FV.
 */
export function factorFromTemplate(
  template: FactorTemplate,
  factorId: number,
  nextFvId: () => number,
): Factor {
  const factor_values: FactorValue[] = (template.fvs ?? []).map((spec) => ({
    id: nextFvId(),
    free_text_label: spec.label,
    is_baseline: !!spec.is_baseline,
    statements: buildFvStatements(template.factor.category, spec),
    biomaterial_short_names: [],
  }));
  return {
    id: factorId,
    name: template.factor.name,
    category: { ...template.factor.category },
    description: template.factor.description,
    type: template.factor.type,
    factor_values,
  };
}

/**
 * Resolve the FV's seeded statements. When the spec lists
 * ``statementTemplateIds`` we look them up in ``STATEMENT_TEMPLATES``
 * and call each template's ``build(factorCategory)``. Missing /
 * empty list → one empty statement carrying just the factor
 * category, matching the default ``addFactorValue`` shape so the
 * UI's per-FV statement editor renders consistently.
 */
function buildFvStatements(
  factorCategory: OntologyTerm,
  spec: TemplateFv,
): Statement[] {
  const ids = spec.statementTemplateIds ?? [];
  if (ids.length === 0) {
    return [
      {
        category: { ...factorCategory },
        subject: { label: "" },
      },
    ];
  }
  const out: Statement[] = [];
  for (const id of ids) {
    const tpl = STATEMENT_TEMPLATES.find((t) => t.id === id);
    if (!tpl) continue;
    out.push(tpl.build(factorCategory));
  }
  // If every id was bogus we'd ship an FV with zero statements,
  // which the editor doesn't expect. Fall back to one empty.
  if (out.length === 0) {
    return [
      {
        category: { ...factorCategory },
        subject: { label: "" },
      },
    ];
  }
  return out;
}
