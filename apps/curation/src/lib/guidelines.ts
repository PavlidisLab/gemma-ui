/**
 * Curation-guideline snippets distilled from the Confluence dump
 * under `Gemma curation support`. The full canonical content lives
 * on the wiki; this module is a curator-facing tldr keyed by EFC
 * category / topic, used by `<HelpPopup/>` instances throughout
 * the UI.
 *
 * Source URLs use `wiki.pavlab.msl.ubc.ca` — the production wiki.
 * Curators on the intranet can click through; those off-network
 * still see the inline summary.
 */

export interface GuidelineSnippet {
  /** Title shown in the popover header. */
  title: string;
  /** Confluence page label. */
  source: string;
  /** Confluence URL. */
  sourceUrl: string;
  /** Body — kept short. Each line is rendered as a list item. */
  bullets: string[];
  /** Optional verbatim examples / format strings. */
  examples?: string[];
  /** Common-mistake / "don't" rules. */
  donts?: string[];
}

// Source URLs point at the specific Confluence page each snippet
// is derived from — never to the wiki landing page. Each popup's
// sourceUrl is what's surfaced as the click-through. Curators on
// intranet / VPN reach the live page; off-network they have the
// inline summary.
//
// The canonical text for each page is also checked in to the
// project workspace at
// `Gemma curation support/unpacked/gemma/<page>_<id>.html` —
// re-derive snippets from there rather than from memory.

// Wiki host is configurable via ``VITE_WIKI_BASE_URL`` (no trailing
// slash). Defaults to the production intranet wiki. Override in
// ``.env.local`` for off-network dev pointing at a mirror, or to
// disable click-through entirely by pointing at a placeholder host.
// The wiki is intranet-only; off-network curators see the inline
// summary and a non-resolving click target — that's by design until
// public-mirror plumbing exists.
const WIKI_HOST: string =
  (import.meta.env.VITE_WIKI_BASE_URL as string | undefined)?.replace(
    /\/+$/,
    "",
  ) || "https://wiki.pavlab.msl.ubc.ca";

const WIKI_BASE =
  `${WIKI_HOST}/display/gemma/Curating+Experimental+Factor+Categories+and+Factor+Values`;
const PREDICATE_URL =
  `${WIKI_HOST}/display/gemma/Use+of+predicates+in+factor+values`;
const BASELINE_URL =
  `${WIKI_HOST}/display/gemma/Curating+Baseline+Factor+Values`;
const GENOTYPE_URL =
  `${WIKI_HOST}/display/gemma/Curating+Genotype+EFCs`;
const TAGS_URL =
  `${WIKI_HOST}/display/gemma/Curate+the+Experimental+Tags`;
const FREE_TEXT_URL =
  `${WIKI_HOST}/display/gemma/Curating+using+Free-Text`;
const ONTO_URL =
  `${WIKI_HOST}/display/gemma/Using+ontologies`;
const CHECKLIST_URL =
  `${WIKI_HOST}/display/gemma/Experiment+Checklist`;

/**
 * Per-organism developmental-stage age cutoffs — the canonical mapping
 * a curator applies when a paper gives an age but doesn't name a stage
 * (Neonate -> Late Adult). Single source of truth: both the top-level
 * "developmental stages" crib-sheet popup and the per-category
 * "developmental stage" snippet render from this, so the numbers can't
 * drift between the two surfaces. Values re-derived from the Curating
 * EFCs wiki page, not from memory.
 */
export const DEV_STAGE_AGE_RANGES: { organism: string; ranges: string }[] = [
  {
    organism: "mouse",
    ranges:
      "Neonate P0-P9 · Infant P10-1mo · Juvenile 1mo-8wk · Prime Adult 8wk-1yr · Late Adult >1yr",
  },
  {
    organism: "rat",
    ranges:
      "Neonate P0-P9 · Infant P10-1mo · Juvenile 1-2mo · Prime Adult 2mo-1.5yr · Late Adult >1.5yr",
  },
  {
    organism: "human",
    ranges:
      "Neonate birth-1mo · Infant 1mo-2yr · Juvenile 2-16yr · Prime Adult 16-65yr · Late Adult >65yr",
  },
];

/**
 * Prenatal (embryo vs fetal) staging rules — the newer canonical guidance
 * layered on top of the postnatal {@link DEV_STAGE_AGE_RANGES}. Single-sourced
 * the same way so the embryo/fetal cutoffs stay identical between the per-category
 * "developmental stage" help and the top-level crib-sheet popup. Applies whether
 * developmental stage is a whole-experiment tag (constant across samples) or a
 * factor value (varies) — same UBERON stage terms either way.
 */
export const PRENATAL_STAGING_BULLETS: string[] = [
  "Applies identically as a whole-experiment tag (constant across samples) or a factor value (varies); an age straddling a stage boundary → assign neither stage.",
  "Prenatal = `embryo stage` (UBERON_0000068, through organogenesis), then `late embryonic / fetal stage` (UBERON_0007220 — UBERON's fetal term; no standalone `fetal` term exists).",
  "Human by post-conception (PC) age: ≤8 wk PC → embryo stage, ≥9 wk PC → fetal. Clinical gestational age (from LMP) runs ~2 wk ahead of PC — subtract ~2 wk when a paper reports gestational weeks.",
  "Mouse by embryonic day, recorded as free text via `has developmental stage` (TGEMO_00168): E0 → birth = embryo stage; ~E14.5 → birth = fetal (provisional). Capture the exact E-day, e.g. `E14.5`.",
  "Capture SOME stage whenever determinable — a coarse embryo stage beats leaving it blank.",
];

/** Prenatal staging "don't" — shared by the same two dev-stage surfaces. */
export const PRENATAL_STAGING_DONT: string =
  "Don't assign a literal organism age to derived material (organoid / iPSC- or ESC-derived / cell line) — but a derived model MAY carry the developmental stage it recapitulates when the paper states one (e.g. `comparable to post-conception week 19` → that modelled stage). Assign the modelled stage; don't leave it blank.";

/** Per-EFC guideline lookups, keyed by category label (lowercased). */
export const CATEGORY_GUIDELINES: Record<string, GuidelineSnippet> = {
  "biological sex": {
    title: "Biological sex EFC",
    source: "Curating EFCs",
    sourceUrl: WIKI_BASE,
    bullets: [
      "Use PATO terms for both sexes.",
      "Sex-chromosome manipulations belong under Genotype EFC, with the chromosome linked via `has_genotype` (GENO_0000222).",
      "Four-core-genotype (FCG) studies (XXM, XXF, XYM, XYF): annotate biological sex by GONADS, with `has_genotype` predicate carrying the chromosome (e.g. XXM = male + has_genotype + XX).",
      "Suspect mislabelling? Cross-check via XIST expression on Gemma's Visualize Expression tab — XIST is female-specific.",
    ],
  },

  "cell line": {
    title: "Cell line EFC",
    source: "Curating EFCs",
    sourceUrl: WIKI_BASE,
    bullets: [
      "Use CLO. If the specific line isn't in CLO, climb to a less specific term.",
      "Cells derived from a line: tag the appropriate EFO term + `derives from cell line` (CLO_0037210) + parent line.",
      "Common derived terms: iPSC-derived (EFO_0005740), stem cell-derived (EFO_0002886), ESC-derived (EFO_0005738), fibroblast-derived (EFO_0002009).",
      "Markers / FACS markers must NEVER be the only FV. Use cell line/type + `positive for product of gene` (TGEMO_00169) / `negative for product of gene` (TGEMO_00170) + gene (NCBI_GENE).",
    ],
  },

  "cell type": {
    title: "Cell type EFC",
    source: "Curating EFCs",
    sourceUrl: WIKI_BASE,
    bullets: [
      "Use CL — be as specific as possible. NIF is deprecated, even for brain cells.",
      "Use `located in` (RO_0001025) for organism-part qualifier and `has developmental stage` (TGEMO_00168) to specify the age of the sample the cell came from.",
      "If a CLO cell line is already tagged for the same sample, do NOT also tag the cell type — the cell line implies it.",
      "Cell markers / FACS-sorting markers must NEVER be the only FV — determine the actual cell type first. Markers go on as: cell type (CL) + `positive for product of gene` (TGEMO_00169) / `negative for product of gene` (TGEMO_00170) + gene (NCBI_GENE).",
      "Cell Atlas experiments (broad-spectrum cell-type studies) often need `splitExperiment` to break into sensible sub-experiments — they're poor fits for DEA as-is.",
    ],
  },

  "clinical history": {
    title: "Clinical history EFC",
    source: "Curating EFCs",
    sourceUrl: WIKI_BASE,
    bullets: [
      "Rare. Humans only. Similar usage to Environmental History.",
    ],
  },

  "collection of material": {
    title: "Collection of material EFC",
    source: "Curating EFCs",
    sourceUrl: WIKI_BASE,
    bullets: [
      "Used to exclude problem samples from DEA: tag with DE_Exclude (TGEMO_00014); rest with DE_Include (TGEMO_00013). Subset by collection_of_material when running DEA.",
      "Cell-sorting methods: FACS = `flow cytometer sorting` (OBI_400099); LCM = `Laser Capture Microdissection (LCM)` (free text); manual = `manual sorting`; TRAP = `translating ribosome affinity purification (TRAP)`; MACS = `magnetic affinity cell sorting`.",
      "RNA fractions / ribosome profiling: `total RNA` (EFO_0004964), `Ribosomal profiling` (TGEMO_00103), `polysome` (GO_0005844).",
      "Mixed experiments (multiple studies in one file): label with `Experiment 1`, `Experiment 2`, … so DEA can be subset on collection_of_material.",
      "Splits with < 4 samples need to be deleted — DEA can't run on them.",
    ],
    donts: [
      "DEA should never be run between RNA-sequencing methods (that's an enrichment analysis, not differential expression).",
    ],
  },

  "developmental stage": {
    title: "Developmental stage EFC",
    source: "Curating EFCs",
    sourceUrl: WIKI_BASE,
    bullets: [
      "Use UBERON. EFO is FORBIDDEN for developmental stage.",
      "Embryo: use `embryo stage` (UBERON_0000068). NOT `embryo` (UBERON_0000922) — that's anatomical, not a stage.",
      "Common stages: Neonate (UBERON_0007221), Infant (UBERON_0034920), Juvenile (UBERON_0034919), Prime Adult (UBERON_0018241), Late Adult (UBERON_0007222).",
      "Per-organism age ranges (when stage isn't stated explicitly): " +
        DEV_STAGE_AGE_RANGES.map((r) => `${r.organism} — ${r.ranges}`).join(
          "; ",
        ) +
        ". See the Developmental stages crib sheet for the same table.",
      "Mouse Juvenile↔Prime-Adult boundary: 8 weeks (56 days) is the ADULT floor. Classify a cohort by its YOUNGEST age — `8wk` / `8-10wk` → prime adult; `7wk` / `6-8wk` (dips below 8wk) → juvenile. A straddling range takes the younger stage; don't leave it blank.",
      "Ranges: same prefix on both ends, space-dash-space (`1 week - 4 week`, `E10 - E12`).",
      "Exact ages: free text, attached via `has developmental stage` (TGEMO_00168) to the UBERON stage. E.g. `embryo stage + has developmental stage + E10`.",
      ...PRENATAL_STAGING_BULLETS,
    ],
    donts: [PRENATAL_STAGING_DONT],
  },

  diet: {
    title: "Diet EFC",
    source: "Curating EFCs",
    sourceUrl: WIKI_BASE,
    bullets: [
      "Only use when the study is comparing diets (high vs low fat, fed vs fasted).",
      "Chemicals ingested with food are NOT diet — they're Treatment.",
      "Pick one as `reference substance role` (OBI_0000025); use EFO terms for the diet (e.g. high fat diet EFO_0002757).",
    ],
  },

  disease: {
    title: "Disease EFC",
    source: "Curating EFCs",
    sourceUrl: WIKI_BASE,
    bullets: [
      "Use MONDO terms (most-specific available).",
      "Diseased tissue + adjacent + normal: tag normal with `reference subject role` (OBI_0000220); adjacent with `control` (EFO_0001461) + `adjacent to` (RO_0002220) + disease (MONDO).",
      "Metastatic cancers: most don't have a specific MONDO term — tag the appropriate cancer term plus `metastatic` (PATO_0002098).",
      "Stroke / ipsilateral / contralateral experiments belong under Disease, NOT Organism part — they're modelling cerebral infarction.",
      "If primary source has the disease (e.g. patient cohort) → Disease. If induced or modelled → Disease model.",
    ],
  },

  "disease model": {
    title: "Disease model EFC",
    source: "Curating EFCs",
    sourceUrl: WIKI_BASE,
    bullets: [
      "Used when a disease is induced or modelled (mouse/animal model, induced cells, etc.). Same MONDO term as the disease itself.",
      "Format: control = `reference subject role` (OBI_0000220); model = MONDO term + `induced by` (TGEMO_00171) + agent (drug/surgery/CHEBI), or + `has_genotype` + gene for genetic models.",
      "Default rule: animal taxon + abstract mentions `model` / `induced` / `transgenic` / `KO` → Disease model.",
    ],
  },

  "disease staging": {
    title: "Disease staging EFC",
    source: "Curating EFCs",
    sourceUrl: WIKI_BASE,
    bullets: [
      "Most often for cancers (Type I vs Type II). Uncommon EFC.",
      "Format: MONDO disease + `has modifier` (RO_0002573) + stage.",
      "Stage ≠ grade — confirm which the paper means.",
      "Use ontology terms for the stage where available (e.g. `stage 2 chronic kidney disease`).",
    ],
  },

  dose: {
    title: "Dose",
    source: "Curating EFCs",
    sourceUrl: WIKI_BASE,
    bullets: [
      "Dose is NEVER its own EFC.",
      "Always attach via predicate to a Treatment FV: `delivered at dose` (TGEMO_00166) + free-text dose, or `delivered for duration` (TGEMO_00167) + free-text duration.",
      "Multiple doses across days: encode as `N x dose` rather than splitting into dose × timepoint.",
    ],
  },

  "environmental history": {
    title: "Environmental history EFC",
    source: "Curating EFCs",
    sourceUrl: WIKI_BASE,
    bullets: [
      "Rare. Used when an earlier-generation animal received the treatment but a later generation is being studied (F1 dosed, F3 measured).",
      "Treatment to a pregnant mother → Treatment EFC, not Environmental history.",
    ],
  },

  genotype: {
    title: "Genotype EFC",
    source: "Curating Genotype EFCs",
    sourceUrl: GENOTYPE_URL,
    bullets: [
      "Use NCBI_GENE for the gene. Human genes ALL CAPS, mouse/rat Title Case.",
      "Format: gene (NCBI_GENE) + `has_genotype` (GENO_0000222) + mutation type (TGEMO term or free text).",
      "Common mutation TGEMO terms: Homozygous negative (TGEMO_00001), Heterozygous (TGEMO_00002), Overexpression (TGEMO_00004), Constitutive active mutation (TGEMO_00008), gene knockdown (OBI_0002625).",
      "Drug-induced KO (Cre-loxP via tamoxifen / dox) is still Genotype — don't annotate the inducer.",
      "Capture the FUNCTIONAL change of a mutation (e.g. dominant-negative), not just the position.",
    ],
    donts: [
      "If no specific gene is named → not Genotype. Use Treatment or another EFC.",
      "Chemical agents acting on proteins (agonists / antagonists / immunodepletion) are Treatment, not Genotype.",
    ],
  },

  "organism part": {
    title: "Organism part EFC",
    source: "Curating EFCs",
    sourceUrl: WIKI_BASE,
    bullets: [
      "Use UBERON for everything, including brain regions. NIF is deprecated.",
      "Stroke models with `ipsilateral` / `contralateral` are Disease, not Organism part.",
    ],
  },

  phenotype: {
    title: "Phenotype EFC",
    source: "Curating EFCs",
    sourceUrl: WIKI_BASE,
    bullets: [
      "Drug-resistance pattern: `resistant to` (PATO_0001178) + `toward` (RO_0002503) + drug (CHEBI). Sensitive: PATO_0000516. Susceptible: PATO_0001152. Response: PATO_0000077.",
      "Gene-expression-level pattern: gene (NCBI) + `has phenotype` (RO_0002200) + increased_gene_product_level (SO_0002315) or decreased_gene_product_level (SO_0002316).",
      "Use PATO baselines (`reference subject role`) for the comparator.",
    ],
  },

  population: {
    title: "Population EFC",
    source: "Curating EFCs",
    sourceUrl: WIKI_BASE,
    bullets: [
      "Uncommon. Used for studies comparing ethnic groups.",
      "Medium priority — skip if ethnicity isn't mentioned in the experimental description.",
    ],
  },

  strain: {
    title: "Strain EFC",
    source: "Curating EFCs",
    sourceUrl: WIKI_BASE,
    bullets: [
      "Use TGEMO terms when canonical (e.g. 5xFAD = TGEMO_00172). Otherwise free text in JAX nomenclature.",
      "Hybrid strains (C57BL/6 x FVB): annotate the hybrid as a single free-text term — DO NOT tag a parental strain.",
      "WT control with unspecified strain → `reference subject role` (OBI_0000220).",
    ],
  },

  timepoint: {
    title: "Timepoint EFC",
    source: "Curating EFCs",
    sourceUrl: WIKI_BASE,
    bullets: [
      "Zero timepoint → `initial time point` (EFO_0004425). Gemma uses this as the baseline.",
      "No zero timepoint? Earliest = `timepoint (free text) + has role + initial time point`.",
      "Timepoint is for SAME-treatment-different-time. Same-time-different-treatment-duration belongs under Treatment with `delivered for duration`.",
    ],
  },

  age: {
    title: "Age EFC",
    source: "Curating EFCs",
    sourceUrl: WIKI_BASE,
    bullets: [
      "Used for human experiments only.",
      "Set as a CONTINUOUS EFC where possible — values entered per sample by double-click.",
    ],
  },

  treatment: {
    title: "Treatment EFC",
    source: "Curating EFCs",
    sourceUrl: WIKI_BASE,
    bullets: [
      "Chemicals: ChEBI. Polypeptides without ChEBI: EFO. Externally-added proteins (e.g. IFNa added to a dish): NCBI_GENE for the gene that codes the protein. Protein complexes: GO term, or EFO if absent.",
      "Tetracycline / doxycycline / tamoxifen: Treatment when used for their drug purpose; Genotype when used to induce gene expression / knockouts (Cre-Lox).",
      "Inhibitors that act on a protein product: annotate the chemical in the FV (with predicate / dose if applicable). If the targeted gene is central, put it in experiment tags — don't bake it into the FV.",
      "Immunodepletion (antibody removing a protein): Treatment, free-text antibody name (e.g. `mAb aD11`), with `delivered at dose` predicate as needed.",
      "dTAG (FKBP12F36V protein depletion): Treatment, gene + free-text `dTAG protein depletion`.",
      "Surgical treatments: same format. Free-text the surgical name when no ontology term fits. Use `delivered to` (TGEMO_00183) + UBERON to capture organism part if relevant.",
      "Cell co-culturing: `cell co-culturing` (OBI_0000153) + `adjacent to` (RO_0002220) + cell line / type.",
      "Vehicle / no-treatment controls = `reference substance role` (OBI_0000025). Two-control case: main control = `control` (EFO_0001461).",
      "Same-treatment-different-duration looks like a Timepoint EFC but is actually Treatment with `delivered for duration`.",
      "When timepoint and treatment are confounded (reference substance not tested at multiple timepoints), merge them: `treatment + delivered for duration + time`.",
      "Multiple doses across days: `4 x 0.5 mg/kg` rather than splitting into dose × timepoint.",
    ],
    donts: [
      "Don't annotate `[gene] + agonist/antagonist + [drug]` — capture the gene effect in the drug's ontology, not as a free-text bag.",
      "Don't tag `antibody` for immunodepletion — annotate the gene being depleted.",
    ],
  },
};

/** Predicate-picker guidance — short link to the full catalogue. */
export const PREDICATE_GUIDELINE: GuidelineSnippet = {
  title: "Predicates",
  source: "Use of predicates in factor values",
  sourceUrl: PREDICATE_URL,
  bullets: [
    "Predicates ADD information to an existing object. Appending a characteristic ADDS a separate entity. Prefer predicates first; append a new characteristic only if no predicate fits.",
    "Two EFCs that overlap exactly (flat p-value DEA) usually need merging — same predicate-vs-append rules apply.",
    "`has role` (RO_0000087) — baseline marker. object + has role + control / wild type genotype / initial time point / reference (substance|subject) role.",
    "`has_genotype` (GENO_0000222) — gene-level perturbation. gene (NCBI) + has_genotype + mutation type.",
    "`has phenotype` (RO_0002200) — gene-product-level changes; descriptors of biological entities. gene + has phenotype + increased_/decreased_gene_product_level (SO).",
    "`adjacent to` (RO_0002220) — paired-tissue control (control + adjacent to + disease) or cell co-culturing.",
    "`delivered at dose` (TGEMO_00166) — drug + delivered at dose + free-text dose.",
    "`delivered for duration` (TGEMO_00167) — drug + delivered for duration + free-text time. Also for disease-progression timelines.",
    "`delivered to` (TGEMO_00183) — drug + delivered to + organism part (UBERON / CL / CLO). Also for in-utero treatments delivered to mother.",
    "`induced by` (TGEMO_00171) — disease/phenotype induced by drug or surgery. Distinct from `has modifier`.",
    "`has modifier` (RO_0002573) — object differs from original form; organism-part location qualifier (e.g. dorsal); or fallback when no other predicate fits.",
    "`positive for product of gene` (TGEMO_00169) / `negative for product of gene` (TGEMO_00170) — marker-positive / -negative cell types. cell type + (predicate) + gene (NCBI).",
    "`derives from cell line` (CLO_0037210) — sample derived from a CLO cell line. `derives from cell` (CLO_0037209) — from a CL cell type. `derives from part of` (ENVO_01003004) — part of an organism part. `derives from` (RO_0001000) — generic catch-all.",
    "`has disease` (RO_0016002) — cell line / type / organism part modified to have a disease (NOT a patient sample).",
    "`has child with disease` (TGEMO_00201) — sample from a parent whose child has a specific disease.",
    "`has developmental stage` (TGEMO_00168) — UBERON developmental stage + has developmental stage + free-text exact age.",
    "`located in` (RO_0001025) — disease or genotype localised to an organism part. Used inside genotype EFCs too.",
    "`toward` (RO_0002503) — phenotype response. `response to` / `resistant to` / `sensitive toward` / `susceptible toward` + toward + treatment.",
    "`sampled after` (TGEMO_00202) — timepoint sampled after a treatment / disease event with a reference subject in the experiment.",
  ],
  donts: [
    "Deprecated: `has characteristic`, `has quality`, `has biological role`, `is_gene_target_of`, `has allele`. Don't use.",
  ],
};

export const BASELINE_GUIDELINE: GuidelineSnippet = {
  title: "Baseline factor values",
  source: "Curating Baseline Factor Values",
  sourceUrl: BASELINE_URL,
  bullets: [
    "Every factor needs exactly ONE baseline FV. Gemma uses it as the reference for DEA.",
    "Reference substance role (OBI_0000025) — chemical / non-chemical substance controls (including no-treatment).",
    "Reference subject role (OBI_0000220) — surgical-treatment controls, non-diseased controls.",
    "Control (EFO_0001461) — `main control` in experiments with two candidate controls. Forces this FV to be the DEA baseline.",
    "Wild type genotype (EFO_0005168) — natural genotype.",
    "Initial time point (EFO_0004425) — 0 h timepoints.",
    "Form: `object + has role (RO_0000087) + baseline-term`. E.g. DMSO + has role + reference substance role.",
    "When possible, also annotate the actual control substance (e.g. `Dimethyl sulfoxide + has role + reference substance role`) — gives the FV more context than the bare baseline term.",
    "On Wild type: use it when the manipulation is single-gene and the baseline is the normal allele. If comparing mouse strains, only use Wild type for a true normal strain (e.g. C57BL/6); otherwise prefer `control`.",
    "Two-control case (e.g. sham surgery + no-surgery): tag the closer control (sham) with `control`, the secondary with `reference subject role`. Older experiments lump both — that's no longer the guideline.",
    "Some factors have no obvious baseline (e.g. heart vs liver). Gemma picks one at random in that case; force a choice with `control` if it matters.",
  ],
  donts: [
    "Prefer the five terms above over: Baseline participant role, Control group, Control role, Normal control group, Negative control role, Normal littermates. These are a wording preference, not an error — Gemma auto-assigns them as baseline too (changed 2026-08-08), and an FV explicitly marked baseline is always treated as the baseline whatever term it carries. Existing designs using them don't need rewriting.",
  ],
};

export const TAGS_GUIDELINE: GuidelineSnippet = {
  title: "Experimental tags",
  source: "Curate the Experimental Tags",
  sourceUrl: TAGS_URL,
  bullets: [
    "Tags fill GAPS in the design, not duplicate it. If an annotation already lives on a FactorValue or BioMaterial, the UI bubbles it up as an inferred (yellow) tag — don't add a green one for the same thing.",
    "Most experiments should have at least one organism part / cell type covered, between the design and the tags. Add it as a tag only if it's constant across samples and not already in the design.",
    "Mouse / rat experiments almost always have a strain — tag it if the design doesn't carry it and the strain is stated.",
    "Animal-model experiments need a MONDO disease term tagged under `disease model` (when it isn't already on an FV).",
    "Same ontology rules as FactorValues — see the Curating EFCs guide for which ontology each category prefers (UBERON for organism part, CL for cell type, MONDO for disease, etc).",
    "Search uses ontology inference — tagging `brain` is redundant if a specific brain region (Ammon's horn, dentate gyrus, …) is already in the design.",
    "TGEMO study-design tags are tag-only (use `study design` as the EFC): `[Sample Study]` (TGEMO_00020), `[Cell Line Sample Study]` (TGEMO_00033), `[Benchmark Study]` (TGEMO_00032), `[Time Consuming]` (TGEMO_00011).",
    "Assay-type tags (`Transcription Profiling by Array` / `…High-Throughput Sequencing` / `Single-Cell RNA Sequencing` / `Single Nucleus RNA Sequencing`) are auto-applied — if missing, run `gemma-cli updateGEOData --update-experiment-tags -e GSE…`.",
    "Most experiments need ≤3 manually-added tags. If you're routinely adding more, ask for review.",
  ],
  donts: [
    "Don't tag claims from the abstract (`our results are relevant to cancer, dermatitis…`) — only actual features of the study.",
    "Don't tag a parent term when a more specific one already lives on a FV / BioMaterial — search inheritance covers it.",
    "`[SUBSET]` (TGEMO_00022) is deprecated — don't use.",
  ],
};

export const FREE_TEXT_GUIDELINE: GuidelineSnippet = {
  title: "Free-text formatting",
  source: "Curating using Free-Text",
  sourceUrl: FREE_TEXT_URL,
  bullets: [
    "Free-text last resort. If your term isn't in Gemma, search synonyms first; if still nothing, free-text it AND add to the proposed-ontology-terms sheet so it can be added to ChEBI / etc.",
    "Always full language, never abbreviated: `Stage 1` not `stg 1`; `Experiment 1` not `exp 1`; `11-fold overexpression` not `11x`.",
    "Descriptive but concise — readable to someone who's never seen the experiment.",
    "Units: lowercase, singular, space between number and unit. `48 h`, not `48h` / `48 hrs` / `48 hour`. Exceptions: `ZT0` (Zeitgeber) and `E3` / `P4` (embryonic / postnatal age) — no space.",
    "Time units: year, month, week, `d` (day), `h` (hour), `min` (minute, NOT `m` — that's metres), `s` (second), `ms`, `us`. SI prefixes: T, G, M, k, da, d, c, m, u (don't use Unicode μ), n, p.",
    "Ranges: same prefix on both ends, space-dash-space. `1 week - 4 week`, `E10 - E12`.",
    "Timepoints = passage of time, not the experimental day: `4 d`, not `Day 4`. Total elapsed, not range: `0 - 72 h`, not `72 h`.",
    "Exponents: `^x`. E.g. `J/m^2`, `5x10^6 cells/ml`.",
    "Doses / compound units: `5 mg/kg`, `5 mm/s`. Multi-dose: `4 x 0.5 mg/kg` (4 doses of 0.5 mg/kg). Simplify when possible: `10 ug/10 uL` → `1 ug/uL`.",
  ],
  donts: [
    "Don't use Unicode (μ, °, ×) — Gemma's text storage is fragile with these. Stick to ASCII.",
    "Don't free-text a term that already has an ontology entry under a synonym — search ChEBI / NCBO Bioportal / Ontobee first.",
  ],
};

export const ONTOLOGY_GUIDELINE: GuidelineSnippet = {
  title: "Picking ontology terms",
  source: "Using ontologies",
  sourceUrl: ONTO_URL,
  bullets: [
    "Prefer (a) an ontology-backed term over free text, (b) a previously-used term over a new one. The picker bolds previously-used terms; pick a bolded match unless it's wrong for this experiment.",
    "Pick the most specific term available. If the exact one doesn't exist, an option is to use a broader ontology term and specify the detail as a free-text modifier in the statement (`has modifier`, RO_0002573). Ontology terms ride Gemma's search inheritance — a term is also returned by queries for its broader parents — so an ontology match stays findable in a way free text never is.",
    "Different colour cues: green = ontology-backed, plain (black) = free-text fallback, bold = previously used in Gemma.",
    "Use terms by their meaning, not their label. `Cat` could be the animal, the enzyme, or the imaging technique. `Cortex` could be kidney or brain. Read the term's definition / parents on Ontobee before picking.",
    "Loaded ontologies: NCBI_Gene, GO, HP, MP, ChEBI, MONDO, OBI, EFO, PATO, UBERON, CL, CLO, TGEMO. NCBI_Taxon piggybacks via dependencies.",
    "If no Gemma term fits, search NCBO Bioportal (bioportal.bioontology.org) or Ontobee for synonyms — sometimes the right term exists under a different label (e.g. `liver adenoma` → `hepatocellular adenoma`).",
    "Per-EFC ontology preference table lives in Curating EFCs — UBERON for organism part, CL for cell type, MONDO for disease, etc.",
  ],
  donts: [
    "Don't pick an ontology term without reading its definition on Ontobee — the label can be misleading.",
    "Don't tag a parent when a more specific child is already on an FV / BioMaterial — search inheritance covers it.",
  ],
};

export const CHECKLIST_GUIDELINE: GuidelineSnippet = {
  title: "Pre-publish checklist",
  source: "Experiment Checklist",
  sourceUrl: CHECKLIST_URL,
  bullets: [
    "Details: number of samples + platform correct, correct taxon annotated, platform not unusable / two-colour / dual-mode, tags + experiment groups complete, DEA looks ok (p-value distribution, all charts render, baseline correct), publication linked when possible.",
    "Experimental Design: design correctly filled out, all samples have FVs assigned for each EFC (unless DE_Exclude), batch info shows up as an EFC.",
    "Visualize Expression: design looks good, no batch confounds.",
    "Diagnostics: all images render, sample-correlation matrix reasonable, predicted outliers reviewed (and removed if necessary). Microarrays only: mean-variance plot relatively flat.",
    "Quantitation Types: correct rows set as Pref, scale column set correctly.",
    "History: failed events / analyses fixed, or troubled flag set on what can't be fixed.",
    "Admin: preprocessing complete (except batch info if the platform doesn't have dates), DEA done — unless sample-study or otherwise unsuitable for DEA.",
  ],
};

/**
 * Standalone "developmental stages" crib sheet for the top-level
 * guidelines bar. Same content a curator gets from the per-category
 * "developmental stage" help, promoted here so the age -> stage
 * cutoffs are reachable without being on a developmental-stage EFC.
 * The age table is single-sourced from {@link DEV_STAGE_AGE_RANGES}.
 */
export const DEV_STAGE_GUIDELINE: GuidelineSnippet = {
  title: "Developmental stages — age cutoffs",
  source: "Curating EFCs",
  sourceUrl: WIKI_BASE,
  bullets: [
    "Use UBERON — EFO is FORBIDDEN for developmental stage. Embryo = `embryo stage` (UBERON_0000068), NOT `embryo` (UBERON_0000922, which is anatomical).",
    "Stage terms: Neonate (UBERON_0007221), Infant (UBERON_0034920), Juvenile (UBERON_0034919), Prime Adult (UBERON_0018241), Late Adult (UBERON_0007222).",
    "Use the stage the paper names. When it gives only an age, map to a stage with the per-organism cutoffs below.",
    "Exact age → free text via `has developmental stage` (TGEMO_00168) on the UBERON stage. E.g. `embryo stage + has developmental stage + E10`.",
    ...PRENATAL_STAGING_BULLETS,
  ],
  donts: [PRENATAL_STAGING_DONT],
  examples: DEV_STAGE_AGE_RANGES.map((r) => `${r.organism}: ${r.ranges}`),
};

/**
 * Look up a guideline snippet by category label. Case-insensitive,
 * returns `null` if no per-category snippet exists. Caller decides
 * whether to fall back to the parent EFC list popup.
 */
export function guidelineForCategory(label: string): GuidelineSnippet | null {
  const k = label.trim().toLowerCase();
  return CATEGORY_GUIDELINES[k] ?? null;
}

/**
 * Rewrite Confluence cloud (`pavlidislab.atlassian.net`) URLs to the
 * configured wiki host (defaults to `wiki.pavlab.msl.ubc.ca`; override
 * via ``VITE_WIKI_BASE_URL``). The agent emits cloud-
 * style URLs but those aren't valid for the team; the production
 * wiki is the click-through we want. Pass-through for everything
 * else (unknown shapes stay untouched so curators can debug them).
 */
export function normalizeWikiUrl(url: string | null | undefined): string {
  if (!url) return url ?? "";
  // Standard cloud format: /wiki/spaces/CG/pages/<id>/<Title+With+Pluses>
  const m = url.match(
    /^https?:\/\/pavlidislab\.atlassian\.net\/wiki\/spaces\/CG\/pages\/[^/]+\/(.+)$/,
  );
  if (m) return `${WIKI_HOST}/display/gemma/${m[1]}`;
  return url;
}
