import type { OntologyTerm, Statement } from "@/features/experiment/types";
import { GENOTYPE_OBJECT_TERMS } from "@/generated/predicates";

/**
 * Pre-baked Statement patterns from the Confluence guidelines —
 * the curator picks one and the StatementEditor renders a partly-
 * filled triple they can finish. URIs are taken from
 * Use-of-predicates-in-factor-values; labels match the canonical
 * spelling.
 *
 * Each template has a `subject_kind` / `object_kind` string the UI
 * surfaces as placeholder text inside the corresponding picker so
 * the curator knows which kind of term to type ("a gene", "a CHEBI
 * drug", "a cell type", etc).
 */
export interface StatementTemplate {
  id: string;
  /** Group / EFC this template belongs to. */
  category: string;
  /** Short label shown in the dropdown. */
  label: string;
  /** Fuller one-line description (popup hover). */
  description: string;
  /** Source URL for the Confluence pattern. */
  source?: string;
  /** Construct the partly-filled Statement. The factor's category
   *  is plumbed in so the new Statement carries the right one. */
  build: (factorCategory: OntologyTerm | null) => Statement;
  /** Placeholder hints for the subject / object pickers. */
  subjectHint: string;
  objectHint?: string;
}

const HAS_ROLE = predicate("has role", "RO_0000087");
const HAS_GENOTYPE = predicate("has_genotype", "GENO_0000222");
const HAS_PHENOTYPE = predicate("has phenotype", "RO_0002200");
const HAS_DISEASE = predicate("has disease", "RO_0016002");
const ADJACENT_TO = predicate("adjacent to", "RO_0002220");
const DELIVERED_AT_DOSE = predicate("delivered at dose", "TGEMO_00166");
const DELIVERED_FOR_DURATION = predicate("delivered for duration", "TGEMO_00167");
const DELIVERED_TO = predicate("delivered to", "TGEMO_00183");
const INDUCED_BY = predicate("induced by", "TGEMO_00171");
const HAS_MODIFIER = predicate("has modifier", "RO_0002573");
const POS_FOR_PRODUCT = predicate("positive for product of gene", "TGEMO_00169");
const NEG_FOR_PRODUCT = predicate("negative for product of gene", "TGEMO_00170");
const TOWARD = predicate("toward", "RO_0002503");
const LOCATED_IN = predicate("located in", "RO_0001025");
const SAMPLED_AFTER = predicate("sampled after", "TGEMO_00202");
const HAS_DEV_STAGE = predicate("has developmental stage", "TGEMO_00168");

// Allele-STATE genotype objects (Homozygous negative, Overexpression,
// Constitutive active mutation, ...) are GENERATED from the agents SoT
// (design_constants.GENOTYPE_OBJECT_VOCAB) — looked up via `genoObj`
// below, so the picker can't drift from what the agent grounds. Bare
// `Heterozygous` is intentionally NOT offered: the object needs allele
// identity (`mHTT/+`) or an allele-state term (STATEMENT_GRAMMAR §5).
const OBI = {
  gene_knockdown: term("gene knockdown", "OBI_0002625", "obi"),
};
const SO = {
  increased_gpl: term("increased_gene_product_level", "SO_0002315"),
  decreased_gpl: term("decreased_gene_product_level", "SO_0002316"),
};
const PATO = {
  resistant_to: { label: "resistant to", uri: "http://purl.obolibrary.org/obo/PATO_0001178" },
  sensitive_toward: { label: "sensitive toward", uri: "http://purl.obolibrary.org/obo/PATO_0000516" },
  response_to: { label: "response to", uri: "http://purl.obolibrary.org/obo/PATO_0000077" },
};

function predicate(label: string, lid: string): OntologyTerm {
  return { label, uri: `http://purl.obolibrary.org/obo/${lid}` };
}
function term(label: string, lid: string, prefix: "obo" | "obi" = "obo"): OntologyTerm {
  return {
    label,
    uri: `http://purl.obolibrary.org/${prefix}/${lid}`,
  };
}

/** Look up a sanctioned allele-state genotype object by label from the
 *  generated (agents-SoT) table, so the genotype picker can't drift from
 *  what the agent grounds. */
function genoObj(label: string): OntologyTerm {
  const t = GENOTYPE_OBJECT_TERMS.find((x) => x.label === label);
  if (!t) throw new Error(`unknown genotype object term: ${label}`);
  return { label: t.label, uri: t.uri };
}

function withCategory(
  factorCategory: OntologyTerm | null,
  s: Omit<Statement, "category">,
): Statement {
  return {
    ...s,
    category: factorCategory ? { ...factorCategory } : null,
  };
}

export const STATEMENT_TEMPLATES: StatementTemplate[] = [
  // -- Genotype ---------------------------------------------------------
  {
    id: "genotype-ko",
    category: "genotype",
    label: "gene + has_genotype + Homozygous negative",
    description: "Knockout: gene (NCBI_GENE) + has_genotype + Homozygous negative (TGEMO_00001).",
    subjectHint: "gene (NCBI_GENE)",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...HAS_GENOTYPE },
        object: genoObj("Homozygous negative"),
      }),
  },
  // NOTE: bare `genotype-het` (gene + has_genotype + Heterozygous) is
  // RETIRED — zygosity without allele identity is under-specified. Use
  // `genotype-mut-freetext` with allele notation (`mHTT/+`) instead.
  {
    id: "genotype-oe",
    category: "genotype",
    label: "gene + has_genotype + Overexpression",
    description: "Overexpression: gene + has_genotype + Overexpression (TGEMO_00004).",
    subjectHint: "gene (NCBI_GENE)",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...HAS_GENOTYPE },
        object: genoObj("Overexpression"),
      }),
  },
  {
    id: "genotype-kd",
    category: "genotype",
    label: "gene + has_genotype + gene knockdown",
    description: "shRNA / siRNA: gene + has_genotype + gene knockdown (OBI_0002625).",
    subjectHint: "gene (NCBI_GENE)",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...HAS_GENOTYPE },
        object: { ...OBI.gene_knockdown },
      }),
  },
  {
    id: "genotype-cam",
    category: "genotype",
    label: "gene + has_genotype + Constitutive active mutation",
    description: "Constitutive active: gene + has_genotype + Constitutive active mutation (TGEMO_00008).",
    subjectHint: "gene (NCBI_GENE)",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...HAS_GENOTYPE },
        object: genoObj("Constitutive active mutation"),
      }),
  },
  {
    id: "genotype-mut-freetext",
    category: "genotype",
    label: "gene + has_genotype + (allele notation)",
    description:
      "Preferred for a specific allele: allele notation names the mutant " +
      "allele over wild-type and implies zygosity — e.g. mHTT/+, K23L/+, " +
      "exon 3 deletion. Use this instead of a bare zygosity term.",
    subjectHint: "gene (NCBI_GENE)",
    objectHint: "allele notation (free text, e.g. mHTT/+)",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...HAS_GENOTYPE },
        object: { label: "" },
      }),
  },

  // -- Treatment --------------------------------------------------------
  {
    id: "treatment-dose",
    category: "treatment",
    label: "drug + delivered at dose + (free-text)",
    description: "Dosage as a predicate on a Treatment FV — never its own EFC.",
    subjectHint: "drug (CHEBI)",
    objectHint: "dose (free text, e.g. 5 mg/kg)",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...DELIVERED_AT_DOSE },
        object: { label: "" },
      }),
  },
  {
    id: "treatment-duration",
    category: "treatment",
    label: "drug + delivered for duration + (free-text)",
    description: "Duration as a predicate on a Treatment FV.",
    subjectHint: "drug (CHEBI)",
    objectHint: "time (free text, e.g. 24 h)",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...DELIVERED_FOR_DURATION },
        object: { label: "" },
      }),
  },
  {
    id: "treatment-delivered-to",
    category: "treatment",
    label: "drug + delivered to + organism part",
    description: "Site-specific delivery — drug + delivered to + UBERON / CL / CLO.",
    subjectHint: "drug (CHEBI)",
    objectHint: "organism part (UBERON)",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...DELIVERED_TO },
        object: { label: "" },
      }),
  },

  // -- Disease / Disease model -----------------------------------------
  {
    id: "disease-induced-by",
    category: "disease model",
    label: "disease + induced by + (drug / surgery)",
    description: "Disease-model FV: MONDO disease + induced by (TGEMO_00171) + agent.",
    subjectHint: "disease (MONDO)",
    objectHint: "drug / surgery (CHEBI / free text)",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...INDUCED_BY },
        object: { label: "" },
      }),
  },
  {
    id: "disease-staging",
    category: "disease staging",
    label: "disease + has modifier + (stage)",
    description: "Staging — MONDO disease + has modifier + stage term / free text.",
    subjectHint: "disease (MONDO)",
    objectHint: "stage (MONDO / EFO / free text)",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...HAS_MODIFIER },
        object: { label: "" },
      }),
  },
  {
    id: "disease-located-in",
    category: "disease",
    label: "disease + located in + organism part",
    description: "Localised disease — disease + located in (RO_0001025) + UBERON.",
    subjectHint: "disease (MONDO)",
    objectHint: "organism part (UBERON)",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...LOCATED_IN },
        object: { label: "" },
      }),
  },
  {
    id: "disease-adjacent-control",
    category: "disease",
    label: "control + adjacent to + disease",
    description: "Paired-tissue control — control + adjacent to (RO_0002220) + MONDO disease.",
    subjectHint: "control",
    objectHint: "disease (MONDO)",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "control", uri: "http://www.ebi.ac.uk/efo/EFO_0001461" },
        predicate: { ...ADJACENT_TO },
        object: { label: "" },
      }),
  },
  {
    id: "has-disease",
    category: "cell line",
    label: "cell/tissue + has disease + disease",
    description: "Sample modified to carry a disease — has disease (RO_0016002).",
    subjectHint: "cell line / type / part (CLO / CL / UBERON)",
    objectHint: "disease (MONDO)",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...HAS_DISEASE },
        object: { label: "" },
      }),
  },

  // -- Cell-type markers ------------------------------------------------
  {
    id: "marker-positive",
    category: "cell type",
    label: "cell type + positive for product of gene + gene",
    description: "Marker-positive cell — CL + positive for product of gene + NCBI_GENE.",
    subjectHint: "cell type (CL)",
    objectHint: "gene (NCBI_GENE)",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...POS_FOR_PRODUCT },
        object: { label: "" },
      }),
  },
  {
    id: "marker-negative",
    category: "cell type",
    label: "cell type + negative for product of gene + gene",
    description: "Marker-negative cell — CL + negative for product of gene + NCBI_GENE.",
    subjectHint: "cell type (CL)",
    objectHint: "gene (NCBI_GENE)",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...NEG_FOR_PRODUCT },
        object: { label: "" },
      }),
  },

  // -- Phenotype --------------------------------------------------------
  {
    id: "pheno-resistant",
    category: "phenotype",
    label: "resistant to + toward + drug",
    description: "Drug resistance — resistant to (PATO_0001178) + toward + CHEBI drug.",
    subjectHint: "(filled)",
    objectHint: "drug (CHEBI)",
    build: (cat) =>
      withCategory(cat, {
        subject: { ...PATO.resistant_to },
        predicate: { ...TOWARD },
        object: { label: "" },
      }),
  },
  {
    id: "pheno-response",
    category: "phenotype",
    label: "response to + toward + treatment",
    description: "Treatment response — response to (PATO_0000077) + toward + treatment.",
    subjectHint: "(filled)",
    objectHint: "treatment (CHEBI / free text)",
    build: (cat) =>
      withCategory(cat, {
        subject: { ...PATO.response_to },
        predicate: { ...TOWARD },
        object: { label: "" },
      }),
  },
  {
    id: "pheno-sensitive",
    category: "phenotype",
    label: "sensitive toward + toward + drug",
    description: "Drug sensitivity — sensitive toward (PATO_0000516) + toward + drug.",
    subjectHint: "(filled)",
    objectHint: "drug (CHEBI)",
    build: (cat) =>
      withCategory(cat, {
        subject: { ...PATO.sensitive_toward },
        predicate: { ...TOWARD },
        object: { label: "" },
      }),
  },
  {
    id: "pheno-gpl-up",
    category: "phenotype",
    label: "gene + has phenotype + increased gene product level",
    description: "High expression — gene + has phenotype (RO_0002200) + increased_gene_product_level (SO_0002315).",
    subjectHint: "gene (NCBI_GENE)",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...HAS_PHENOTYPE },
        object: { ...SO.increased_gpl },
      }),
  },
  {
    id: "pheno-gpl-down",
    category: "phenotype",
    label: "gene + has phenotype + decreased gene product level",
    description: "Low expression — gene + has phenotype + decreased_gene_product_level (SO_0002316).",
    subjectHint: "gene (NCBI_GENE)",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...HAS_PHENOTYPE },
        object: { ...SO.decreased_gpl },
      }),
  },

  // -- Timepoint --------------------------------------------------------
  {
    id: "timepoint-sampled-after",
    category: "timepoint",
    label: "treatment + sampled after + (time)",
    description: "Time after a treatment / disease event — TGEMO_00202.",
    subjectHint: "treatment / disease",
    objectHint: "time (free text)",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...SAMPLED_AFTER },
        object: { label: "" },
      }),
  },

  // -- Developmental stage ---------------------------------------------
  {
    id: "dev-stage-with-age",
    category: "developmental stage",
    label: "UBERON stage + has developmental stage + (age)",
    description: "UBERON stage + has developmental stage (TGEMO_00168) + free-text age.",
    subjectHint: "stage (UBERON)",
    objectHint: "exact age (free text, e.g. P5)",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...HAS_DEV_STAGE },
        object: { label: "" },
      }),
  },

  // -- Baseline (any category, free pattern) ---------------------------
  {
    id: "baseline-has-role",
    category: "*",
    label: "object + has role + baseline term",
    description: "Generic baseline pattern — object + has role + control / wild type / reference.",
    subjectHint: "object",
    objectHint: "control / wild type genotype / reference role",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...HAS_ROLE },
        object: { label: "" },
      }),
  },
];

/**
 * Templates for a given factor category. Every template is always
 * offered — a factor value routinely carries a statement from a
 * *second* category (a timepoint FV that also asserts
 * ``has role → baseline role``, a genotype under a treatment FV,
 * etc.), so restricting the menu to the factor's own category hid the
 * pattern the curator actually needed. Design review 2026-07-21.
 *
 * We keep the list *ordered by relevance* rather than filtered: the
 * templates matching this factor's category (plus the generic "*"
 * baseline patterns) float to the top, everything else follows, so
 * the common case is still one glance away without hiding the rest.
 */
export function templatesFor(category: OntologyTerm | null): StatementTemplate[] {
  if (!category) return STATEMENT_TEMPLATES;
  const k = category.label.trim().toLowerCase();
  const relevant = (t: StatementTemplate) =>
    t.category === k || t.category === "*";
  return [
    ...STATEMENT_TEMPLATES.filter(relevant),
    ...STATEMENT_TEMPLATES.filter((t) => !relevant(t)),
  ];
}
