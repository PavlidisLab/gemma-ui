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
}

export type FactorType = "categorical" | "continuous";

export interface Factor {
  id: number;
  name: string;
  category: OntologyTerm;
  description: string;
  type: FactorType;
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
}

export interface Tag {
  /** Stable identity for diff/edit. Server-assigned; the UI uses
   *  optimistic numeric IDs for new tags before the round-trip. */
  id: number;
  category: OntologyTerm;
  value: OntologyTerm;
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

export interface Design {
  experiment_id: number;
  experiment_short_name: string;
  factors: Factor[];
  biomaterials: Biomaterial[];
  tags: Tag[];
  external_source?: ExternalSource | null;
  // Read-side metadata copied from Gemma at import time. Drives
  // the experiment-banner display.
  title?: string;
  description?: string;
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
 * Some factor types don't take a baseline. Batch / block factors
 * are the canonical case — they're nuisance variables, not
 * experimental conditions, so there's no "untreated" or
 * "wild-type" reference value to mark. Gemma uses ``block`` as the
 * category label (sometimes ``batch``); both should bypass the
 * baseline-required validation.
 *
 * Returns ``true`` for factors that need exactly one baseline FV;
 * ``false`` for factors where baselines are meaningless and the
 * commit-time check should let them through.
 */
const NO_BASELINE_CATEGORIES = new Set<string>([
  "block",
  "batch",
]);

export function factorRequiresBaseline(
  category: OntologyTerm | null | undefined,
): boolean {
  const k = (category?.label || "").trim().toLowerCase();
  return !NO_BASELINE_CATEGORIES.has(k);
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
  unassigned_biomaterials: string[];
  duplicate_assignments: string[]; // biomaterials assigned to >1 FV in this factor
  unknown_predicates: number;
  /** Statements with no Statement.category. Real Gemma requires it;
   *  the commit-time normalizer auto-fills from the factor's category,
   *  but we surface the count so curators know what was inferred. */
  statements_missing_category: number;
  /** FVs marked baseline whose statements use a Confluence-forbidden
   *  baseline term (e.g. "Baseline participant role"). Per the
   *  Curating-Baseline-Factor-Values page, these are not auto-assigned
   *  by Gemma's DEA pipeline. The label-list per FV makes the warning
   *  clickable / addressable. */
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
}

/** Confluence-forbidden baseline labels — DEA won't pick these up
 *  as the baseline. Source: Curating-Baseline-Factor-Values §Note. */
const DEPRECATED_BASELINE_LABELS = new Set<string>([
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

    // Factor-category itself: `dose` should never be its own EFC.
    const factorCatLabel = (f.category?.label || "").trim().toLowerCase();
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
          if (DEPRECATED_BASELINE_LABELS.has(k)) {
            deprecatedBaselineFvs.push({ fv_id: fv.id, label: c.trim() });
            break;
          }
        }
      }
      for (const sn of fv.biomaterial_short_names) {
        seen.set(sn, (seen.get(sn) ?? 0) + 1);
      }
      for (const s of fv.statements) {
        if (s.predicate && s.predicate.uri && !KNOWN_PREDICATE_URIS.has(s.predicate.uri)) {
          unknownPredicates++;
        }
        if (!s.category || !(s.category.label || "").trim()) {
          stmtsMissingCategory++;
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
    const unassigned = [...allBmNames].filter((n) => !seen.has(n)).sort();
    const duplicates = [...seen.entries()]
      .filter(([, n]) => n > 1)
      .map(([sn]) => sn)
      .sort();
    return {
      factor_id: f.id,
      baseline_count: baselineCount,
      baseline_required: factorRequiresBaseline(f.category),
      unassigned_biomaterials: unassigned,
      duplicate_assignments: duplicates,
      unknown_predicates: unknownPredicates,
      statements_missing_category: stmtsMissingCategory,
      deprecated_baseline_fvs: deprecatedBaselineFvs,
      ontology_violations: ontologyViolations,
      forbidden_category: forbiddenCategory,
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
        s.deprecated_baseline_fvs.length === 0 &&
        s.ontology_violations.length === 0 &&
        s.forbidden_category === null,
    );
  return { factors: factorStates, ok };
}
