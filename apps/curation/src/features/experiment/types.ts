/**
 * Types for an experiment's *current* curated design — separate from the
 * Proposal types in `src/api/types.ts`. The Proposal schema is what an
 * agent submits to the curation queue; this schema is what Gemma already
 * has on the experiment (factors, FVs with statements, sample
 * assignments).
 *
 * The shapes mirror Gemma's domain model:
 *   - ExperimentalFactor (EFC)        → Factor
 *   - FactorValue (a "bag of statements") → FactorValue
 *   - Characteristic + Statement triple   → Statement
 *   - BioMaterial (sample)            → Biomaterial
 *
 * A future integration replaces the in-memory mock with a fetch against
 * the real Gemma read endpoints; the UI components don't need to change.
 */

import type { FindingEvidence } from "@/api/auditTypes";
import {
  gemmaAutoBaselineFvs,
  gemmaAutoDetectsBaseline,
  type AutoBaselineFv,
} from "@/features/design/gemmaBaseline";

export interface OntologyTerm {
  label: string;
  uri?: string | null;
}

export interface Statement {
  /** Gemma's statement id, when this row came from Gemma. Rows sharing
   *  one id are the pairs of ONE statement — that is the unit Gemma's
   *  two-pair ceiling applies to. Null on a row the curator just made:
   *  it has no statement of its own yet, and each uncommitted pair
   *  becomes its own statement, so it cannot be over the ceiling. */
  gemma_id?: number | null;
  /**
   * Per-statement category. Mirrors Gemma's Characteristic.category.
   * Statements in the same FactorValue usually share a category and
   * usually match the parent Factor's category, but the model
   * permits divergence (e.g. an FV combining genotype + treatment
   * statements). Optional for backwards compatibility with payloads
   * predating the field; new statements should populate it (the
   * mutation helpers default it to the parent factor's category).
   */
  category?: OntologyTerm | null;
  subject: OntologyTerm;
  predicate?: OntologyTerm | null;
  object?: OntologyTerm | null;
  /**
   * GO-style evidence code — `IC`, `IEA`, `IDA`, `TAS`, `IIA`.
   *
   * 🛑 **Carried so the commit can send it BACK.** The `design` section
   * is full-record replacement (gembro, 2026-09-06): an omitted key
   * clears the stored value. `supportingEvidence` is guarded — omitting
   * it on a row that has one is a 400 — and `evidenceCode` beside it is
   * not, so omitting THIS silently sets it null and the report still
   * says `updated: 1`. Measured on 657 statement 30030391: sent without
   * it, `IC` was gone.
   *
   * Read here purely to be re-sent unchanged. Nothing in the UI edits
   * it, which is why there is no mutation helper for it.
   */
  evidence_code?: string | null;
}

/** How many (predicate, object) pairs one subject may carry.
 *
 *  Gemma's wire model holds exactly two slots — ``predicate`` /
 *  ``object`` and ``secondPredicate`` / ``secondObject`` on
 *  ``AnnotationValueObject``. There is no third. The UI keeps
 *  statements FLAT (one row per pair, sharing category + subject) and
 *  regroups them at render time, so nothing in the editor's own shape
 *  stops a curator from stacking a third pair — the ceiling has to be
 *  enforced, not inherited.
 *
 *  Enforced by ``StatementGroupEditor``'s "+ pred/obj" affordance and
 *  reported by ``validateDesign`` for groups that arrived over the
 *  limit from somewhere else (an agent proposal, an older snapshot). */
export const MAX_STATEMENT_PAIRS = 2;

/** Bucket key for "statements about the same thing" —
 *  ``(category, subject)``, label + URI, case-folded.
 *
 *  One definition, two readers: ``groupStatementsBySubject`` collapses
 *  the flat rows into a visual group with it, and ``validateDesign``
 *  counts pairs per group with it. They have to agree, or the editor
 *  caps a group the validator doesn't recognise. */
export function statementGroupKey(s: Statement): string {
  const cat = s.category ?? null;
  return (
    `${cat?.label ?? ""}|${cat?.uri ?? ""}|` +
    `${s.subject?.label ?? ""}|${s.subject?.uri ?? ""}`
  ).toLowerCase();
}

/** Does this statement carry an actual (predicate, object) pair? A
 *  row with neither is the "subject named, pair not filled in yet"
 *  placeholder the "+ pred/obj" affordance creates — it occupies a
 *  slot but hasn't spent one. */
export function statementHasPair(s: Statement): boolean {
  return Boolean(s.predicate?.label?.trim() || s.object?.label?.trim());
}

export interface FactorValue {
  id: number;
  free_text_label: string;
  is_baseline: boolean;
  /**
   * Whether the SOURCE carried an explicit baseline flag.
   *
   * 🛑 `is_baseline` is a collapsed boolean but Gemma's flag is
   * TRI-STATE — `null` means "infer from the terms", and writing
   * `false` over a null turns inference OFF permanently, changing
   * which group DE treats as the reference. `composeDesign` collapses
   * `?? false` on the way in, so by the time the commit builder sees a
   * value it cannot tell a real `false` from an absent flag, and
   * emitted `isBaseline: false` over every null.
   *
   * Measured on gemma2/657, 2026-09-05: a description-only edit
   * preflighted as `updated: 1`, and the document the UI actually sent
   * as `updated: 3` — the two extra being this flag forced onto both
   * values. Gemma then refused the commit as deleting a
   * differential-expression analysis, correctly, for a change the
   * curator never made.
   *
   * Carried beside the boolean rather than widening it to
   * `boolean | null`: 109 non-test sites read `is_baseline` for
   * truthiness and are right to, and only the commit builder needs to
   * distinguish absent from false.
   */
  is_baseline_explicit?: boolean;
  statements: Statement[];
  biomaterial_short_names: string[];
  /** Canonical scalar reading for a continuous-factor FV — mirrors
   *  Gemma's ``FactorValue.measurement.value``. ``null`` / absent on
   *  categorical FVs. ``free_text_label`` carries the human
   *  rendering ("86 years") for display. */
  numeric_value?: number | null;
}

export type FactorType = "categorical" | "continuous";

export type BaselineRelevance =
  | "required"
  | "not_applicable"
  | "uncertain";

export interface Factor {
  id: number;
  name: string;
  category: OntologyTerm;
  description: string;
  type: FactorType;
  /** Optional. Mirrors ``FactorProposal.baseline_relevance``;
   *  threaded through ``applyProposalToDesign`` from accepted
   *  proposals. When unset the validator falls back to the static
   *  ``NO_BASELINE_CATEGORIES`` list — same behaviour as before
   *  this field landed, so curator-added factors and pre-baseline-
   *  relevance proposals still work. */
  baseline_relevance?: BaselineRelevance;
  baseline_relevance_reason?: string;
  /** Gemma's own `ExperimentalFactor` id, where Gemma knows this
   *  factor. On the design wire already (`gemmaFactorId`) and
   *  populated for imported experiments; null on anything Gemma
   *  hasn't seen. Matched category + sample PARTITION, never name —
   *  20 of 500 experiments carry two factors sharing category AND
   *  name, so a name-derived key locates the wrong one. */
  gemma_factor_id?: number | null;
  /** Content-derived factor id, stable across index rebuilds, for
   *  factors Gemma doesn't know. Lands on gold today; not yet on the
   *  design wire, so expect null here until it is. */
  local_factor_id?: string | null;
  factor_values: FactorValue[];
}

export interface BioAssay {
  /** Gemma's BioAssay id.
   *
   *  🛑 This is the join key for `/svd`, which returns `bioAssayIds` —
   *  the PC x factor panel's only route from a principal-component
   *  column back to a sample. `short_name` cannot stand in: it is the
   *  GSM accession and /svd never mentions one. Optional because the
   *  local API's own biomaterial projection has never carried it. */
  bio_assay_id?: number | null;
  /** Typically the GSM accession. */
  short_name: string;
  /** Descriptive title — the value curators key off when scanning a
   *  cohort. */
  name: string;
  /**
   * What was extracted, and how the library was built — straight from
   * `BIO_ASSAY`. Added by gembro 2026-09-05 to give the molecule a home
   * that a per-assay fact can actually live in: a factor value binds
   * only to a BioMaterial, so expressing a per-assay property as a
   * factor forces duplicating the sample (GSE220901 stores 168 assays
   * as 168 biomaterials, and the ADT/GEX pairing is unrecoverable).
   *
   * 🛑 **A SUMMARY, never a replacement.** 254 assays carry two or
   * three `molecular entity` values while this holds one — the backfill
   * kept the most specific (`nuclear` > `polyA` > `total`) — and 140 of
   * those are deliberately NULL, where the characteristic is the only
   * record at all. Render it BESIDE the characteristics; a "prefer this
   * when present" fallback would silently drop the losing term, and
   * `library_selection` cannot recover it (never `PolyA`, only `cDNA`
   * or null).
   *
   * Null on the ~687,000 assays with no molecule recorded, and absent
   * entirely from the local API's projection.
   */
  extracted_molecule?: string | null;
  library_selection?: string | null;
  library_strategy?: string | null;
}

export interface Biomaterial {
  short_name: string;
  name: string;
  characteristics: Record<string, string>;
  /** Parallel map keyed the same as ``characteristics``. Holds the
   *  ontology URIs Gemma's preprocessor mapped onto the (category,
   *  value) pair — sex → PATO, organism part → UBERON, cell type
   *  → CL, etc. Either side may be ``null`` when only one resolved.
   *  Whole field absent / empty when no URIs were mapped (free-text
   *  characteristics or pre-mapping data). Optional for backwards
   *  compat with payloads predating the field. */
  characteristic_uris?: Record<
    string,
    { category_uri?: string | null; value_uri?: string | null }
  >;
  /** The individual characteristics behind each ``characteristics``
   *  entry, in the order they were joined into it.
   *
   *  A sample can carry two characteristics of the SAME category, and
   *  ``characteristics`` holds one string per category, so
   *  ``foldCharacteristics`` joins them with ``"; "`` and
   *  ``characteristic_uris`` keeps only the first one's URIs. On
   *  GSE43526.2 (experiment 8959) that put ``polyA RNA extract``
   *  (OBI_0000869) and an un-URI'd ``Topotecan`` / ``Vehicle`` into one
   *  string, and both tag chips rendered the same truncated text over
   *  the same CURIE — a term that belongs to only one of them.
   *
   *  Each entry here carries its OWN URIs, so a value with none renders
   *  as free text instead of borrowing its neighbour's. Read it through
   *  ``characteristicValues()``, never directly: the array describes the
   *  string it was folded from, and a curator can edit that string.
   *
   *  Absent from producers predating the field (the local API's design
   *  projection, fixtures), where readers fall back to the joined string
   *  plus ``characteristic_uris``.
   *
   *  🛑 The value labels sit in a ``value`` FIELD rather than being map
   *  keys because ``snakeifyDataMap`` protects exactly one level of
   *  data-keyed map — the category names here — and a second level of
   *  submitter-written keys underneath would be rewritten. */
  characteristic_value_uris?: Record<
    string,
    Array<{
      value: string;
      category_uri?: string | null;
      value_uri?: string | null;
    }>
  >;
  /** Assays attached to this biomaterial. Usually one per
   *  biomaterial; >1 on multi-lane / multi-platform runs. Optional
   *  for backwards compat with payloads predating the field. */
  bio_assays?: BioAssay[];
  /** Single-cell datasets store one BioMaterial per cell-type
   *  bucket of one biological sample; all such buckets share a
   *  `source_biomaterial_id` (Gemma's internal id of the parent
   *  BioMaterial). `null` / absent for bulk experiments and for
   *  the source BioMaterials themselves. The sample table groups
   *  rows by this key — design factor values apply at the
   *  source-sample level, not the cell-type bucket. */
  source_biomaterial_id?: number | null;
  /** Raw per-sample GEO MINiML fields (treatment_protocol,
   *  growth_protocol, extract_protocol, source_name, title, …) captured
   *  at GEO ingest and carried on the design. NOT curated — verbatim
   *  submitter text. Surfaced in the sample metadata popover, labelled
   *  "from GEO", so a curator can read whole-experiment context (e.g.
   *  disease induction — "immunized with MOG35-55/CFA to induce EAE")
   *  that Gemma does not promote to a characteristic. Optional / absent
   *  for payloads predating GEO-field capture. */
  geo_fields?: Record<string, string>;
  /** GEO sample id (`GSM…`), when the source recorded one.
   *
   *  🛑 The join key for `sourceMetadata`'s per-sample document. It used
   *  to be read off `short_name`, which only holds a GSM when Gemma
   *  minted the biomaterial name with a pipe
   *  (`GSE2018_bioMaterial_7|GSM36429`). Names without one —
   *  `GSE324761_Biomat_1` — left the join matching nothing and the
   *  popover saying "no GEO fields for this sample". Absent where the
   *  payload does not carry an accession; readers fall back to
   *  `short_name`, which is correct for the piped names. */
  accession?: string | null;
}

export interface Tag {
  /** Stable identity for diff/edit. Server-assigned; the UI uses
   *  optimistic numeric IDs for new tags before the round-trip. */
  id: number;
  category: OntologyTerm;
  value: OntologyTerm;
  /** Structured (subject · predicate · object) statements attached
   *  to this experiment-level tag. Optional + back-compat: a flat
   *  ``{category, value}`` tag leaves this absent. When present and
   *  non-empty, the tag carries richer nuance than the single
   *  ``value`` field can express — e.g. ``genotype`` tag with
   *  statement ``[Abca4 · has_genotype · Homozygous negative]`` for
   *  a knockout experiment that applies to all samples. ``value``
   *  remains useful as a human-readable summary even on
   *  statement-shaped tags (mirrors ``FactorValue.free_text_label``).
   *  Gemma's ``ExpressionExperiment.characteristic`` entity already
   *  supports statements; this UI mirror unblocks rendering them
   *  on the overview / comparison surfaces. Per design review 2026-06-14. */
  statements?: Statement[];
  /** True when this tag is bubbled up from a sample characteristic
   *  or a factor-value statement rather than directly attached to
   *  the experiment. Inferred tags render distinctly (yellow,
   *  read-only); to remove one the curator removes the underlying
   *  FV/sample annotation. Mirrors Gemma's tag-display behaviour. */
  inferred?: boolean;
  /** Originating object class for inferred tags
   *  (`BioMaterial` / `FactorValue` / etc.) — surfaced as a hover
   *  tooltip on the chip. Empty for direct tags. */
  inferred_source?: string;
  /** GO-style evidence code from Gemma's `AnnotationValueObject.
   *  evidenceCode` — IC ("Inferred by Curator"), IEA ("Inferred from
   *  Electronic Annotation"), IDA ("Inferred from Direct Assay"), TAS
   *  ("Traceable Author Statement"), etc. Empty when Gemma sent
   *  null. The UI styles chips by code so curator-asserted (IC)
   *  annotations are visually distinct from electronically-propagated
   *  (IEA) ones. */
  evidence_code?: string;
  /** Verbatim provenance for an agent-emitted tag — the BM
   *  characteristic / paper sentence / catalog fact it was grounded
   *  on. Optional + tolerate-null: direct curator tags and older wire
   *  payloads leave it absent, and the chip renders unchanged. When
   *  present + non-empty the chip shows a ❝ evidence affordance.
   *  Mirrors `TagProposal.supporting_evidence`; pending a Gemma-side
   *  `AnnotationValueObject` field so curated tags carry it too. */
  supporting_evidence?: FindingEvidence[];
}

/**
 * Where the dataset was imported from. Mirrors Gemma's
 * `accession` / `external_database` / `external_uri` triple.
 *
 * Common values for `database`: `GEO`, `CELLxGENE`, `ArrayExpress`.
 * Direct uploads have no ExternalSource (`Design.external_source`
 * is `null`).
 */
export interface ExternalSource {
  database: string;
  accession: string;
  uri: string | null;
}

/**
 * Why this paper is linked to this experiment — Gemma's
 * `PUBLICATION_ASSOCIATION` row, one per (experiment, publication).
 *
 * The publication link was the one assertion in Gemma's model with no
 * evidence slot at all: Gemma could say *"the publication for this
 * experiment is X"* but not *"Y was considered and rejected, on this
 * evidence, by this authority"*, so every rejection had to live in a
 * hand-maintained file the system could not read. Landed Gemma-side
 * 2026-08-17 (`PUBLICATION_LINK_EVIDENCE_LANDED_2026_08_17`, migration
 * V25, live on gemma2 — verified against eid 1658).
 *
 * 🛑 `source` is a RANK, not a label: `curator` (40) > `geo_submitter_link`
 * == `external_import` (30) > `agent` (20) > `legacy` (10), evaluated at
 * write time, so an unattended refetch cannot displace a human ruling.
 * Read-only here — the UI states what the record says and asserts
 * nothing.
 *
 * Optional throughout, and absent on any backend that predates the
 * field: the local store does not carry it yet, and Gemma itself has
 * links with no row (experiment splitting, the CELLxGENE loader).
 * A missing association means "nothing recorded", never "no provenance
 * exists".
 */
export interface PublicationAssociation {
  status?: "accepted" | "rejected" | null;
  role?: "primary" | "other_relevant" | null;
  source?:
    | "curator"
    | "geo_submitter_link"
    | "external_import"
    | "agent"
    | "legacy"
    | null;
  /** The quotable one-liner: why this is the right paper. Gemma's own
   *  prose, not a verbatim quote from a source document. */
  evidence?: string | null;
  /** The same `FindingEvidence` shape the audit + proposal surfaces
   *  render, stored verbatim by Gemma and never parsed there. Null on
   *  every backfilled row. */
  supporting_evidence?: FindingEvidence[] | null;
  /** `GOEvidenceCode` — `IC` / `TAS` / `IEA` / `IIA`. 🛑 `IIA` is
   *  exactly the backfilled set whose provenance is assumed rather
   *  than known: the 23,066 seeded GEO links say so in their own
   *  evidence text. Every GEO link written from 2026-08-17 on carries
   *  `TAS`. */
  evidence_code?: string | null;
  /** Machine claims only, `[0,1]`. Null everywhere today. */
  confidence?: number | null;
  asserted_by?: string | null;
  asserted_at?: string | null;
}

export interface Publication {
  pubmed_id: string;
  doi: string;
  citation: string;
  title: string;
  /** Where the link came from — see {@link PublicationAssociation}.
   *  Rendered through the shared provenance disc, not a second
   *  surface of its own. */
  association?: PublicationAssociation | null;
}

/** Subset recommendations are advisory curator-asserted facts about
 *  analysis scope. See ``Design.subset_recommendations`` for the
 *  lifecycle. */
export interface SubsetRecommendation {
  id: string;
  /** Factor that scopes the subset (id of the ``Factor`` in the
   *  design). ``null`` when the recommendation references a concept
   *  that isn't yet a factor — the rationale field is the only
   *  anchor in that case. */
  by_factor_id?: number | null;
  /** The axis this is about, as the producer named it ("cell type").
   *  Survives a factor being renamed or curated away, so it is the
   *  label of last resort when ``by_factor_id`` resolves to nothing.
   *  Empty on a row that names no axis at all. */
  category?: string | null;
  /** The levels of the axis as (label, uri) PAIRS — the canonical
   *  form, and the only one that cannot desynchronise.
   *
   *  🛑 An ungrounded level keeps its pair with ``uri: ""`` rather than
   *  being dropped, so this list always agrees with ``level_labels``.
   *  Empty string means ABSTAIN, never "the level is gone".
   *
   *  Landed agents-side 2026-08-20 (`c8fe0cc`); absent on rows written
   *  before that, which is every row in the store until the next
   *  re-seed. Readers fall back to the flat projections below. */
  levels?: SubsetLevel[] | null;
  /** FV ``free_text_label`` strings within ``by_factor_id`` that
   *  define the subset. Analysis restricted to samples whose
   *  ``by_factor_id`` FV is in this list.
   *
   *  🛑 EMPTY MEANS EVERY LEVEL — that IS subset-DEA, one analysis per
   *  level — but only on a row that names an axis. On a row with no
   *  axis at all it means nothing, and saying "every level" there
   *  claims a DEA per level of nothing.
   *
   *  A flat PROJECTION of ``levels``, independently sorted. */
  level_labels: string[];
  /** The grounded levels as ontology URIs.
   *
   *  🛑 A **SET**, not an array parallel to ``level_labels`` — measured
   *  over the 60 grounded rows, 15 have a different LENGTH and all 60
   *  are independently sorted, so index `i` lines up only by
   *  coincidence. On GSE20396 zipping pairs the retinal-ganglion-CELL
   *  URI with an anatomical LAYER label. Intersect it; never zip it.
   *  Read ``levels`` when you need the pairing. */
  level_uris?: string[] | null;
  /** Curator rationale or, for ``agent_recommended`` entries, the
   *  agent's rationale from the gestalt split_recommendation. */
  rationale: string;
  /** Lifecycle state.
   *  - ``agent_recommended`` — the wire's arrival state.
   *  - ``accepted`` — curator explicitly agreed.
   *  - ``rejected`` — curator declined; preserved as a no-vote.
   *
   *  🛑 ``agent_recommended`` does NOT mean "awaiting a decision" in the
   *  UI. Paul, 2026-08-20: *"the default is to accept it unless you
   *  disagree"* — a recommendation is in effect on arrival, and reject
   *  is the only disposition the curator has to make. Never read this
   *  field directly to answer "does this apply"; ask
   *  ``isInEffect`` in ``features/design/subsetRecommendations.ts``,
   *  which is the one place that fold lives. */
  status: "agent_recommended" | "accepted" | "rejected";
  /** Provenance — three values, not two.
   *  - ``gemma`` — Gemma's own DEA already subsets on this axis. A fact
   *    being carried, not a judgement being made.
   *  - ``agent`` — our proposer recommends it.
   *  - ``curator`` — you created it. */
  source: "gemma" | "agent" | "curator";
  /** Source agent run id, for agent-recommended entries. */
  source_run_id?: string;
  /** Gemma's own factor id for the axis.
   *
   *  🛑 THIS is the identity; ``by_factor_id`` above is a LOCAL,
   *  per-row sequence number only meaningful in the row it was resolved
   *  against. Cab measured it 2026-08-20: one base-design
   *  ``by_factor_id`` copied into the polished rows bound GSE74438's
   *  organism-part levels to a GENOTYPE factor, where local id 1 is a
   *  different factor — it RESOLVED, which is worse than dangling. Any
   *  reader re-homing a recommendation re-resolves from here. */
  gemma_factor_id?: number | null;
  /** How loudly this deserves to be surfaced. Paul's four tiers.
   *
   *  Live on the wire since 2026-08-20: 63 ``convention`` / 5 ``qa`` /
   *  1 ``two_in_one`` over the 69 seeded experiments.
   *
   *  🛑 Still tolerate-null. Absent reads as "unclassified", never as
   *  tier 1 — folding null to ``none`` would hide every row authored
   *  before the field landed, and every row from a producer that does
   *  not classify. */
  tier?: SubsetTier | null;
  /** The classifier's own sentence explaining why THIS row got THIS
   *  tier — Gemma's batch verdict for ``qa``, the framing pass's split
   *  reasoning for ``two_in_one``.
   *
   *  Prose, and rendered verbatim like ``rationale``: never parsed.
   *  Distinct from ``TIER_META[tier].blurb``, which says what the tier
   *  MEANS in general; this says what happened here. */
  tier_evidence?: string | null;
}

/** One level of a subsetting axis — its label AND its grounding,
 *  together, because the pair is the object. */
export interface SubsetLevel {
  label: string;
  /** Empty string on an ungrounded level, which is kept rather than
   *  dropped so the list stays aligned with ``level_labels``. */
  uri?: string | null;
}

/** Subset tiers, most quiet first. Mirrors the agents-side
 *  ``TIER_NONE`` / ``TIER_CONVENTION`` / ``TIER_QA`` /
 *  ``TIER_TWO_IN_ONE`` constants — same strings, and they are the wire
 *  contract, so don't re-spell them here. */
export type SubsetTier = "none" | "convention" | "qa" | "two_in_one";

export interface Design {
  experiment_id: number;
  experiment_short_name: string;
  factors: Factor[];
  biomaterials: Biomaterial[];
  tags: Tag[];
  external_source?: ExternalSource | null;
  /** Curator split recommendation. ``null`` = no decision recorded.
   *  ``-1`` = curator asserted "do NOT split" (overrides any agent
   *  recommendation). Positive int = curator asserts "split on the
   *  factor with this id"; the FV partition becomes the split axis.
   *  Captures experiment-wide decisions that don't belong on any one
   *  factor — e.g. GSE319237's multi-arm load that should have
   *  shipped as N subseries split along the dominant experimental
   *  axis. */
  should_split_on_factor_id?: number | null;
  /** Curator notes explaining the split decision. Free text. Empty
   *  when no decision recorded or the curator declined to comment. */
  should_split_rationale?: string;
  /** Subset recommendations — orthogonal to the split decision above.
   *  Splitting is specialized (creates N sub-experiments); subsetting
   *  is routine (curators do it to resolve confounds or restrict
   *  analysis to one tissue / arm). Seeded by the agent's gestalt
   *  ``split_recommendations`` of kind ``dea_subset`` or
   *  ``factor_partial_coverage``; curator accepts / rejects each one
   *  and may add their own.
   *
   *  Accepted entries propagate downstream — the DEA pipeline reads
   *  them to restrict analysis scope, and future agent runs use them
   *  to decide whether a partial-coverage factor is expected (aligned
   *  with an accepted subset) or a split flag.
   */
  subset_recommendations?: SubsetRecommendation[];
  // Read-side metadata copied from Gemma at import time. Drives
  // the experiment-banner display.
  title?: string;
  description?: string;
  /** GEO series "Overall design" free-text — raw, not curated. Kept
   *  separate from ``description`` (the abstract) so the UI shows it
   *  exactly once, in the "design (GEO)" row. */
  overall_design?: string;
  taxon?: string;
  assay?: string;
  /** Gemma's authoritative technology classifier from
   *  ExpressionExperimentValueObject.technologyType. Values:
   *  ``ONECOLOR`` / ``TWOCOLOR`` (microarray, one- vs two-channel),
   *  ``SEQUENCING`` (RNA-seq), ``GENELIST`` (generic placeholder),
   *  ``OTHER``. The modality chip prefers this over text/regex
   *  inference. */
  technology_type?: string;
  platform?: string;
  /** URL-friendly platform identifier — used to build the link to
   *  Gemma's platform page. Either short_name or id is sufficient. */
  platform_short_name?: string;
  platform_id?: number | null;
  /** The platform as the source DB (typically GEO / GPL) recorded
   *  it. Distinct from Gemma's array_design when the experiment is
   *  RNA-seq and the array_design is a generic stand-in. */
  original_platform?: string;
  original_platform_short_name?: string;
  original_platform_id?: number | null;
  publications?: Publication[];
  loaded_at?: string;
  /** Siblings of a split experiment — see `DatasetMetaSlim.other_parts`.
   *  Gemma splits single-cell studies by organism part, and 52 of 100
   *  sampled single-cell datasets are a "Split part N of: …". Absent in
   *  local mode; the store serves no such field. */
  other_parts?: { id?: number | null; short_name?: string | null; name?: string | null }[];
  /** Gemma's own single-cell flag. Authoritative where present; absent
   *  in local mode and on a host predating 2026-09-03, where
   *  `inferModality` falls back to its string heuristics. */
  is_single_cell?: boolean;
  /** Total cells. `null`/absent means NOT COUNTED, never zero. */
  number_of_cells?: number;
  loaded_by?: string;
}

// ---------------------------------------------------------------------------
// Validator state
// ---------------------------------------------------------------------------

/**
 * Some factor types don't take a baseline.
 *
 *  - ``block`` / ``batch`` — nuisance variables (date_run codes,
 *    scan-batch ids, …), no "untreated" reference.
 *  - ``organism part`` / ``cell type`` — panels of tissues or cell
 *    types where any choice of baseline for DEA is arbitrary. The
 *    proposer doesn't pick one and the curator shouldn't be forced
 *    to either; DEA contrasts get specified at analysis time, not
 *    at curation time.
 *  - **Continuous factors** (e.g. age, weight, dose) have per-sample
 *    measurements rather than a finite set of FVs; "baseline" doesn't
 *    apply. Gated by ``factor.type``, not the category list.
 *
 * Returns ``true`` for factors that need exactly one baseline FV;
 * ``false`` for factors where baselines are meaningless and the
 * commit-time check should let them through.
 */
const NO_BASELINE_CATEGORIES = new Set<string>([
  "block",
  "batch",
  "organism part",
  "cell type",
  // Cell-line panels are biologically-arbitrary references — same
  // logic as cell type / organism part. Pavlidis Lab curation
  // guidelines don't require a baseline for cell line, *especially*
  // when the proposer flags the experiment as a subset-DEA candidate
  // by cell line (the ``S1_subset_verdict: subset_by_cell_line``
  // case, where each cell line gets its own DEA contrast and the
  // notion of a baseline within the factor is moot). Both
  // ``cell line`` and the underscore form ``cell_line`` show up in
  // proposer / curator output.
  "cell line",
  "cell_line",
  // How the material was obtained (biopsy / autopsy / surgical
  // resection / …). A procurement axis, not a perturbation: there's no
  // control arm to be the reference, same as organism part and cell
  // type. Curator ruling 2026-08-09, and the corpus agrees — 67 of the
  // 78 multi-level `collection of material` factors carry no baseline,
  // the profile of the exempt categories (cell line 106/114, organism
  // part 87/92, cell type 74/82) and nothing like `treatment` (7/539)
  // or `genotype` (10/513).
  "collection of material",
  "collection_of_material",
]);

/** Accepts either a ``Factor`` (preferred — captures both type and
 *  category) or a bare ``OntologyTerm`` (legacy callers that only
 *  have the category in hand). The factor-aware overload is the
 *  one to use for new call sites. */
export function factorRequiresBaseline(
  factorOrCategory: Factor | OntologyTerm | null | undefined,
): boolean {
  if (!factorOrCategory) return true;
  // Discriminate by the presence of a ``type`` field. A bare
  // OntologyTerm has ``label`` / ``uri`` but no ``type``; passing
  // one falls through to the category-only path.
  if ("type" in factorOrCategory) {
    // Per-factor agent hint wins when the proposer explicitly
    // marked the factor. ``"not_applicable"`` and ``"uncertain"``
    // both suppress the loud warning — the latter surfaces as a
    // separate soft flag the UI renders elsewhere.
    const rel = factorOrCategory.baseline_relevance;
    if (rel === "not_applicable" || rel === "uncertain") return false;
    if (factorOrCategory.type === "continuous") return false;
    const k = (factorOrCategory.category?.label || "").trim().toLowerCase();
    return !NO_BASELINE_CATEGORIES.has(k);
  }
  const k = (factorOrCategory.label || "").trim().toLowerCase();
  return !NO_BASELINE_CATEGORIES.has(k);
}

/** Tags whose category names the experiment's assay shape are
 *  load-time invariants, not curation choices — Gemma's import
 *  attaches them from the platform / technology classifier
 *  (``bulk RNA-seq``, ``single-cell RNA sequencing assay``,
 *  ``ONECOLOR``, etc.). Removing them in the UI breaks downstream
 *  modality detection and the diagnostics / pre-publish surfaces
 *  that key off ``technology_type``. The chip's × delete
 *  affordance is hidden when this returns true; the calibration
 *  remove-apply path also short-circuits.
 *
 *  Match list: ``assay`` (curator-facing label),
 *  ``technology type`` (Gemma's ExpressionExperimentValueObject
 *  field). Lower-cased + trimmed; underscore variants accepted. */
const PROTECTED_TAG_CATEGORIES = new Set<string>([
  "assay",
  "technology type",
  "technology_type",
]);

export function isProtectedTagCategory(
  categoryLabel: string | null | undefined,
): boolean {
  const k = (categoryLabel || "").trim().toLowerCase();
  return PROTECTED_TAG_CATEGORIES.has(k);
}

/** Like ``factorRequiresBaseline`` but stricter — returns ``false``
 *  for soft-baseline categories (cell line) so commit / publish
 *  gates don't block on them. Also returns false for "no-contrast"
 *  factors — a single FV or an empty FV list has nothing to
 *  baseline against, so blocking commit on baseline-count would
 *  just nag the curator to pick a baseline for a factor that
 *  carries no comparison. The warning surface still uses
 *  ``factorRequiresBaseline``, so the curator sees the bullet in
 *  the ValidatorBanner; this just controls whether they can keep
 *  moving. */
export function factorBaselineBlocksCommit(
  factor: Factor | null | undefined,
): boolean {
  if (!factorRequiresBaseline(factor)) return false;
  // No-contrast factors: ≤1 FV means there's no comparison to be
  // made, so the baseline concept doesn't apply. Continuous +
  // ontology-no-baseline categories are already filtered by
  // factorRequiresBaseline above; this catches the structural case.
  const fvCount = factor?.factor_values?.length ?? 0;
  if (fvCount <= 1) return false;
  // Gemma already has a baseline here. ``getBaselineLevels()`` takes
  // the first FV whose statements carry a recognised control term —
  // "reference substance role", "wild type genotype", "female" — with
  // no ``is_baseline`` flag needed, so marking one changes nothing
  // downstream. Asking anyway is asking for busywork, and worse, it
  // invites a curator to mark the value Gemma would NOT have chosen.
  if (factor && gemmaAutoBaselineFvs(factor).length > 0) return false;
  return true;
}

export interface FactorValidationState {
  factor_id: number;
  /** How many FVs carry the explicit mark. 0 means none. **>1 is legal**
   *  — a two-experiments-in-one dataset carries one reference per
   *  sub-experiment — so nothing may treat it as an error; the UI asks
   *  whether it was intended and moves on. */
  baseline_count: number;
  /** Whether the baseline-count rule applies to this factor at
   *  all. False for batch / block factors — those are nuisance
   *  variables and have no natural baseline. UI / commit gating
   *  should treat ``baseline_count`` as irrelevant when this is
   *  false. */
  baseline_required: boolean;
  /** Whether a missing / duplicated baseline on this factor should
   *  block the curator from committing (or publishing). Strictly
   *  ``baseline_required`` modulo ``SOFT_BASELINE_CATEGORIES``: the
   *  ValidatorBanner still shows the bullet for soft cases (cell
   *  line) so the curator considers it, but the CommitBar +
   *  PrePublishChecklist read this field instead of
   *  ``baseline_required`` and let those flow through. */
  baseline_blocks_commit: boolean;
  /** True when the proposer marked this factor's baseline as
   *  ``"uncertain"`` and no baseline has been picked. Drives the
   *  *soft* flag (small inline chip on the factor row) — distinct
   *  from the loud ValidatorBanner warning. The reason string
   *  rides alongside so the chip's hover shows the agent's
   *  rationale. False for ``required`` factors (those use the
   *  loud warning) and ``not_applicable`` factors (no signal). */
  baseline_uncertain: boolean;
  baseline_uncertain_reason: string;
  unassigned_biomaterials: string[];
  duplicate_assignments: string[]; // biomaterials assigned to >1 FV in this factor
  /** FVs with zero samples assigned. The inverse of
   *  ``unassigned_biomaterials``: that one asks "is every sample
   *  accounted for", this one asks "does every level actually describe
   *  anything". A factor can satisfy the first and still fail this —
   *  every sample assigned across three FVs while a fourth, left over
   *  from an edit or an agent proposal, holds none.
   *
   *  ADVISORY, not part of ``ok`` (Paul, 2026-08-20: "not a blocker").
   *  An empty level is legitimate mid-edit — a value the curator just
   *  added and hasn't assigned yet is the normal way to build a factor,
   *  and blocking commit on it would fire constantly during ordinary
   *  work. What it costs is downstream, not on the wire: Gemma's DEA
   *  has no samples at that level, so the level contributes no contrast
   *  and simply vanishes from the analysis.
   *
   *  Empty for continuous factors, which carry per-sample measurements
   *  rather than a discrete partition. */
  empty_factor_values: { fv_id: number; label: string }[];
  unknown_predicates: number;
  /** Statements with no Statement.category. Real Gemma requires it;
   *  the commit-time normalizer auto-fills from the factor's category,
   *  but we surface the count so curators know what was inferred. */
  statements_missing_category: number;
  /** FVs marked baseline whose statements use a non-canonical baseline
   *  term (e.g. "Baseline participant role") instead of one of the five
   *  the Curating-Baseline-Factor-Values page prefers. ADVISORY ONLY —
   *  it does not fail ``ok``: the FV is a real baseline, Gemma's DEA
   *  auto-assigns it, and the flag on the FV is what decides. The
   *  label-list per FV makes the note clickable / addressable. */
  deprecated_baseline_fvs: { fv_id: number; label: string }[];
  /** Confluence-forbidden ontologies for this category — e.g. EFO
   *  used for developmental stage, NIF used for cell type / organism
   *  part. Each entry names what's wrong + which fv carries it. */
  ontology_violations: {
    fv_id: number;
    label: string;
    rule: string;
  }[];
  /** Factor category itself is forbidden (e.g. `dose` as its own EFC). */
  forbidden_category: string | null;
  /** Categories carrying a label but no ontology `uri` — i.e. free
   *  text rather than a grounded term. Covers the factor's own category
   *  (``scope: "factor"``) and each statement category (``scope:
   *  "statement"``, with the ``fv_id`` it sits under). Gemma rejects
   *  ungrounded categories on commit, so these block commit. Distinct
   *  from ``statements_missing_category`` (no category label at all). */
  ungrounded_categories: {
    scope: "factor" | "statement";
    label: string;
    fv_id?: number;
  }[];
  /** Factor has no description text. Curators are expected to describe
   *  every experimental factor; blocks commit. */
  factor_missing_description: boolean;
  /** Subjects carrying more than ``MAX_STATEMENT_PAIRS`` (predicate,
   *  object) pairs — more than Gemma's two slots can hold. The editor
   *  no longer lets a curator build one, so these arrived from
   *  elsewhere: an agent proposal, or a snapshot predating the cap.
   *
   *  Part of ``ok`` since 2026-08-20 — it WARNS, and the design does not
   *  read as valid while one stands. It does not hard-block the commit
   *  bar (only a free-text category and an unknown predicate do), so a
   *  curator is never stranded on data they did not author.
   *
   *  🛑 **The unit is under question.** This counts pairs per
   *  ``(category, subject)`` GROUP, collapsing statement rows — while
   *  Gemma's ceiling may be per statement ROW, in which case a subject
   *  can legitimately carry two rows of two pairs and this warns on a
   *  correct annotation. That is exactly the shape a background on a
   *  compound genotype needs (1,953 subjects corpus-wide are already at
   *  two ``has_genotype`` pairs). Asked in
   *  ``CAB_TO_GEMBRO_2026_08_29_IS_THE_TWO_PAIR_CEILING_PER_STATEMENT_OR_PER_SUBJECT``;
   *  if the answer is per-row, the grouping here and in
   *  ``groupStatementsBySubject`` both have to change, together — see
   *  {@link statementGroupKey}. */
  overfull_statement_groups: {
    fv_id: number;
    subject: string;
    pairs: number;
  }[];
  /** FVs Gemma's own detector would take as the baseline without the
   *  curator marking anything — a "reference substance role" control, a
   *  "wild type genotype" arm, "female" on a sex factor. Non-empty
   *  means the factor HAS a baseline downstream, so nothing should ask
   *  for one. Mirrors ``BaselineSelection.getBaselineLevels``; the
   *  first entry is the FV it would land on. */
  gemma_auto_baseline: AutoBaselineFv[];
  /** The baseline question is answered — at least one marked FV, or
   *  Gemma detects one on its own. Consumers should read THIS rather
   *  than comparing ``baseline_count`` to 1: more than one mark is
   *  legal, so ``=== 1`` reads a deliberate design as a defect. */
  baseline_satisfied: boolean;
  /** A curator marked an FV that Gemma would NOT have recognised,
   *  while another FV in the same factor carries a term it WOULD —
   *  "male" marked baseline on a factor that has "female". The mark
   *  wins (``getIsBaseline()`` decides ahead of everything), so this
   *  silently overrides the house standard. Advisory: sometimes it is
   *  deliberate, and forcing a baseline is legitimate. Null when
   *  there's nothing to say. */
  nonstandard_marked_baseline: {
    fv_id: number;
    label: string;
    /** What Gemma would have used instead. */
    standard: string;
  } | null;
}

/** Non-canonical baseline labels. The Confluence
 *  Curating-Baseline-Factor-Values page steers curators away from these
 *  toward the five canonical terms (control / wild type genotype /
 *  reference subject role / reference substance role / initial time
 *  point).
 *
 *  They are a STYLE preference, not an error: an FV carrying one of
 *  these really is the control level, and as of 2026-08-08 Gemma's DEA
 *  auto-assigns them like any other. So the baseline DETECTOR must
 *  recognise them (see ``ALTERNATE_BASELINE_LABELS`` in
 *  ``features/design/mutations.ts``, and the browser's
 *  ``lib/baseline.ts``), and they no longer fail ``DesignValidationState.ok``.
 *  Surfaced as an advisory only, so a curator inheriting an old design
 *  can still see which FVs use the older wording.
 *
 *  Exported so the detector and the validator can't drift apart — one
 *  list, two readers. */
export const NON_CANONICAL_BASELINE_LABELS = new Set<string>([
  "baseline participant role",
  "control group",
  "control role",
  "normal control group",
  "negative control role",
  // Both numbers — Gemma's detector carries the singular too
  // (`BaselineSelection.java`, backend commit be7b55b8fe).
  "normal littermate",
  "normal littermates",
]);

/** Compare a label against the non-canonical set the way GEMMA does:
 *  case-insensitively, with underscores read as spaces, so
 *  ``Normal_Control_Group`` matches. Mirrors ``controlGroupTerms``
 *  normalization in ``BaselineSelection.java``; without the underscore
 *  rule the UI silently disagreed with the backend about whether an
 *  underscored label is a control level. */
export function isNonCanonicalBaselineLabel(
  label: string | null | undefined,
): boolean {
  const k = (label || "").trim().toLowerCase().replace(/_/g, " ");
  return NON_CANONICAL_BASELINE_LABELS.has(k);
}

/** Per-category forbidden ontology prefixes. Source: Confluence
 *  Curating-EFC §EFC Ontology Standards + per-section notes. URI
 *  prefix matched lower-cased after normalising `purl.obolibrary.org/obo/`
 *  vs `ebi.ac.uk/efo/` etc. */
function categoryForbidsOntology(
  categoryLabel: string,
  uri: string,
): string | null {
  const cat = categoryLabel.trim().toLowerCase();
  const u = uri.toLowerCase();
  // NIF is deprecated everywhere: cell type, organism part, brain region.
  if (u.includes("/nif_") || u.includes("/nifstd")) {
    return "NIF is deprecated — use UBERON for organism parts / brain regions, CL for cell types.";
  }
  if (cat === "developmental stage" || cat === "developmental_stage") {
    if (u.includes("/efo_") || u.includes("ebi.ac.uk/efo/")) {
      return "Developmental stage must use UBERON. EFO is forbidden here.";
    }
  }
  if (cat === "organism part" || cat === "cell type") {
    if (u.includes("/nif_") || u.includes("/nifstd")) {
      return `${categoryLabel} must use ${cat === "organism part" ? "UBERON" : "CL"}. NIF is deprecated.`;
    }
  }
  return null;
}

export interface DesignValidationState {
  factors: FactorValidationState[];
  ok: boolean;
}

// Predicate allow-list mirroring Confluence
// Use-of-predicates-in-factor-values. Imported from the generated
// module sourced from ``gemma-curation-agents/data/predicates.json``
// — one source of truth for the agents Python and this UI. The
// validator flags any URI not in this set as ``unknown_predicates``.
import { KNOWN_PREDICATE_URIS } from "@/generated/predicates";
import { curieToUrl } from "@/lib/curie";

export function validateDesign(design: Design): DesignValidationState {
  const allBmNames = new Set(design.biomaterials.map((b) => b.short_name));
  const factorStates: FactorValidationState[] = design.factors.map((f) => {
    const seen = new Map<string, number>();
    let unknownPredicates = 0;
    let baselineCount = 0;
    let stmtsMissingCategory = 0;
    const deprecatedBaselineFvs: { fv_id: number; label: string }[] = [];
    const ontologyViolations: {
      fv_id: number;
      label: string;
      rule: string;
    }[] = [];
    const ungroundedCategories: {
      scope: "factor" | "statement";
      label: string;
      fv_id?: number;
    }[] = [];
    const overfullStatementGroups: {
      fv_id: number;
      subject: string;
      pairs: number;
    }[] = [];

    // Factor category must be a grounded ontology term, not free text.
    // A label with no ``uri`` is free text; Gemma rejects it on commit.
    const factorCatRaw = (f.category?.label || "").trim();
    if (factorCatRaw && !f.category?.uri) {
      ungroundedCategories.push({ scope: "factor", label: factorCatRaw });
    }

    // Factor-category itself: `dose` should never be its own EFC.
    const factorCatLabel = factorCatRaw.toLowerCase();
    let forbiddenCategory: string | null = null;
    if (factorCatLabel === "dose") {
      forbiddenCategory =
        "`dose` should never be its own EFC. Attach to a Treatment FV via `delivered at dose` (TGEMO_00166) or `delivered for duration` (TGEMO_00167).";
    }
    for (const fv of f.factor_values) {
      if (fv.is_baseline) baselineCount++;
      // If this FV is marked baseline, scan its statements +
      // free-text label for any of the forbidden baseline terms.
      // Statements always have subject/object; the baseline term
      // typically appears as the object of `has role` or as a
      // subject when using the term directly.
      if (fv.is_baseline) {
        const candidates: string[] = [
          fv.free_text_label,
          ...fv.statements.flatMap((s) => [
            s.subject?.label ?? "",
            s.object?.label ?? "",
          ]),
        ];
        for (const c of candidates) {
          if (isNonCanonicalBaselineLabel(c)) {
            deprecatedBaselineFvs.push({ fv_id: fv.id, label: c.trim() });
            break;
          }
        }
      }
      for (const sn of fv.biomaterial_short_names) {
        seen.set(sn, (seen.get(sn) ?? 0) + 1);
      }
      // Pairs per STATEMENT — the unit Gemma's ceiling applies to.
      //
      // 🛑 This counted per `(category, subject)` group until
      // 2026-08-29, which flagged a shape that is correct and fully
      // stored. Gemma caps ONE statement at two pairs, but a
      // `FactorValue` holds a `Set<Statement>` and nothing makes two
      // statements differ in subject — `Statement.equals` folds in all
      // four pair fields, so two statements on one subject both
      // persist. A subject already carrying two pairs takes a third in
      // a SECOND statement, which is the only way to put a background
      // on a compound genotype, and 1,953 subjects corpus-wide are
      // already at two `has_genotype` pairs. Warning there would have
      // fired on the right answer across that whole population.
      //
      // Rows sharing a `gemma_id` are one statement's pairs; a row
      // without one is a curator's new pair, which becomes its own
      // statement. Placeholder rows (subject named, pair not filled in)
      // don't count — an in-progress "+ pred/obj" row would otherwise
      // flag the moment it appeared.
      const pairsByStatement = new Map<string, { subject: string; n: number }>();
      for (const s of fv.statements) {
        if (!statementHasPair(s)) continue;
        if (s.gemma_id == null) continue;
        const k = String(s.gemma_id);
        const entry = pairsByStatement.get(k) ?? {
          subject: s.subject?.label ?? "",
          n: 0,
        };
        entry.n++;
        pairsByStatement.set(k, entry);
      }
      for (const { subject, n } of pairsByStatement.values()) {
        if (n > MAX_STATEMENT_PAIRS) {
          overfullStatementGroups.push({ fv_id: fv.id, subject, pairs: n });
        }
      }
      for (const s of fv.statements) {
        // Every predicate must be a grounded preset ontology term.
        if (s.predicate && s.predicate.uri) {
          // Canonicalise the namespace before the allow-list check.
          // Legacy / mis-namespaced snapshots emit TGEMO (Gemma's own
          // ontology) under the OBO purl — e.g.
          // ``…/obo/TGEMO_00168`` instead of the canonical
          // ``…/gemma.msl.ubc.ca/ont/TGEMO_00168``. curieToUrl (which
          // the rest of the app already routes URIs through) rewrites
          // it to canonical, so a genuinely-known predicate under a
          // stale namespace no longer false-flags as "unknown".
          const canonicalUri = curieToUrl(s.predicate.uri) ?? s.predicate.uri;
          if (!KNOWN_PREDICATE_URIS.has(canonicalUri)) {
            unknownPredicates++;
          }
        } else if (s.predicate && (s.predicate.label || "").trim()) {
          // Predicate present as free text (label, no uri): not a preset
          // term. Previously slipped through — the check only looked at
          // predicates that already carried a uri.
          unknownPredicates++;
        }
        const stmtCatRaw = (s.category?.label || "").trim();
        if (!s.category || !stmtCatRaw) {
          stmtsMissingCategory++;
        } else if (!s.category.uri) {
          // Category present as free text (label, no ontology uri).
          ungroundedCategories.push({
            scope: "statement",
            label: stmtCatRaw,
            fv_id: fv.id,
          });
        }
        // Ontology-quality rules per category. Apply to subject /
        // object URIs against the Statement's category (falls back
        // to factor category when the statement doesn't carry one).
        const stmtCatLabel =
          (s.category?.label || "").trim() || (f.category?.label || "");
        for (const term of [s.subject, s.object]) {
          if (!term || !term.uri) continue;
          const violation = categoryForbidsOntology(stmtCatLabel, term.uri);
          if (violation) {
            ontologyViolations.push({
              fv_id: fv.id,
              label: term.label,
              rule: violation,
            });
          }
        }
      }
    }
    // Continuous factors carry per-sample measurements rather than a
    // discrete FV partition: "every sample assigned to one FV" and
    // "exactly one baseline FV" don't apply. Skip both checks.
    const isContinuous = f.type === "continuous";
    const unassigned = isContinuous
      ? []
      : [...allBmNames].filter((n) => !seen.has(n)).sort();
    // Levels nothing landed on. Named by the same rule the FV card
    // titles itself by — its own label, falling back to the subject of
    // its single statement — so the advisory names what the curator
    // sees on the card rather than a bare id.
    const emptyFvs = isContinuous
      ? []
      : f.factor_values
          .filter((fv) => fv.biomaterial_short_names.length === 0)
          .map((fv) => ({
            fv_id: fv.id,
            label:
              (fv.free_text_label || "").trim() ||
              (fv.statements.length === 1
                ? (fv.statements[0].subject?.label || "").trim()
                : "") ||
              `FV ${fv.id}`,
          }));
    const duplicates = [...seen.entries()]
      .filter(([, n]) => n > 1)
      .map(([sn]) => sn)
      .sort();
    const uncertain =
      f.baseline_relevance === "uncertain" && baselineCount === 0;
    // What Gemma would do with this factor if nobody marked anything.
    const autoBaseline = isContinuous ? [] : gemmaAutoBaselineFvs(f);
    // More than one marked baseline is ALLOWED (Paul, 2026-08-19). It is
    // the right answer when a dataset is really two experiments in one —
    // Gemma's own ``SplitExperimentServiceImpl`` clones the flag onto
    // each split's factor values, so one baseline per resulting
    // experiment is the model. The UI asks whether the curator meant it
    // (a slate FactorNotes row) and never calls it invalid.
    const baselineSatisfied = baselineCount >= 1 || autoBaseline.length > 0;
    // A marked FV that Gemma wouldn't have recognised, on a factor
    // where it would have recognised something else. The mark wins, so
    // "male" quietly becomes the reference on a factor holding
    // "female".
    let nonstandardMarked: FactorValidationState["nonstandard_marked_baseline"] =
      null;
    if (baselineCount === 1 && autoBaseline.length > 0) {
      const marked = f.factor_values.find((fv) => fv.is_baseline);
      if (marked && !gemmaAutoDetectsBaseline(marked)) {
        nonstandardMarked = {
          fv_id: marked.id,
          label: marked.free_text_label,
          standard: autoBaseline[0].matched,
        };
      }
    }
    return {
      factor_id: f.id,
      baseline_count: baselineCount,
      gemma_auto_baseline: autoBaseline,
      baseline_satisfied: baselineSatisfied,
      nonstandard_marked_baseline: nonstandardMarked,
      baseline_required: factorRequiresBaseline(f),
      baseline_blocks_commit: factorBaselineBlocksCommit(f),
      baseline_uncertain: uncertain,
      baseline_uncertain_reason: uncertain
        ? f.baseline_relevance_reason || ""
        : "",
      unassigned_biomaterials: unassigned,
      duplicate_assignments: duplicates,
      empty_factor_values: emptyFvs,
      unknown_predicates: unknownPredicates,
      statements_missing_category: stmtsMissingCategory,
      deprecated_baseline_fvs: deprecatedBaselineFvs,
      ontology_violations: ontologyViolations,
      forbidden_category: forbiddenCategory,
      ungrounded_categories: ungroundedCategories,
      factor_missing_description: !(f.description || "").trim(),
      overfull_statement_groups: overfullStatementGroups,
    };
  });
  // A design with zero factors isn't "valid" — it's empty. The
  // banner / commit-gate consumers want a definite no for that case
  // rather than the vacuous ``[].every(...) === true`` (caught
  // 2026-04-29: a curator who accepted-then-rejected a proposal
  // before commit landed on an empty design and saw "✓ design
  // valid").
  const ok =
    factorStates.length > 0 &&
    factorStates.every(
      (s) =>
        // Baseline rule only applies to factors that require a
        // baseline. Batch / block factors flow through regardless, and
        // so does a factor Gemma already reads a baseline off (a
        // "female" sex FV, a "reference substance role" control) —
        // marking it would change nothing downstream.
        (!s.baseline_required || s.baseline_satisfied) &&
        s.unassigned_biomaterials.length === 0 &&
        s.duplicate_assignments.length === 0 &&
        s.unknown_predicates === 0 &&
        s.statements_missing_category === 0 &&
        // 🛑 Over Gemma's two-slot ceiling is a WARNING, not an
        // advisory. Paul, 2026-08-20: *"if that happens, the ui has to
        // warn. Gemma only supports 2."* It used to route to the quiet
        // notes channel, which put "a subject carries more than 2
        // predicate/object pairs" inside a green **✓ design valid**
        // box — the header flatly contradicting the line beneath it,
        // over a design that loses a clause the moment it is written
        // back. `AnnotationValueObject` has `predicate`/`object` and
        // `secondPredicate`/`secondObject`, and no third.
        s.overfull_statement_groups.length === 0 &&
        // ``deprecated_baseline_fvs`` deliberately absent: a non-canonical
        // baseline label is a wording preference, not a broken design.
        // It used to fail here on the premise that Gemma wouldn't
        // auto-assign those terms, which stopped being true 2026-08-08.
        s.ontology_violations.length === 0 &&
        s.forbidden_category === null &&
        s.ungrounded_categories.length === 0 &&
        !s.factor_missing_description,
    );
  return { factors: factorStates, ok };
}
