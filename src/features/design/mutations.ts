/**
 * Pure transformation functions on a Design.
 *
 * Each function takes a Design and returns a new Design. The
 * DesignEditor uses these to build the next state, then PUTs the whole
 * design via the optimistic-updating mutation hook.
 *
 * Keeping them pure (no React, no API calls) makes them trivially
 * testable.
 */

import type {
  Design,
  Factor,
  FactorType,
  FactorValue,
  OntologyTerm,
  Statement,
  Tag,
} from "@/features/experiment/types";
import { baselineFor, HAS_ROLE_PREDICATE } from "./baselineForCategory";
import { factorFromTemplate, type FactorTemplate } from "./factorTemplates";

/** Confluence baseline-term labels used to detect whether an FV
 *  already carries a baseline-style statement. Match casing-loose. */
const BASELINE_TERM_LABELS = new Set<string>([
  "control",
  "wild type genotype",
  "reference subject role",
  "reference substance role",
  "initial time point",
]);

function fvHasBaselineStatement(fv: FactorValue): boolean {
  for (const s of fv.statements) {
    const subj = (s.subject?.label || "").trim().toLowerCase();
    const obj = (s.object?.label || "").trim().toLowerCase();
    if (BASELINE_TERM_LABELS.has(subj) || BASELINE_TERM_LABELS.has(obj)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function mapFactor(
  design: Design,
  factorId: number,
  fn: (f: Factor) => Factor,
): Design {
  return {
    ...design,
    factors: design.factors.map((f) => (f.id === factorId ? fn(f) : f)),
  };
}

function mapFactorValue(
  design: Design,
  factorId: number,
  fvId: number,
  fn: (fv: FactorValue) => FactorValue,
): Design {
  return mapFactor(design, factorId, (f) => ({
    ...f,
    factor_values: f.factor_values.map((fv) => (fv.id === fvId ? fn(fv) : fv)),
  }));
}

/**
 * Mock-side ID assignment: pick max(existing) + 1 for the relevant scope.
 * Real Gemma will assign these server-side; we assign here so the
 * optimistic UI has a stable handle before the round-trip completes.
 */
function nextFvId(design: Design): number {
  let max = 0;
  for (const f of design.factors)
    for (const fv of f.factor_values)
      if (fv.id > max) max = fv.id;
  return max + 1;
}

// ---------------------------------------------------------------------------
// Public mutators
// ---------------------------------------------------------------------------

/** Mock-side ID assignment for new factors — same approach as
 *  ``nextFvId``. */
function nextFactorId(design: Design): number {
  let max = 0;
  for (const f of design.factors) if (f.id > max) max = f.id;
  return max + 1;
}

/**
 * Append a new (blank) Factor. Returns the next Design plus the new
 * factor's id so the caller can auto-select it.
 *
 * Defaults: blank name, blank category (curator fills it in via the
 * picker), categorical type, no factor values yet. The validator
 * will surface "no factor values" once the curator starts looking
 * at it.
 */
export function addFactor(design: Design): { design: Design; factorId: number } {
  const id = nextFactorId(design);
  const newFactor: Factor = {
    id,
    name: "",
    category: { label: "", uri: null },
    description: "",
    type: "categorical",
    factor_values: [],
  };
  return {
    design: { ...design, factors: [...design.factors, newFactor] },
    factorId: id,
  };
}

/**
 * Insert a Factor pre-filled from a ``FactorTemplate`` (light
 * recipes for common EFCs — treatment, genotype, disease, …). The
 * template carries the canonical category URI plus an optional
 * baseline FV stub; subsequent FVs / statements pick up the right
 * predicates via the existing per-statement template picker
 * (``statementTemplates.templatesFor(category)``).
 */
export function addFactorFromTemplate(
  design: Design,
  template: FactorTemplate,
): { design: Design; factorId: number } {
  const factorId = nextFactorId(design);
  // Templates may seed multiple FVs (vehicle + drug, wild-type +
  // knockout, etc.). Allocate ids monotonically within this single
  // call — ``nextFvId(design)`` always recomputes off the base
  // design, so we increment a counter beyond it for each new FV.
  let nextId = nextFvId(design);
  const newFactor = factorFromTemplate(template, factorId, () => nextId++);
  return {
    design: { ...design, factors: [...design.factors, newFactor] },
    factorId,
  };
}

/**
 * Delete a Factor by id. Cascades: the factor's FVs disappear with
 * it, which also removes their biomaterial assignments under that
 * factor — biomaterials assigned only to FVs in this factor become
 * "unassigned" elsewhere (other factors are unchanged).
 */
export function deleteFactor(design: Design, factorId: number): Design {
  return {
    ...design,
    factors: design.factors.filter((f) => f.id !== factorId),
  };
}

/**
 * Patch any subset of editable Factor fields (name, description,
 * type, category). When the category changes, propagate the new
 * default to any statements whose category previously matched the
 * old factor category — divergent statements are left alone (those
 * are deliberate per-statement overrides).
 */
export function setFactorFields(
  design: Design,
  factorId: number,
  patch: Partial<{
    name: string;
    description: string;
    type: FactorType;
    category: OntologyTerm;
  }>,
): Design {
  return mapFactor(design, factorId, (f) => {
    const next: Factor = { ...f, ...patch };
    if (patch.category && !sameTerm(patch.category, f.category)) {
      // Re-stamp matching statement categories to the new factor
      // category. Statements whose category already differs from the
      // factor's old category were curator-set on purpose; preserve
      // them.
      next.factor_values = f.factor_values.map((fv) => ({
        ...fv,
        statements: fv.statements.map((s) =>
          sameTerm(s.category ?? null, f.category)
            ? { ...s, category: { ...patch.category! } }
            : s,
        ),
      }));
    }
    return next;
  });
}

function sameTerm(
  a: OntologyTerm | null | undefined,
  b: OntologyTerm | null | undefined,
): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a.label === b.label && (a.uri ?? null) === (b.uri ?? null);
}

export function setFvLabel(
  design: Design,
  factorId: number,
  fvId: number,
  free_text_label: string,
): Design {
  return mapFactorValue(design, factorId, fvId, (fv) => ({
    ...fv,
    free_text_label,
  }));
}

/**
 * Toggle baseline within a factor; turning a non-baseline FV into the
 * baseline unmarks all others in the same factor (Gemma allows exactly
 * one baseline per factor).
 */
export function toggleBaseline(
  design: Design,
  factorId: number,
  fvId: number,
): Design {
  return mapFactor(design, factorId, (f) => {
    const target = f.factor_values.find((fv) => fv.id === fvId);
    if (!target) return f;
    const turningOn = !target.is_baseline;

    // When turning on, if this FV doesn't already carry a baseline
    // term in any statement, inject the canonical baseline for the
    // factor's category (Confluence Curating-Baseline-Factor-Values).
    // For genotype / timepoint we use the term as the subject directly
    // (`wild type genotype` / `initial time point`). For everything
    // else we use the curator's existing FV label as the subject and
    // attach the baseline via `has role`.
    const tpl = turningOn ? baselineFor(f.category) : null;

    return {
      ...f,
      factor_values: f.factor_values.map((fv) => {
        if (fv.id !== fvId) {
          // Other FVs lose baseline if we're turning one on.
          return {
            ...fv,
            is_baseline: turningOn ? false : fv.is_baseline,
          };
        }
        if (!turningOn) {
          // Turning off: just flip the flag, keep statements.
          return { ...fv, is_baseline: false };
        }
        // Turning on. If the FV already carries a baseline term
        // (curator set one manually), don't touch the statements.
        if (fvHasBaselineStatement(fv) || !tpl) {
          return { ...fv, is_baseline: true };
        }
        // Inject the canonical baseline statement.
        const cat = f.category ? { ...f.category } : null;
        const newStmt: Statement = tpl.asStandalone
          ? {
              category: cat,
              subject: { ...tpl.baselineTerm },
            }
          : {
              category: cat,
              subject: {
                label: (fv.free_text_label || tpl.fvLabel).trim() || tpl.fvLabel,
              },
              predicate: { ...HAS_ROLE_PREDICATE },
              object: { ...tpl.baselineTerm },
            };
        // Drop any leading empty placeholder statement (the one the
        // FV ships with by default has subject.label === ""); replace
        // it rather than ending up with a stray blank row.
        const compacted = fv.statements.filter(
          (s) =>
            (s.subject?.label || "").trim() ||
            (s.predicate?.label || "").trim() ||
            (s.object?.label || "").trim(),
        );
        return {
          ...fv,
          is_baseline: true,
          // If no FV label set, take the template's suggested label.
          free_text_label: fv.free_text_label || tpl.fvLabel,
          statements: [newStmt, ...compacted],
        };
      }),
    };
  });
}

export function addFactorValue(design: Design, factorId: number): Design {
  const id = nextFvId(design);
  const factor = design.factors.find((f) => f.id === factorId);
  const newFv: FactorValue = {
    id,
    free_text_label: "",
    is_baseline: false,
    // New statements default-inherit the parent factor's category;
    // the curator can override per statement if the FV combines
    // multiple categories.
    statements: [
      {
        category: factor?.category ? { ...factor.category } : null,
        subject: { label: "" },
      },
    ],
    biomaterial_short_names: [],
  };
  return mapFactor(design, factorId, (f) => ({
    ...f,
    factor_values: [...f.factor_values, newFv],
  }));
}

export function deleteFactorValue(
  design: Design,
  factorId: number,
  fvId: number,
): Design {
  return mapFactor(design, factorId, (f) => ({
    ...f,
    factor_values: f.factor_values.filter((fv) => fv.id !== fvId),
  }));
}

export function addStatement(
  design: Design,
  factorId: number,
  fvId: number,
): Design {
  const factor = design.factors.find((f) => f.id === factorId);
  const defaultCategory = factor?.category ? { ...factor.category } : null;
  return mapFactorValue(design, factorId, fvId, (fv) => ({
    ...fv,
    // Default-inherit the factor's category. If the FV already has
    // statements with a divergent category (e.g. the user explicitly
    // set one to "treatment" inside a "genotype" factor), prefer the
    // last-edited statement's category as the more likely intent.
    statements: [
      ...fv.statements,
      {
        category: fv.statements.length
          ? (fv.statements[fv.statements.length - 1].category ?? defaultCategory)
          : defaultCategory,
        subject: { label: "" },
      },
    ],
  }));
}

/**
 * Append a "sibling" statement to an FV — same category and subject
 * as ``seed``, but no predicate / object. Use for the "+ sibling"
 * action inside a ``StatementGroupEditor`` where the curator's
 * intent is "another claim about this same subject" (e.g. "drug X
 * delivered at dose Y" → "drug X delivered for duration Z"). Spares
 * the curator re-typing the subject + re-confirming the category
 * picker for every additional statement.
 */
export function addSiblingStatement(
  design: Design,
  factorId: number,
  fvId: number,
  seed: Statement,
): Design {
  return mapFactorValue(design, factorId, fvId, (fv) => ({
    ...fv,
    statements: [
      ...fv.statements,
      {
        category: seed.category ? { ...seed.category } : null,
        subject: { ...seed.subject },
        // Predicate + object intentionally blank — curator picks them
        // (often via the per-FV statement-template menu, which already
        // narrows to the right predicates for the factor's category).
      },
    ],
  }));
}

/**
 * Apply an agent proposal's tags and factors to the design draft.
 *
 * Tags: each ``TagProposal`` is appended as a new direct (non-
 * inferred) Tag. Duplicate URI/label pairs are skipped — the curator
 * doesn't want a doubled tag if they accept a proposal whose tag was
 * already attached.
 *
 * Factors: each ``FactorProposal`` becomes a new Factor with its
 * factor values. We assign fresh IDs (negative offsets keyed off
 * the existing max) so the diff machinery treats them as added.
 *
 * Sample assignments and Statement subject/predicate/object are
 * carried over verbatim. The curator commits via the normal Save
 * flow afterwards — same code path as if they'd built the tags /
 * factors by hand.
 */
export function applyProposalToDesign(
  design: Design,
  proposalTags: {
    category: { label: string; uri?: string | null };
    value: { label: string; uri?: string | null };
  }[],
  proposalFactors: {
    category: { label: string; uri?: string | null };
    name_in_design: string;
    factor_values: {
      free_text_label: string;
      is_baseline: boolean;
      statements: {
        category?: { label: string; uri?: string | null } | null;
        subject: { label: string; uri?: string | null };
        predicate?: { label: string; uri?: string | null } | null;
        object?: { label: string; uri?: string | null } | null;
      }[];
      biomaterial_short_names: string[];
    }[];
  }[],
): Design {
  // -- Tags --------------------------------------------------------
  const existing = design.tags ?? [];
  const seenKeys = new Set(
    existing.map((t) => tagKey(t.category, t.value)),
  );
  let nextTagId =
    existing.reduce((m, t) => Math.max(m, t.id), 0) + 1;
  const newTags: Tag[] = [];
  for (const p of proposalTags) {
    const k = tagKey(p.category, p.value);
    if (seenKeys.has(k)) continue;
    seenKeys.add(k);
    newTags.push({
      id: nextTagId++,
      category: { label: p.category.label, uri: p.category.uri ?? null },
      value: { label: p.value.label, uri: p.value.uri ?? null },
      inferred: false,
      // Curator vouched for the proposed tag on accept — that's IC
      // by the same logic as a hand-typed tag (the curator's signoff
      // is the assertion). Provenance of the *proposal* (which agent
      // drafted it) lives in audit/feedback logs, not the evidence
      // code. Note: a subsequent ``--strip-curation`` re-import
      // treats IC as a curator artifact and drops it, which is the
      // desired behaviour for skeletonize.
      evidence_code: "IC",
    });
  }

  // -- Factors -----------------------------------------------------
  const existingFactors = design.factors ?? [];
  let nextFactorId =
    existingFactors.reduce((m, f) => Math.max(m, f.id), 0) + 1;
  let nextFvId = nextFvIdValue(design);
  const addedFactors: Factor[] = proposalFactors.map((p) => {
    const factorId = nextFactorId++;
    const factor: Factor = {
      id: factorId,
      name: p.name_in_design || p.category.label,
      category: { label: p.category.label, uri: p.category.uri ?? null },
      description: "",
      type: "categorical",
      factor_values: p.factor_values.map((fv) => ({
        id: nextFvId++,
        free_text_label: fv.free_text_label,
        is_baseline: fv.is_baseline,
        biomaterial_short_names: [...fv.biomaterial_short_names],
        statements: fv.statements.map((s) => ({
          category: s.category
            ? { label: s.category.label, uri: s.category.uri ?? null }
            : { label: p.category.label, uri: p.category.uri ?? null },
          subject: { label: s.subject.label, uri: s.subject.uri ?? null },
          predicate: s.predicate
            ? { label: s.predicate.label, uri: s.predicate.uri ?? null }
            : null,
          object: s.object
            ? { label: s.object.label, uri: s.object.uri ?? null }
            : null,
        })),
      })),
    };
    return factor;
  });

  return {
    ...design,
    tags: [...existing, ...newTags],
    factors: [...existingFactors, ...addedFactors],
  };
}

/**
 * Inverse of ``applyProposalToDesign``. Removes from the draft any
 * tags / factors whose identity matches a proposal item AND that
 * isn't present in ``saved`` (i.e. wasn't there before the
 * proposal was accepted). Used when the curator rejects a proposal
 * they previously accepted — the rejection should retract the
 * applied changes, not just flip the proposal's status.
 *
 * Tag match: lower-cased ``(category, value)`` URI-or-label pair —
 * same key ``applyProposalToDesign`` uses for dedup.
 *
 * Factor match: matches by ``category.label`` + ``name``. Only
 * removes draft factors whose id is *not* in ``saved`` so a
 * pre-existing factor with the same name survives reject.
 *
 * Idempotent: if the proposal was never applied (or the curator
 * already deleted the items by hand), this is a no-op.
 */
export function removeAppliedProposalFromDesign(
  design: Design,
  saved: Design | null,
  proposalTags: {
    category: { label: string; uri?: string | null };
    value: { label: string; uri?: string | null };
  }[],
  proposalFactors: {
    category: { label: string; uri?: string | null };
    name_in_design: string;
  }[],
): Design {
  const proposalTagKeys = new Set(
    proposalTags.map((t) => tagKey(t.category, t.value)),
  );
  const savedTagKeys = new Set(
    (saved?.tags ?? []).map((t) => tagKey(t.category, t.value)),
  );
  const remainingTags = (design.tags ?? []).filter((t) => {
    const k = tagKey(t.category, t.value);
    if (!proposalTagKeys.has(k)) return true;
    // Was this tag already in saved? Don't touch it if so.
    return savedTagKeys.has(k);
  });

  const proposalFactorKeys = new Set(
    proposalFactors.map((f) =>
      `${(f.name_in_design || f.category.label || "").toLowerCase()}||${(
        f.category.label || ""
      ).toLowerCase()}`,
    ),
  );
  const savedFactorIds = new Set((saved?.factors ?? []).map((f) => f.id));
  const remainingFactors = (design.factors ?? []).filter((f) => {
    const k = `${(f.name || f.category.label || "").toLowerCase()}||${(
      f.category.label || ""
    ).toLowerCase()}`;
    if (!proposalFactorKeys.has(k)) return true;
    // Pre-existing factor (id present in saved) — don't remove even
    // if the name happens to match the proposal.
    return savedFactorIds.has(f.id);
  });

  return {
    ...design,
    tags: remainingTags,
    factors: remainingFactors,
  };
}

function tagKey(
  cat: { label: string; uri?: string | null },
  val: { label: string; uri?: string | null },
): string {
  const c = (cat.uri || cat.label || "").toLowerCase();
  const v = (val.uri || val.label || "").toLowerCase();
  return `${c}${v}`;
}

function nextFvIdValue(design: Design): number {
  let m = 0;
  for (const f of design.factors ?? []) {
    for (const fv of f.factor_values ?? []) {
      if (fv.id > m) m = fv.id;
    }
  }
  return m + 1;
}

export function addStatementFromTemplate(
  design: Design,
  factorId: number,
  fvId: number,
  buildStatement: (factorCategory: OntologyTerm | null) => Statement,
): Design {
  const factor = design.factors.find((f) => f.id === factorId);
  const stmt = buildStatement(factor?.category ?? null);
  return mapFactorValue(design, factorId, fvId, (fv) => ({
    ...fv,
    statements: [...fv.statements, stmt],
  }));
}

export function setStatement(
  design: Design,
  factorId: number,
  fvId: number,
  index: number,
  next: Statement,
): Design {
  return mapFactorValue(design, factorId, fvId, (fv) => {
    // Sync ``free_text_label`` off the primary statement's subject
    // when (a) we're editing the primary statement (index 0) and
    // (b) the existing label is either blank or matches the
    // previous subject label — i.e. it was auto-derived rather
    // than explicitly customised by the curator. Without this, a
    // curator who changes an FV's ontology term sees the new
    // subject everywhere except in surfaces that read
    // ``free_text_label`` first (Sample-details factor cells, FV
    // dropdowns), making the edit invisible there. Caught
    // 2026-04-30 on the Samples tab.
    const prev = fv.statements[index];
    const prevLabel = prev?.subject?.label ?? "";
    const nextLabel = next?.subject?.label ?? "";
    const labelWasAutoDerived =
      (fv.free_text_label || "") === "" ||
      (fv.free_text_label || "") === prevLabel;
    const shouldSyncLabel = index === 0 && labelWasAutoDerived;
    return {
      ...fv,
      free_text_label: shouldSyncLabel ? nextLabel : fv.free_text_label,
      statements: fv.statements.map((s, i) => (i === index ? next : s)),
    };
  });
}

export function deleteStatement(
  design: Design,
  factorId: number,
  fvId: number,
  index: number,
): Design {
  return mapFactorValue(design, factorId, fvId, (fv) => ({
    ...fv,
    statements: fv.statements.filter((_, i) => i !== index),
  }));
}

// ---------------------------------------------------------------------------
// Tags (experiment-level annotations)
// ---------------------------------------------------------------------------

function nextTagId(design: Design): number {
  let max = 0;
  for (const t of design.tags ?? []) if (t.id > max) max = t.id;
  return max + 1;
}

/**
 * Append a new tag with blank category + value. The curator fills
 * them in via the pickers. Returns the next Design plus the new
 * tag's id so the caller can focus the new row.
 */
export function addTag(design: Design): { design: Design; tagId: number } {
  const id = nextTagId(design);
  const newTag: Tag = {
    id,
    category: { label: "", uri: null },
    value: { label: "", uri: null },
    // Curator-asserted by definition — anything the curator types in
    // the UI is `IC` (Inferred by Curator), even when it originated
    // as an AI proposal that got accepted (the curator vouched for
    // it on accept). Round-trips to Gemma preserve provenance; absent
    // this stamp, accepted-from-proposal tags would land as empty
    // evidence code and look indistinguishable from legacy / unstamped
    // imports.
    evidence_code: "IC",
  };
  return {
    design: { ...design, tags: [...(design.tags ?? []), newTag] },
    tagId: id,
  };
}

export function deleteTag(design: Design, tagId: number): Design {
  return {
    ...design,
    tags: (design.tags ?? []).filter((t) => t.id !== tagId),
  };
}

export function setTagCategory(
  design: Design,
  tagId: number,
  category: OntologyTerm,
): Design {
  return {
    ...design,
    tags: (design.tags ?? []).map((t) =>
      t.id === tagId ? { ...t, category } : t,
    ),
  };
}

export function setTagValue(
  design: Design,
  tagId: number,
  value: OntologyTerm,
): Design {
  return {
    ...design,
    tags: (design.tags ?? []).map((t) =>
      t.id === tagId ? { ...t, value } : t,
    ),
  };
}

// ---------------------------------------------------------------------------
// Top-level Design metadata (Overview tab)
// ---------------------------------------------------------------------------
//
// Curator-editable: title, description, short_name. Read-only:
// taxon / assay / platform / loaded_at — those are upstream Gemma
// state, surfaced here for context but not changed through this
// surface (Gemma's curation backend owns those fields). Edits go
// through the normal commit flow.

export function setDesignShortName(design: Design, shortName: string): Design {
  return { ...design, experiment_short_name: shortName };
}

export function setDesignTitle(design: Design, title: string): Design {
  return { ...design, title };
}

export function setDesignDescription(design: Design, description: string): Design {
  return { ...design, description };
}

/**
 * Append a new publication. ``pubmed_id`` is canonical for de-duping;
 * if it matches an existing entry the existing one is left in place
 * and the call is a no-op. Empty PMIDs are rejected by the caller —
 * we don't enforce here since DOI-only entries are also valid.
 *
 * The agent-based publication-lookup hook (Paul's reminder) attaches
 * here: when wired, it'd pre-fill `title` / `citation` / `doi` from
 * the PubMed E-utilities response before this mutation is called.
 */
export function addPublication(
  design: Design,
  publication: { pubmed_id?: string; doi?: string; citation?: string; title?: string },
): Design {
  const pubs = design.publications ?? [];
  const pmid = (publication.pubmed_id || "").trim();
  const doi = (publication.doi || "").trim();
  // Dedup: if the PMID or DOI matches an existing entry, no-op.
  for (const p of pubs) {
    if (pmid && p.pubmed_id === pmid) return design;
    if (doi && p.doi === doi) return design;
  }
  return {
    ...design,
    publications: [
      ...pubs,
      {
        pubmed_id: pmid,
        doi,
        citation: publication.citation || "",
        title: publication.title || "",
      },
    ],
  };
}

export function deletePublication(
  design: Design,
  pubmedId: string,
  doi: string,
): Design {
  const pubs = design.publications ?? [];
  return {
    ...design,
    publications: pubs.filter((p) => {
      if (pubmedId && p.pubmed_id === pubmedId) return false;
      if (doi && p.doi === doi) return false;
      return true;
    }),
  };
}

// ---------------------------------------------------------------------------
// Biomaterial-level mutations (Sample Details tab)
// ---------------------------------------------------------------------------

export function setBiomaterialName(
  design: Design,
  shortName: string,
  name: string,
): Design {
  return {
    ...design,
    biomaterials: design.biomaterials.map((b) =>
      b.short_name === shortName ? { ...b, name } : b,
    ),
  };
}

/**
 * Set a single characteristic on one biomaterial. An empty
 * ``value`` clears the key. Adding new keys is allowed; the
 * existing key set is the union across all biomaterials, so a
 * curator can introduce a new characteristic on one sample and
 * the column appears for everyone.
 */
export function setBiomaterialCharacteristic(
  design: Design,
  shortName: string,
  key: string,
  value: string,
): Design {
  const k = key.trim();
  if (!k) return design;
  return {
    ...design,
    biomaterials: design.biomaterials.map((b) => {
      if (b.short_name !== shortName) return b;
      const next = { ...(b.characteristics ?? {}) };
      if (value === "") delete next[k];
      else next[k] = value;
      return { ...b, characteristics: next };
    }),
  };
}

/**
 * Move a biomaterial to a different FV within the same factor (reassignment).
 * No-op when the target FV already has it.
 */
export function reassignSample(
  design: Design,
  factorId: number,
  biomaterialShortName: string,
  toFvId: number,
): Design {
  return reassignSamples(design, factorId, [biomaterialShortName], toFvId);
}

/**
 * Bulk variant: move many biomaterials to the same target FV in one
 * pass. Single ``mapFactor`` reduction over all factor values
 * regardless of how many samples are moving — fixes the N-call
 * fan-out that bit single-cell datasets where dropping one tile
 * could trigger 50 sequential ``apply()`` invocations and
 * 50 reductions over the design.
 */
export function reassignSamples(
  design: Design,
  factorId: number,
  biomaterialShortNames: string[],
  toFvId: number,
): Design {
  const moving = new Set(biomaterialShortNames);
  if (moving.size === 0) return design;
  return mapFactor(design, factorId, (f) => ({
    ...f,
    factor_values: f.factor_values.map((fv) => {
      if (fv.id === toFvId) {
        // Add anything in ``moving`` not already present.
        const present = new Set(fv.biomaterial_short_names);
        const additions = [...moving].filter((sn) => !present.has(sn));
        if (additions.length === 0) return fv;
        return {
          ...fv,
          biomaterial_short_names: [
            ...fv.biomaterial_short_names,
            ...additions,
          ],
        };
      }
      // Remove anything in ``moving`` from this non-target FV.
      const filtered = fv.biomaterial_short_names.filter(
        (sn) => !moving.has(sn),
      );
      return filtered.length === fv.biomaterial_short_names.length
        ? fv
        : { ...fv, biomaterial_short_names: filtered };
    }),
  }));
}

/**
 * Assign every biomaterial NOT yet assigned to any FV in this
 * factor to the given FV. Cheap one-click for the common
 * "I've set N-1 FVs and the last one mops up" pattern.
 */
export function assignRemainingBiomaterials(
  design: Design,
  factorId: number,
  toFvId: number,
): Design {
  const factor = design.factors.find((f) => f.id === factorId);
  if (!factor) return design;
  const allNames = new Set(design.biomaterials.map((b) => b.short_name));
  const assigned = new Set<string>();
  for (const fv of factor.factor_values) {
    for (const sn of fv.biomaterial_short_names) {
      assigned.add(sn);
    }
  }
  const remaining = [...allNames].filter((sn) => !assigned.has(sn));
  if (remaining.length === 0) return design;
  return mapFactor(design, factorId, (f) => ({
    ...f,
    factor_values: f.factor_values.map((fv) =>
      fv.id === toFvId
        ? {
            ...fv,
            biomaterial_short_names: [...fv.biomaterial_short_names, ...remaining],
          }
        : fv,
    ),
  }));
}
