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

export interface OntologyTerm {
  label: string;
  uri?: string | null;
}

export interface Statement {
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
}

export interface FactorValue {
  id: number;
  free_text_label: string;
  is_baseline: boolean;
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
  factor_values: FactorValue[];
}

export interface BioAssay {
  /** Typically the GSM accession. */
  short_name: string;
  /** Descriptive title — the value curators key off when scanning a
   *  cohort. */
  name: string;
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

export interface Publication {
  pubmed_id: string;
  doi: string;
  citation: string;
  title: string;
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
  /** FV ``free_text_label`` strings within ``by_factor_id`` that
   *  define the subset. Analysis restricted to samples whose
   *  ``by_factor_id`` FV is in this list. */
  level_labels: string[];
  /** Curator rationale or, for ``agent_recommended`` entries, the
   *  agent's rationale from the gestalt split_recommendation. */
  rationale: string;
  /** Lifecycle state.
   *  - ``agent_recommended`` — agent suggested; pending curator.
   *  - ``accepted`` — curator agreed; downstream tools respect.
   *  - ``rejected`` — curator declined; preserved as a no-vote. */
  status: "agent_recommended" | "accepted" | "rejected";
  /** Provenance. */
  source: "agent" | "curator";
  /** Source agent run id, for agent-recommended entries. */
  source_run_id?: string;
}

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
  return true;
}

export interface FactorValidationState {
  factor_id: number;
  baseline_count: number;          // 0 means missing, >1 means duplicates
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
  "normal littermates",
]);

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
          const k = (c || "").trim().toLowerCase();
          if (NON_CANONICAL_BASELINE_LABELS.has(k)) {
            deprecatedBaselineFvs.push({ fv_id: fv.id, label: c.trim() });
            break;
          }
        }
      }
      for (const sn of fv.biomaterial_short_names) {
        seen.set(sn, (seen.get(sn) ?? 0) + 1);
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
    const duplicates = [...seen.entries()]
      .filter(([, n]) => n > 1)
      .map(([sn]) => sn)
      .sort();
    const uncertain =
      f.baseline_relevance === "uncertain" && baselineCount === 0;
    return {
      factor_id: f.id,
      baseline_count: baselineCount,
      baseline_required: factorRequiresBaseline(f),
      baseline_blocks_commit: factorBaselineBlocksCommit(f),
      baseline_uncertain: uncertain,
      baseline_uncertain_reason: uncertain
        ? f.baseline_relevance_reason || ""
        : "",
      unassigned_biomaterials: unassigned,
      duplicate_assignments: duplicates,
      unknown_predicates: unknownPredicates,
      statements_missing_category: stmtsMissingCategory,
      deprecated_baseline_fvs: deprecatedBaselineFvs,
      ontology_violations: ontologyViolations,
      forbidden_category: forbiddenCategory,
      ungrounded_categories: ungroundedCategories,
      factor_missing_description: !(f.description || "").trim(),
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
        // Baseline-count rule only applies to factors that require a
        // baseline. Batch / block factors flow through regardless.
        (!s.baseline_required || s.baseline_count === 1) &&
        s.unassigned_biomaterials.length === 0 &&
        s.duplicate_assignments.length === 0 &&
        s.unknown_predicates === 0 &&
        s.statements_missing_category === 0 &&
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
