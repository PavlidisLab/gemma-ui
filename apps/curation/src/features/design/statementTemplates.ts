import type { OntologyTerm, Statement } from "@/features/experiment/types";
import { GENOTYPE_OBJECT_TERMS, PREDICATES } from "@/generated/predicates";

/**
 * Pre-baked Statement patterns — the curator picks one and the
 * StatementEditor renders a partly-filled triple they can finish.
 *
 * The shapes come from the agents repo's
 * `docs/curation_rules/13_statement_templates.md` (the composed
 * annotations) on top of `07_predicates.md` (the predicate
 * allow-list). That repo is canonical and runs ahead of the wiki —
 * re-derive from those files, not from memory or from Confluence.
 *
 * Two principles govern every template, and they only conflict in one
 * direction: collapsing two annotations into one-annotation-plus-a-
 * statement is a WIN; dropping a statement to reach "one annotation"
 * is a LOSS. When "fewer annotations" and "retain more detail"
 * disagree, detail wins.
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

const HAS_ROLE = predicate("http://purl.obolibrary.org/obo/RO_0000087");
const HAS_GENOTYPE = predicate("http://purl.obolibrary.org/obo/GENO_0000222");
const HAS_PHENOTYPE = predicate("http://purl.obolibrary.org/obo/RO_0002200");
const HAS_DISEASE = predicate("http://purl.obolibrary.org/obo/RO_0016002");
// CLO's own object property. Pairs with HAS_DISEASE: that one is the
// engineered case, this one is the donor's.
const DERIVES_FROM_PATIENT_HAVING_DISEASE = predicate("http://purl.obolibrary.org/obo/CLO_0000015");
const DERIVES_FROM_PART_OF = predicate("http://purl.obolibrary.org/obo/ENVO_01003004");
// CLO_0037210's own rdfs:label really is "derives from cell line cell"
// (verified against OLS, 2026-08-21). The SoT was corrected to match the
// ontology; the picker shows the ontology's wording, so prose that names
// the predicate has to use it too or a curator cannot find the row.
const DERIVES_FROM_CELL_LINE = predicate("http://purl.obolibrary.org/obo/CLO_0037210");
const DERIVES_FROM_CELL = predicate("http://purl.obolibrary.org/obo/CLO_0037209");
const DERIVES_FROM = predicate("http://purl.obolibrary.org/obo/RO_0001000");
const ADJACENT_TO = predicate("http://purl.obolibrary.org/obo/RO_0002220");
const DELIVERED_AT_DOSE = predicate("http://gemma.msl.ubc.ca/ont/TGEMO_00166");
const DELIVERED_FOR_DURATION = predicate("http://gemma.msl.ubc.ca/ont/TGEMO_00167");
const DELIVERED_TO = predicate("http://gemma.msl.ubc.ca/ont/TGEMO_00183");
const INDUCED_BY = predicate("http://gemma.msl.ubc.ca/ont/TGEMO_00171");
const HAS_MODIFIER = predicate("http://purl.obolibrary.org/obo/RO_0002573");
const POS_FOR_PRODUCT = predicate("http://gemma.msl.ubc.ca/ont/TGEMO_00169");
const NEG_FOR_PRODUCT = predicate("http://gemma.msl.ubc.ca/ont/TGEMO_00170");
// RO_0002503's own label is "towards"; the SoT was corrected to match
// the ontology on 2026-08-21. That briefly left `targeted towards`
// ending in it — two picker rows a leading word apart — which is why
// TGEMO_00215 was renamed `targeted to` the same day. Resolved; the
// pair is only worth remembering as the reason the tooltips exist.
const TOWARD = predicate("http://purl.obolibrary.org/obo/RO_0002503");
const LOCATED_IN = predicate("http://purl.obolibrary.org/obo/RO_0001025");
const SAMPLED_AFTER = predicate("http://gemma.msl.ubc.ca/ont/TGEMO_00202");
const TARGETED_TO = predicate("http://gemma.msl.ubc.ca/ont/TGEMO_00215");
const HAS_BACKGROUND = predicate("http://gemma.msl.ubc.ca/ont/TGEMO_00216");
const HAS_CHILD_WITH_DISEASE = predicate("http://gemma.msl.ubc.ca/ont/TGEMO_00201");
const HAS_DEV_STAGE = predicate("http://gemma.msl.ubc.ca/ont/TGEMO_00168");

// Allele-STATE genotype objects (Homozygous negative, Overexpression,
// Constitutive active mutation, ...) are GENERATED from the agents SoT
// (design_constants.GENOTYPE_OBJECT_VOCAB) — looked up via `genoObj`
// below, so the picker can't drift from what the agent grounds.
// Zygosity objects (`heterozygous` GENO_0000135, `homozygous`
// GENO_0000136, `unspecified zygosity` GENO_0000137) come from GENO and
// arrive through the same table, and `05_genotype_efc.md` §Mutations
// sanctions them GROUNDED — but NO template offers one, on purpose. See
// the note where `genotype-het` used to sit, below.
// Every OBO term takes the `/obo/` path — including OBI. An `/obi/`
// variant was hand-built here once and resolves to nothing in Gemma,
// which hard-rejects an ungrounded URI on commit, so the prefix is no
// longer a parameter.
const OBI = {
  gene_knockdown: term("gene knockdown", "OBI_0002625"),
};
const SO = {
  increased_gpl: term("increased_gene_product_level", "SO_0002315"),
  decreased_gpl: term("decreased_gene_product_level", "SO_0002316"),
};
const CHEBI = {
  // The subject of the protein-treatment triplet (13_statement_templates
  // §5) — the applied protein, never the gene that encodes it.
  protein: term("protein", "CHEBI_36080"),
};
const PATO = {
  resistant_to: { label: "resistant to", uri: "http://purl.obolibrary.org/obo/PATO_0001178" },
  sensitive_toward: { label: "sensitive toward", uri: "http://purl.obolibrary.org/obo/PATO_0000516" },
  response_to: { label: "response to", uri: "http://purl.obolibrary.org/obo/PATO_0000077" },
};
// TGEMO lives on Gemma's own namespace, not the OBO purl base.
const TGEMO = {
  organoid: { label: "organoid", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00205" },
};

/**
 * Resolve a predicate from the generated agents-SoT allow-list BY URI.
 *
 * Keyed on the URI, not the label, because labels move and URIs don't.
 * On 2026-08-21 alone the SoT corrected two of them to their ontology
 * form — `derives from cell line` → `derives from cell line cell`
 * (CLO_0037210) and `toward` → `towards` (RO_0002503) — and each rename
 * threw here at module load, which took the whole design editor down
 * rather than one template with it. The URI is the identity; the label
 * is a display string this returns fresh from the SoT, so a relabel now
 * flows through instead of breaking.
 *
 * Still throws on an unknown URI: a predicate DROPPED from the
 * allow-list has to fail loudly rather than emit an unsanctioned
 * statement into a curator's design. The URI is spelled in full because
 * the namespace is part of the identity — TGEMO predicates live under
 * `gemma.msl.ubc.ca/ont`, not the OBO purl base, and every TGEMO
 * template once shipped a legacy-namespace URI the editor had to
 * canonicalize on the way back in.
 */
function predicate(uri: string): OntologyTerm {
  const p = PREDICATES.find((x) => x.uri === uri);
  if (!p) throw new Error(`unknown predicate URI: ${uri}`);
  return { label: p.label, uri: p.uri };
}
function term(label: string, lid: string): OntologyTerm {
  return { label, uri: `http://purl.obolibrary.org/obo/${lid}` };
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
  // 🛑 NO bare-zygosity template, deliberately — `gene + has_genotype +
  // heterozygous (GENO_0000135)` is a DOCUMENTED pattern, not a
  // one-click shape (Paul, 2026-08-21: "the guidelines map out the
  // pattern they can use, it's not to be a template").
  //
  // The grounding is sanctioned — `05_genotype_efc.md` §Mutations
  // blesses it for a single-allele KO and for `+/mut`, zygosity comes
  // from GENO rather than TGEMO, and the terms ride in on the same sync
  // as everything else. But the same page says not to reach for a
  // zygosity word when the paper doesn't pin the second allele down
  // (`[mut]/?` instead), and a template puts the word one click away,
  // which is the pull that argument is resisting. A hover description
  // is weaker than not offering it. The pattern is written out in
  // `guidelines.ts` — the genotype EFC snippet and the statement-
  // template examples — where reading it is the step before using it.
  //
  // The term itself stays reachable through the ontology term picker,
  // so a curator following the guideline is not blocked; they just
  // arrive at it having read the rule.
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
    description:
      "RNA-level knockdown — shRNA / siRNA / sgRNA-i / ASO / morpholino: " +
      "gene + has_genotype + gene knockdown (OBI_0002625). This is NOT " +
      "`Homozygous negative`, which is a DNA-level null. Add `has modifier + " +
      "<reagent>` alongside to name the reagent.",
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
  {
    id: "genotype-targeted",
    category: "genotype",
    label: "gene + targeted to + cell type / tissue",
    description:
      "A perturbation RESTRICTED to one cell type or tissue — conditional " +
      "/ Cre-lox KO, cell-type-specific knockdown, tissue-specific " +
      "overexpression: gene + targeted to + the CL or UBERON target " +
      "(TGEMO_00215). 🛑 The CATEGORY is what scopes it: on a `genotype` " +
      "statement this says the engineered alteration was confined there, " +
      "NOT that the gene product localises there. What is targeted is the " +
      "GENOTYPE, not the gene. Emit it under `genotype` or not at all. " +
      "State the has_genotype pair alongside — a target with no alteration " +
      "named is a poor annotation — but it is NOT what carries the " +
      "meaning: Gemma's statements are flat, so the two pairs are " +
      "independent assertions about the same subject and neither can " +
      "qualify the other. The target comes from the Cre DRIVER, never the " +
      "floxed gene, and is INDEPENDENT of what was profiled — a knockout " +
      "restricted to astrocytes takes `astrocyte` even when whole cortex " +
      "was sequenced.",
    subjectHint: "gene (NCBI_GENE)",
    objectHint: "cell type (CL) or tissue (UBERON)",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...TARGETED_TO },
        object: { label: "" },
      }),
  },

  {
    id: "genotype-background",
    category: "genotype",
    label: "line / genotype + has background + strain",
    description:
      "The genetic background the subject SITS ON, when the background is " +
      "constant across the experiment and is not itself the property under " +
      "study: Bmal1 knockout + has background + C57BL/6 (TGEMO_00216). " +
      "🛑 It goes on the line, strain or genotype — never as a bare strain " +
      "annotation of the samples. A constant `C57BL/6` on every sample of a " +
      "knockout study is the BACKGROUND, not those animals' strain, and " +
      "recording it as the strain says the experiment was about wild-type " +
      "mice. The object is a grounded strain term. " +
      "🛑 Gemma stores two predicate/object pairs per statement and " +
      "truncates a third silently, so a subject already carrying two — a " +
      "compound genotype most often — needs its OWN statement for the " +
      "background; there is no other way to say it.",
    subjectHint: "cell line, strain or genotype",
    objectHint: "strain (e.g. C57BL/6)",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...HAS_BACKGROUND },
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
  {
    id: "treatment-agent-toward",
    category: "treatment",
    label: "agent + towards + what it is directed at",
    description:
      "A targeted agent and its target — antibody (EFO_0004390) + toward " +
      "(RO_0002503) + antigen. `towards` is DIRECTION: a response and its " +
      "stimulus, an agent and what it acts on. 🛑 NOT a perturbation " +
      "target — that is `targeted to` (TGEMO_00215), a different " +
      "predicate. 🛑 NOT a graft host " +
      "either: a xenograft is not a phenotype response, and the host is a " +
      "plain `growth condition` value with no statement at all.",
    subjectHint: "agent (e.g. antibody, EFO_0004390)",
    objectHint: "what it is directed at (antigen / stimulus)",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...TOWARD },
        object: { label: "" },
      }),
  },
  {
    id: "treatment-protein-gene",
    category: "treatment",
    label: "protein + derives from + gene",
    description:
      "Applied protein (cytokine, growth factor, recombinant ligand) — the " +
      "catalog triplet. Subject is `protein` (CHEBI_36080); the source gene " +
      "rides as the object. A gene is NOT a treatment: don't bind a bare gene " +
      "symbol as the factor value. Add `protein + delivered at dose` alongside " +
      "for the dose — same subject, second statement.",
    subjectHint: "(filled) protein (CHEBI_36080)",
    objectHint: "source gene (NCBI_GENE) — e.g. CCL19",
    build: (cat) =>
      withCategory(cat, {
        subject: { ...CHEBI.protein },
        predicate: { ...DERIVES_FROM },
        object: { label: "" },
      }),
  },
  {
    id: "treatment-protein-dose",
    category: "treatment",
    label: "protein + delivered at dose + (free-text)",
    description:
      "Second half of the protein triplet — the dose hangs off `protein` " +
      "(CHEBI_36080), the same subject as the `derives from` statement, not " +
      "off the gene.",
    subjectHint: "(filled) protein (CHEBI_36080)",
    objectHint: "dose (free text, e.g. 10 ng/ml)",
    build: (cat) =>
      withCategory(cat, {
        subject: { ...CHEBI.protein },
        predicate: { ...DELIVERED_AT_DOSE },
        object: { label: "" },
      }),
  },

  // -- Disease / Disease model -----------------------------------------
  {
    id: "disease-induced-by",
    category: "disease model",
    label: "disease + induced by + (drug / surgery)",
    description:
      "Disease-model FV: MONDO disease + induced by (TGEMO_00171) + agent. " +
      "One statement per inducer — two inducers means two statements on the " +
      "one value. `induced by` is causation, distinct from `has modifier` " +
      "(state). Dose does NOT ride here: a dose belongs to a treatment, and a " +
      "disease model is not a treatment.",
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
    description:
      "ENGINEERED only — the disease was put there by us, by modification or " +
      "breeding. A line or tissue that came from a patient with the disease " +
      "takes 'derives from patient having disease' instead. has disease " +
      "(RO_0016002).",
    subjectHint: "cell line / type / part (CLO / CL / UBERON)",
    objectHint: "disease (MONDO)",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...HAS_DISEASE },
        object: { label: "" },
      }),
  },
  {
    id: "derives-from-patient-having-disease",
    category: "cell line",
    label: "cell line / cell type + derives from patient having disease + disease",
    description:
      "The donor had the disease; the sample was not modified to have it. " +
      "Use when the disease is NOT recoverable from the line's own record — " +
      "a free-text or otherwise ungrounded cell line, or a grounded cell " +
      "type that only makes sense once you say whose it was. A line that " +
      "resolves in CLO / Cellosaurus already carries its disease: leave it " +
      "off. derives from patient having disease (CLO_0000015).",
    subjectHint:
      "the cell line or cell type — free text is fine when it does not ground",
    objectHint: "the DONOR's disease (MONDO)",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...DERIVES_FROM_PATIENT_HAVING_DISEASE },
        object: { label: "" },
      }),
  },
  {
    id: "clinical-child-disease",
    category: "clinical history",
    label: "subject + has child with disease + disease",
    description:
      "A familial cohort: the profiled individual is UNAFFECTED and the " +
      "design is defined by a relative's condition — mothers sampled by " +
      "their child's diagnosis. subject + has child with disease " +
      "(TGEMO_00201) + disease (MONDO). 🛑 The disease is NOT the " +
      "subject's. Don't also tag the experiment with it as though the " +
      "profiled people were affected — that assertion is the whole reason " +
      "this predicate exists.",
    subjectHint: "the profiled subject (free text is fine)",
    objectHint: "the CHILD's disease (MONDO)",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...HAS_CHILD_WITH_DISEASE },
        object: { label: "" },
      }),
  },

  // -- Origin: what the material IS, and where it came FROM -------------
  // 13_statement_templates §1-§3. Each of these collapses a pair of flat
  // annotations into one annotation that carries the relationship — the
  // arrangement that retains more, which is the one to prefer.
  {
    id: "cell-type-from-tissue",
    category: "cell type",
    label: "cell type + derives from part of + organism part",
    description:
      "The profiled cells are a named cell type out of a named anatomical " +
      "site, constant across samples. One annotation instead of a cell-type " +
      "tag beside a flat `organism part` tag — and NOT redundant with a " +
      "constant cell-type characteristic, because the tissue relationship " +
      "exists nowhere in that characteristic. derives from part of " +
      "(ENVO_01003004).",
    subjectHint: "cell type (CL) — e.g. astrocyte",
    objectHint: "organism part (UBERON) — e.g. spinal cord",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...DERIVES_FROM_PART_OF },
        object: { label: "" },
      }),
  },
  {
    id: "cell-type-from-line",
    category: "cell type",
    label: "cell type + derives from cell line cell + cell line",
    description:
      "The profiled cells were differentiated or otherwise derived FROM a " +
      "named line. The line is not what was measured — annotate the profiled " +
      "cell and carry the line as provenance. derives from cell line cell " +
      "(CLO_0037210).",
    subjectHint: "cell type (CL) — what was profiled",
    objectHint: "parent cell line (CLO) — e.g. H9 cell",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...DERIVES_FROM_CELL_LINE },
        object: { label: "" },
      }),
  },
  {
    id: "cell-type-from-cell",
    category: "cell type",
    label: "cell type + derives from cell + cell type",
    description:
      "Same shape as `derives from cell line cell`, for when the origin is a " +
      "primary cell rather than a named line. derives from cell " +
      "(CLO_0037209).",
    subjectHint: "cell type (CL) — what was profiled",
    objectHint: "origin cell type (CL)",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...DERIVES_FROM_CELL },
        object: { label: "" },
      }),
  },
  {
    id: "cell-type-adjacent-to",
    category: "cell type",
    label: "cell type / structure + adjacent to + neighbour",
    description:
      "Rare. The material is defined by what it sits BESIDE — a co-culture " +
      "partner, a peritumoural region: cell type (CL) or structure " +
      "(UBERON) + adjacent to (RO_0002220) + the neighbour. The " +
      "paired-tissue control (control + adjacent to + disease) is the " +
      "other use and has its own template under `disease`.",
    subjectHint: "cell type (CL) or structure (UBERON)",
    objectHint: "neighbouring cell type / structure",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...ADJACENT_TO },
        object: { label: "" },
      }),
  },
  {
    id: "culture-modality-organoid",
    category: "organism part",
    label: "organism part / cell type + has modifier + organoid",
    description:
      "Organoid / spheroid / explant is a culture MODALITY, not an " +
      "anatomical part. The anatomy (or cell type) is the value and " +
      "`organoid` is the modifier on it — `organism part: organoid` asserts " +
      "a body part that does not exist. organoid (TGEMO_00205).",
    subjectHint: "organism part (UBERON) or cell type (CL) — e.g. brain",
    objectHint: "(filled) organoid (TGEMO_00205)",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...HAS_MODIFIER },
        object: { ...TGEMO.organoid },
      }),
  },
  {
    id: "anatomy-located-in",
    category: "organism part",
    label: "structure + located in + sub-region / axis",
    description:
      "A finer position the ontology doesn't carry as its own class — a " +
      "hemisphere, a dorsoventral level, a cortical layer: structure " +
      "(UBERON) + located in (RO_0001025) + the sub-region. 🛑 The subject " +
      "is an ANATOMICAL structure or a disease, NEVER a gene. `<gene> " +
      "located in <cell type>` is the conditional-knockout case wearing " +
      "the wrong predicate — it says where the gene sits, not where the " +
      "alteration acts; that one is `targeted to`.",
    subjectHint: "structure (UBERON)",
    objectHint: "sub-region or axis (e.g. ventral, left hemisphere)",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...LOCATED_IN },
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
    label: "resistant to + towards + drug",
    description: "Drug resistance — resistant to (PATO_0001178) + towards + CHEBI drug.",
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
    label: "response to + towards + treatment",
    description: "Treatment response — response to (PATO_0000077) + towards + treatment.",
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
    label: "sensitive toward + towards + drug",
    description: "Drug sensitivity — sensitive toward (PATO_0000516) + towards + drug.",
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
  {
    id: "pheno-of-material",
    category: "phenotype",
    label: "material + has phenotype + phenotype term",
    description:
      "An observable state of the material or the perturbed gene that is " +
      "not its identity, its genotype or its disease: cell type (CL) or " +
      "gene (NCBI_GENE) + has phenotype (RO_0002200) + the phenotype. 🛑 " +
      "Distinct from `induced by` (which states a cause) and from `has " +
      "modifier` (the generic escape hatch). If a disease term fits, `has " +
      "disease` is more specific and wins.",
    subjectHint: "cell type (CL) or gene (NCBI_GENE)",
    objectHint: "phenotype term",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...HAS_PHENOTYPE },
        object: { label: "" },
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
    description:
      "Generic baseline pattern — object + has role + control / wild type / " +
      "reference / initial time point. KEEP the named value and add the role " +
      "to it: `C57BL/6 + has role + control`, never a bare `control` token, " +
      "which loses the strain the curator recorded.",
    subjectHint: "the FV's own value — keep it, don't replace it",
    objectHint: "control / wild type genotype / reference role / initial time point",
    build: (cat) =>
      withCategory(cat, {
        subject: { label: "" },
        predicate: { ...HAS_ROLE },
        object: { label: "" },
      }),
  },
  {
    id: "dea-subset-axis",
    category: "*",
    label: "object + has role + (Experiment 1 / 2 / …)",
    description:
      "Names a sub-experiment so the DEA machinery knows what to subset on. " +
      "Put the signal on the factor that ALREADY makes the split — e.g. " +
      "`prime adult stage + has role + Experiment 1` — rather than inventing " +
      "a `collection of material` factor that duplicates an existing " +
      "partition. There is no `study design: SUBSET` tag; the recommendation " +
      "rides as one consolidated “recommend subset DEA on factor X”.",
    subjectHint: "the FV's own value on the real splitting factor",
    objectHint: "sub-experiment name (free text) — e.g. Experiment 1",
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
