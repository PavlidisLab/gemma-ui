// AUTO-GENERATED — do not edit by hand.
//
// Source: gemma-curation-agents/data/predicates.json
// Regenerate via:
//   cd ../gemma-curation-agents && python scripts/sync_predicates_to_ui.py
//
// Edit the JSON and re-run the script. Both the JSON and this file
// must be committed. The agents Python loads the JSON directly; the
// UI imports this generated module so both halves of the system
// agree on the predicate allow-list.

export interface PredicateDef {
  label: string;
  uri: string;
  description: string;
  // Names a CLOSED object vocabulary the object MUST come from (key into
  // OBJECT_VOCABULARY_URIS below); undefined = open ontology object. Lets
  // the StatementEditor constrain the object picker (e.g. the baseline
  // `has role` template offers only baseline-role terms).
  allowedObject?: string;
}

export const PREDICATES: readonly PredicateDef[] = [
  { label: "has role", uri: "http://purl.obolibrary.org/obo/RO_0000087", description: "Baseline role assignment, e.g. DMSO has role reference substance role.", allowedObject: "baseline_role" },
  { label: "has_genotype", uri: "http://purl.obolibrary.org/obo/GENO_0000222", description: "Gene-level perturbation. E.g. Sox2 has_genotype homozygous negative." },
  { label: "has phenotype", uri: "http://purl.obolibrary.org/obo/RO_0002200", description: "Phenotypic descriptor / gene product level. E.g. Foxp3 has phenotype increased gene product level." },
  { label: "adjacent to", uri: "http://purl.obolibrary.org/obo/RO_0002220", description: "Tissue is physically next to the entity of interest, or cell co-culturing. E.g. control adjacent to disease." },
  { label: "delivered at dose", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00166", description: "Dose attached to a treatment. E.g. drug delivered at dose 5 uM." },
  { label: "delivered for duration", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00167", description: "Duration attached to a treatment. E.g. drug delivered for duration 24 h." },
  { label: "delivered to", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00183", description: "Organism part / cell where the treatment was delivered. E.g. drug delivered to hippocampus." },
  { label: "derives from cell line cell", uri: "http://purl.obolibrary.org/obo/CLO_0037210", description: "Sample / cell line is derived from a named CLO cell line." },
  { label: "derives from cell", uri: "http://purl.obolibrary.org/obo/CLO_0037209", description: "Sample is derived from a CL cell type." },
  { label: "derives from part of", uri: "http://purl.obolibrary.org/obo/ENVO_01003004", description: "Sample is derived from part of an organism part (UBERON)." },
  { label: "derives from", uri: "http://purl.obolibrary.org/obo/RO_0001000", description: "Catch-all when none of the `derives from x` cases fit." },
  { label: "derives from patient having disease", uri: "http://purl.obolibrary.org/obo/CLO_0000015", description: "Sample, primary cell or cell line obtained from an individual who has the disease. The disease belongs to that individual; the sample was not modified or induced to have it (contrast `has disease`). Use when the disease is not recoverable from the cell line's own record \u2014 an ungrounded line." },
  { label: "has child with disease", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00201", description: "Sample from a parent whose child has a specific disease." },
  { label: "has developmental stage", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00168", description: "Linking exact age to a UBERON developmental stage." },
  { label: "has disease", uri: "http://purl.obolibrary.org/obo/RO_0016002", description: "Sample modified to have a disease (not from a patient with it). Confluence: Use-of-predicates-in-factor-values." },
  { label: "has modifier", uri: "http://purl.obolibrary.org/obo/RO_0002573", description: "Object differs from its original form, or organism-part location qualifier (e.g. dorsal). Distinct from `induced by` and `has phenotype`." },
  { label: "induced by", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00171", description: "Disease/phenotype caused by a drug or surgery. E.g. Parkinson disease induced by MPTP." },
  { label: "located in", uri: "http://purl.obolibrary.org/obo/RO_0001025", description: "Localising a disease, genotype, or other FV. E.g. disease located in hippocampus." },
  { label: "positive for product of gene", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00169", description: "Marker-positive cell type/line. E.g. CD4 T cell positive for product of gene CD25." },
  { label: "negative for product of gene", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00170", description: "Marker-negative cell type/line." },
  { label: "sampled after", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00202", description: "Timepoint sampled after a treatment / disease event." },
  { label: "towards", uri: "http://purl.obolibrary.org/obo/RO_0002503", description: "Direction of a phenotype response. E.g. response to + towards + treatment." },
  { label: "targeted to", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00215", description: "A genetic alteration of the SUBJECT gene was confined to the cell type or tissue named by the OBJECT, rather than made throughout the organism \u2014 conditional / Cre-lox KO, cell-type-specific knockdown, tissue-specific overexpression. OBJECT = a grounded CL cell type or UBERON tissue. \ud83d\uded1 Use it on a statement whose CATEGORY is genotype \u2014 the category is what scopes the claim to the subject's GENOTYPE rather than to the gene product, so under `genotype` this says the engineered alteration was confined there, not that the product localises there. It is NOT scoped by the other predicate/object pair and cannot be: Gemma's statements are flat, so `has_genotype` and this are two independent assertions about the same subject. State the perturbation alongside anyway \u2014 a target with no alteration named is a poor annotation. The target is INDEPENDENT of the cell type the experiment profiled. Labelled `targeted towards` when minted 2026-08-21 and renamed the same day: RO_0002503's own label is `towards`, so the two sat adjacent in the picker with one a suffix of the other. `targeted towards` and `restricted to cell type` remain exact synonyms in TGEMO." },
  { label: "has background", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00216", description: "The genetic background the SUBJECT line, strain or genotype sits on, when the background is constant and is not itself the property under study. E.g. Bmal1 knockout + has background + C57BL/6. Put it on the line or genotype, never as a bare strain annotation of the samples: a constant C57BL/6 on every sample of a knockout study is the background, not those animals' strain. OBJECT = a grounded strain term. Minted 2026-08-29 as TERM_LEVEL (a background belongs to the line whatever the experiment did with it) and SUBJECT_IMPLIES_OBJECT (a knockout line implies C57BL/6; C57BL/6 implies nothing about which line is in hand), so it licenses suppression downward only. Gemma stores two predicate/object pairs per statement and TRUNCATES a third silently, so on a subject already carrying two pairs -- a compound genotype, most often -- the background needs its OWN statement." },
] as const;

export const KNOWN_PREDICATE_URIS: ReadonlySet<string> = new Set(
  PREDICATES.map((p) => p.uri),
);

// Closed object vocabularies: allowedObject -> the URIs the object
// may take. Mirrors design_constants.OBJECT_VOCABULARIES.
export const OBJECT_VOCABULARY_URIS: Readonly<Record<string, readonly string[]>> = {
  "baseline_role": ["http://purl.obolibrary.org/obo/OBI_0000025", "http://purl.obolibrary.org/obo/OBI_0000220", "http://purl.obolibrary.org/obo/PATO_0000383", "http://www.ebi.ac.uk/efo/EFO_0001461", "http://www.ebi.ac.uk/efo/EFO_0004425", "http://www.ebi.ac.uk/efo/EFO_0005168"],
};

// Sanctioned allele-STATE genotype objects (has_genotype), from
// design_constants.GENOTYPE_OBJECT_VOCAB. Bare `Heterozygous` is
// intentionally absent — the object needs allele identity (`mHTT/+`)
// or an allele-state term. The genotype statement templates key off
// this so the picker can't drift from the agent's grounding.
export interface GenotypeObjectTerm { label: string; uri: string; }
export const GENOTYPE_OBJECT_TERMS: readonly GenotypeObjectTerm[] = [
  { label: "Constitutive active mutation", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00008" },
  { label: "Double-copy overexpression", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00006" },
  { label: "Homozygous negative", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00001" },
  { label: "Overexpression", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00004" },
  { label: "Single-copy overexpression", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00005" },
  { label: "heterozygous", uri: "http://purl.obolibrary.org/obo/GENO_0000135" },
  { label: "homozygous", uri: "http://purl.obolibrary.org/obo/GENO_0000136" },
  { label: "unspecified zygosity", uri: "http://purl.obolibrary.org/obo/GENO_0000137" },
] as const;
