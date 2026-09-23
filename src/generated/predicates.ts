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
  { label: "has role", uri: "http://purl.obolibrary.org/obo/RO_0000087", description: "The role the SUBJECT plays. Mostly a baseline role marking the reference arm, e.g. DMSO has role reference substance role. Other roles sparingly: a ChEBI chemical role (Compound-A has role antioxidant) or a sub-experiment name (13_statement_templates.md \u00a78). Paul, 2026-09-13: *\"has role should be more generally applicable, but sparingly I'd imagine\"* \u2014 until then the object was closed to the baseline roles." },
  { label: "has quality", uri: "http://purl.obolibrary.org/obo/RO_0000086", description: "The SUBJECT bears the intrinsic, observable attribute named by the OBJECT \u2014 a PATO-shaped quality. E.g. light has quality blue; a scaffold has quality porous. \ud83d\uded1 A quality is something the subject IS or HAS, not a role it PLAYS (has role) and not a genetic state (has_genotype). \ud83d\uded1 Its RO parent `has characteristic` (RO_0000053) is DELIBERATELY NOT OFFERED \u2014 Paul, 2026-09-13: *\"let's not have characteristic since it is the parent term\"*. A parent that subsumes four children is true of all of them and so selects for itself when a curator or an agent is unsure; the four children are `has quality`, `has role` (RO_0000087), `has function` (RO_0000085) and `has disposition` (RO_0000091). If none of those fits, the statement is probably the wrong shape rather than needing a vaguer predicate." },
  { label: "has_genotype", uri: "http://purl.obolibrary.org/obo/GENO_0000222", description: "Gene-level perturbation. E.g. Sox2 has_genotype homozygous negative." },
  { label: "has_allele", uri: "http://purl.obolibrary.org/obo/GENO_0000413", description: "The SUBJECT gene carries the specific allele named by the OBJECT \u2014 a point mutation, repeat expansion, frameshift or named variant. E.g. FUS has_allele R521H; Atxn1 has_allele CAG expansion mutation (154Q); APOE has_allele APOE4. \ud83d\uded1 NOT the same assertion as has_genotype (GENO_0000222), and the two must not be collapsed: has_genotype's objects are allele STATES (homozygous negative, overexpression) while this names WHICH ALLELE, so mapping it to `has modifier` would erase that. This is why it was kept out of the has characteristic / has quality ruling \u2014 Paul, 2026-09-03: \"the has_allele one surprises me\". Added to the allow-list 2026-09-13 on Paul's ruling, after measuring that all 86 corpus statements carry real alleles in BOTH predicate slots (50 second-slot, 36 first)." },
  { label: "has phenotype", uri: "http://purl.obolibrary.org/obo/RO_0002200", description: "Phenotypic descriptor / gene product level. E.g. Foxp3 has phenotype increased gene product level." },
  { label: "adjacent to", uri: "http://purl.obolibrary.org/obo/RO_0002220", description: "Tissue is physically next to the entity of interest, or cell co-culturing. E.g. control adjacent to disease." },
  { label: "delivered at dose", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00166", description: "Dose attached to a treatment. E.g. drug delivered at dose 5 uM." },
  { label: "delivered for duration", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00167", description: "How long a treatment or exposure ran; an instantaneous event (a single injection, a surgery, an injury) has no duration, and time since it is `sampled after`. E.g. drug delivered for duration 24 h." },
  { label: "delivered to", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00183", description: "Organism part / cell where the treatment was delivered. E.g. drug delivered to hippocampus." },
  { label: "derives from cell line cell", uri: "http://purl.obolibrary.org/obo/CLO_0037210", description: "Sample / cell line is derived from a named CLO cell line." },
  { label: "derives from cell", uri: "http://purl.obolibrary.org/obo/CLO_0037209", description: "Sample is derived from a CL cell type." },
  { label: "derives from part of", uri: "http://purl.obolibrary.org/obo/ENVO_01003004", description: "Sample is derived from part of an organism part (UBERON)." },
  { label: "derives from", uri: "http://purl.obolibrary.org/obo/RO_0001000", description: "Catch-all when none of the `derives from x` cases fit." },
  { label: "derives from patient having disease", uri: "http://purl.obolibrary.org/obo/CLO_0000015", description: "Sample, primary cell or cell line obtained from an individual who has the disease. The disease belongs to that individual; the sample was not modified or induced to have it (contrast `has disease`). Use when the disease is not recoverable from the cell line's own record \u2014 an ungrounded line." },
  { label: "has child with disease", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00201", description: "Sample from a parent whose child has a specific disease." },
  { label: "has developmental stage", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00168", description: "Linking exact age to a UBERON developmental stage." },
  { label: "has disease", uri: "http://purl.obolibrary.org/obo/RO_0016002", description: "Sample modified to have a disease (not from a patient with it). Confluence: Use-of-predicates-in-factor-values." },
  { label: "has modifier", uri: "http://purl.obolibrary.org/obo/RO_0002573", description: "Object differs from its original form, or a direction within a structure, grounded (e.g. Ammon's horn has modifier ventral, EFO_0001662). Distinct from `induced by` and `has phenotype`; a direction never takes `located in` (ruling, 2026-09-14)." },
  { label: "induced by", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00171", description: "Disease/phenotype caused by a drug or surgery. E.g. Parkinson disease induced by MPTP." },
  { label: "located in", uri: "http://purl.obolibrary.org/obo/RO_0001025", description: "A disease or genotype manipulation in a place: a tissue or organ (e.g. disease located in hippocampus). Never a direction within a structure, which is `has modifier` (ruling, 2026-09-14), and never a gene in a cell type, which is `targeted to`." },
  { label: "positive for product of gene", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00169", description: "Marker-positive cell type/line. E.g. CD4 T cell positive for product of gene CD25." },
  { label: "negative for product of gene", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00170", description: "Marker-negative cell type/line." },
  { label: "sampled after", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00202", description: "Time elapsed from a treatment / disease event to sampling, including after an instantaneous event (a single injection, a surgery, an injury); distinct from `delivered for duration`, which is how long an exposure ran." },
  { label: "towards", uri: "http://purl.obolibrary.org/obo/RO_0002503", description: "Direction of a phenotype response. E.g. response to + towards + treatment." },
  { label: "targeted to", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00215", description: "A genetic alteration of the SUBJECT gene was confined to the cell type or tissue named by the OBJECT, rather than made throughout the organism \u2014 conditional / Cre-lox KO, cell-type-specific knockdown, tissue-specific overexpression. OBJECT = a grounded CL cell type or UBERON tissue. \ud83d\uded1 Use it on a statement whose CATEGORY is genotype \u2014 the category is what scopes the claim to the subject's GENOTYPE rather than to the gene product, so under `genotype` this says the engineered alteration was confined there, not that the product localises there. It is NOT scoped by the other predicate/object pair and cannot be: Gemma's statements are flat, so `has_genotype` and this are two independent assertions about the same subject. State the perturbation alongside anyway \u2014 a target with no alteration named is a poor annotation. The target is INDEPENDENT of the cell type the experiment profiled. Labelled `targeted towards` when minted 2026-08-21 and renamed the same day: RO_0002503's own label is `towards`, so the two sat adjacent in the picker with one a suffix of the other. `targeted towards` and `restricted to cell type` remain exact synonyms in TGEMO." },
  { label: "has background", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00216", description: "The genetic background the SUBJECT line, strain or genotype sits on, where no tag can say it: a background that VARIES across the arms, a cell line's background, or an ungroundable strain hung off its grounded parent. E.g. Bmal1 knockout + has background + C57BL/6 on one arm beside a second line on a different background. A strain background CONSTANT across every sample is NOT this statement: it is a `strain background` tag (TGEMO_00217), same value (Paul, 2026-09-15). OBJECT = a grounded strain or cell line term. Minted 2026-08-29 as TERM_LEVEL (a background belongs to the line whatever the experiment did with it) and SUBJECT_IMPLIES_OBJECT (a knockout line implies C57BL/6; C57BL/6 implies nothing about which line is in hand), so it licenses suppression downward only. Gemma stores two predicate/object pairs per statement and REFUSES a third -- it does not truncate (corrected 2026-09-16; gembro measured both guards: tagCommitToCharacteristic throws BadRequestException above two statements, and design_preflight raises STATEMENT_ID_REPEATED when a statement id appears more than twice on a factor value). Silent truncation was the OLD behaviour and it cost us six statements across five tags on 2026-08-31; the refusal is the fix for that. So on a subject already carrying two pairs -- a compound genotype, most often -- the background needs its OWN statement." },
] as const;

// Every predicate URI Gemma accepts, offered in the picker or not.
export const KNOWN_PREDICATE_URIS: ReadonlySet<string> = new Set([
  "http://gemma.msl.ubc.ca/ont/TGEMO_00166",
  "http://gemma.msl.ubc.ca/ont/TGEMO_00167",
  "http://gemma.msl.ubc.ca/ont/TGEMO_00168",
  "http://gemma.msl.ubc.ca/ont/TGEMO_00169",
  "http://gemma.msl.ubc.ca/ont/TGEMO_00170",
  "http://gemma.msl.ubc.ca/ont/TGEMO_00171",
  "http://gemma.msl.ubc.ca/ont/TGEMO_00183",
  "http://gemma.msl.ubc.ca/ont/TGEMO_00201",
  "http://gemma.msl.ubc.ca/ont/TGEMO_00202",
  "http://gemma.msl.ubc.ca/ont/TGEMO_00215",
  "http://gemma.msl.ubc.ca/ont/TGEMO_00216",
  "http://purl.obolibrary.org/obo/BFO_0000050",
  "http://purl.obolibrary.org/obo/CLO_0000015",
  "http://purl.obolibrary.org/obo/CLO_0000179",
  "http://purl.obolibrary.org/obo/CLO_0037207",
  "http://purl.obolibrary.org/obo/CLO_0037209",
  "http://purl.obolibrary.org/obo/CLO_0037210",
  "http://purl.obolibrary.org/obo/CLO_0037229",
  "http://purl.obolibrary.org/obo/ENVO_01003004",
  "http://purl.obolibrary.org/obo/GENO_0000222",
  "http://purl.obolibrary.org/obo/GENO_0000413",
  "http://purl.obolibrary.org/obo/RO_0000086",
  "http://purl.obolibrary.org/obo/RO_0000087",
  "http://purl.obolibrary.org/obo/RO_0001000",
  "http://purl.obolibrary.org/obo/RO_0001025",
  "http://purl.obolibrary.org/obo/RO_0002100",
  "http://purl.obolibrary.org/obo/RO_0002200",
  "http://purl.obolibrary.org/obo/RO_0002220",
  "http://purl.obolibrary.org/obo/RO_0002503",
  "http://purl.obolibrary.org/obo/RO_0002573",
  "http://purl.obolibrary.org/obo/RO_0003301",
  "http://purl.obolibrary.org/obo/RO_0016002",
]);

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
