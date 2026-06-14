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
import type {
  FactorProposal,
  FactorValueProposal,
} from "@/api/types";
import { baselineFor, HAS_ROLE_PREDICATE } from "./baselineForCategory";
import { factorFromTemplate, type FactorTemplate } from "./factorTemplates";
import { templatesFor } from "./statementTemplates";

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
 * picker), categorical type, **two blank FVs** (one baseline + one
 * non-baseline). The seed FVs save the curator from having to add
 * them manually in the common case — categorical factors are almost
 * always binary or higher partition. Paul 2026-06-14: a new factor
 * "still needs at least two factor values" by definition.
 *
 * If a category is known at creation time use ``addFactorFromTemplate``
 * instead — that path seeds canonical FV labels from
 * ``FACTOR_TEMPLATES`` (vehicle/drug, wild type/knockout, …).
 */
export function addFactor(design: Design): { design: Design; factorId: number } {
  const id = nextFactorId(design);
  const fvIdStart =
    design.factors.flatMap((f) => f.factor_values).reduce(
      (m, fv) => Math.max(m, fv.id),
      0,
    ) + 1;
  const newFactor: Factor = {
    id,
    name: "",
    category: { label: "", uri: null },
    description: "",
    type: "categorical",
    factor_values: [
      {
        id: fvIdStart,
        free_text_label: "",
        is_baseline: true,
        biomaterial_short_names: [],
        statements: [],
      },
      {
        id: fvIdStart + 1,
        free_text_label: "",
        is_baseline: false,
        biomaterial_short_names: [],
        statements: [],
      },
    ],
  };
  return {
    design: { ...design, factors: [...design.factors, newFactor] },
    factorId: id,
  };
}

/** Statement-set signature for a factor — used to flag perfect
 *  duplicate factors. Two factors are considered "perfect duplicates"
 *  when their FVs share the exact same statement triples (category /
 *  subject / predicate / object on URI when present, label otherwise)
 *  regardless of curator-typed FV labels. Paul 2026-06-14: "the
 *  statements define equality for this purpose."
 *
 *  The signature is deterministic across FV order — statements are
 *  sorted within each FV, FV signatures are sorted within the factor —
 *  so reordering doesn't break the match. Empty / FV-less factors
 *  return an empty signature; two such factors are NOT flagged as
 *  duplicates of each other (no information to compare yet).
 */
export function factorStatementSignature(factor: Factor): string {
  const part = (
    t: { label?: string | null; uri?: string | null } | null | undefined,
  ): string =>
    t ? t.uri || (t.label || "").toLowerCase().trim() : "";
  const stKey = (s: Statement): string =>
    [part(s.category), part(s.subject), part(s.predicate), part(s.object)].join(
      "|",
    );
  const fvKey = (fv: FactorValue): string => {
    const stmts = fv.statements.map(stKey).sort().join(";");
    return stmts;
  };
  // Drop empty-statement FVs from the signature so a curator who's
  // just added a blank seed FV doesn't trigger spurious duplicate
  // matches against any other factor that also has a blank seed FV.
  const fvs = factor.factor_values
    .map(fvKey)
    .filter((k) => k.length > 0)
    .sort();
  return fvs.join("//");
}

/** Find perfect-duplicate factor pairs in the design (statement-set
 *  equality). Returns each pair only once, keyed by the lower
 *  factor.id so the UI can dedup. */
export function findDuplicateFactorPairs(
  design: Design,
): Array<{ a: Factor; b: Factor; signature: string }> {
  const sigByFactor = new Map<number, string>();
  for (const f of design.factors) {
    const sig = factorStatementSignature(f);
    if (sig) sigByFactor.set(f.id, sig);
  }
  const buckets = new Map<string, Factor[]>();
  for (const f of design.factors) {
    const sig = sigByFactor.get(f.id);
    if (!sig) continue;
    const arr = buckets.get(sig) ?? [];
    arr.push(f);
    buckets.set(sig, arr);
  }
  const pairs: Array<{ a: Factor; b: Factor; signature: string }> = [];
  for (const [sig, arr] of buckets) {
    if (arr.length < 2) continue;
    arr.sort((x, y) => x.id - y.id);
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        pairs.push({ a: arr[i], b: arr[j], signature: sig });
      }
    }
  }
  return pairs;
}

/** Duplicate an existing FV inside its factor. The clone keeps the
 *  label / statements / baseline flag of the source but clears
 *  ``biomaterial_short_names`` — duplicating an FV onto the same
 *  partition would double-assign samples, which the validator
 *  rejects, and the more common intent is "start from a similar FV
 *  and edit the differences." Returns the new design plus the clone's
 *  id so the caller can auto-select it for editing. */
export function duplicateFactorValue(
  design: Design,
  factorId: number,
  fvId: number,
): { design: Design; fvId: number } | null {
  const factor = design.factors.find((f) => f.id === factorId);
  if (!factor) return null;
  const src = factor.factor_values.find((fv) => fv.id === fvId);
  if (!src) return null;
  const nextFvId =
    design.factors
      .flatMap((f) => f.factor_values)
      .reduce((m, fv) => Math.max(m, fv.id), 0) + 1;
  const labelSuffix = src.free_text_label ? `${src.free_text_label} (copy)` : "";
  const clone: FactorValue = {
    id: nextFvId,
    free_text_label: labelSuffix,
    // A copy can never inherit baseline-ness — there's exactly one
    // baseline per factor, the source is already it.
    is_baseline: false,
    biomaterial_short_names: [],
    statements: src.statements.map((s) => ({
      category: s.category ? { ...s.category } : null,
      subject: { ...s.subject },
      predicate: s.predicate ? { ...s.predicate } : null,
      object: s.object ? { ...s.object } : null,
    })),
  };
  const nextFactors = design.factors.map((f) =>
    f.id === factorId
      ? { ...f, factor_values: [...f.factor_values, clone] }
      : f,
  );
  return { design: { ...design, factors: nextFactors }, fvId: nextFvId };
}

/** Create a pre-typed ``collection of material`` factor and append
 *  it to the design. Convenience wrapper around ``addFactor`` for
 *  the experiment-wide split flow: when the curator wants to split
 *  on a sample-grouping axis that doesn't exist as a factor yet,
 *  the natural Gemma category for "which slice of this preboarding
 *  does each sample belong to" is ``collection of material`` (EFO).
 *  The curator populates FVs separately from the factor card.
 *
 *  Returns the new design plus the newly-allocated factor id so the
 *  caller can set ``should_split_on_factor_id`` to it in the same
 *  apply call.
 */
export function addCollectionOfMaterialFactor(
  design: Design,
): { design: Design; factorId: number } {
  const id = nextFactorId(design);
  const newFactor: Factor = {
    id,
    name: "collection of material",
    category: {
      label: "collection of material",
      uri: "http://www.ebi.ac.uk/efo/EFO_0005066",
    },
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
 * Promote a per-sample biomaterial characteristic into a continuous
 * factor. Mirrors a feature in the legacy Gemma UI: when a dataset
 * carries a numeric characteristic (e.g. ``age``, ``weight``,
 * ``time post infection``), the curator can lift it from the sample
 * table into a first-class Factor without re-typing values.
 *
 * Each biomaterial that carries the characteristic becomes a
 * one-sample FV with ``free_text_label = <measurement string>``.
 * BMs that don't carry the key are skipped — continuous factors
 * don't require full coverage (validator already lets them through
 * post-#12).
 *
 * Returns the new Design plus the newly-allocated factor id (for
 * auto-select on the FactorList) and the count of BMs that
 * contributed measurements (for an "added N samples" toast).
 */
export function addContinuousFactorFromCharacteristic(
  design: Design,
  characteristicKey: string,
  options?: {
    /** Override the factor's display name. Defaults to the
     *  characteristic key verbatim. */
    name?: string;
    /** Override the factor's category (OntologyTerm). Defaults to
     *  ``{ label: characteristicKey }`` so the curator can reattach a
     *  proper category afterwards. */
    category?: OntologyTerm;
  },
): { design: Design; factorId: number; sampleCount: number } {
  const key = characteristicKey.trim();
  if (!key) {
    return { design, factorId: -1, sampleCount: 0 };
  }
  const factorId = nextFactorId(design);
  let nextFvId = nextFvIdValue(design);
  const factorValues: FactorValue[] = [];
  for (const bm of design.biomaterials ?? []) {
    const raw = bm.characteristics?.[key];
    if (raw == null) continue;
    const value = String(raw).trim();
    if (!value) continue;
    factorValues.push({
      id: nextFvId++,
      free_text_label: value,
      is_baseline: false,
      biomaterial_short_names: [bm.short_name],
      statements: [],
    });
  }
  const factor: Factor = {
    id: factorId,
    name: options?.name?.trim() || key,
    category: options?.category ?? { label: key, uri: null },
    description: "",
    type: "continuous",
    factor_values: factorValues,
  };
  return {
    design: { ...design, factors: [...design.factors, factor] },
    factorId,
    sampleCount: factorValues.length,
  };
}

/**
 * Promote a per-sample biomaterial characteristic into a categorical
 * factor. Sister to ``addContinuousFactorFromCharacteristic``: where
 * that one becomes a per-sample numeric factor (one FV per sample),
 * this one **groups** BMs by their characteristic value — each
 * distinct non-empty value becomes one FV, and every BM carrying
 * that value gets assigned to it.
 *
 * Use case: GEO datasets often carry a ``batch`` / ``run`` /
 * ``date_run`` characteristic that's the natural batch factor —
 * lift it directly instead of re-typing every level.
 *
 * Defaults: factor name + category label = the characteristic key
 * (curator can rename / re-categorise after); category URI null;
 * type=categorical; no statements (curator adds via the per-FV
 * statement editor when needed).
 *
 * Returns the new Design plus the factor id (for auto-select), the
 * count of distinct FVs created, and the count of BMs that
 * contributed an assignment (for an "added N samples across M
 * values" toast).
 */
export function addCategoricalFactorFromCharacteristic(
  design: Design,
  characteristicKey: string,
  options?: {
    /** Override the factor's display name. Defaults to the
     *  characteristic key verbatim. */
    name?: string;
    /** Override the factor's category (OntologyTerm). Defaults to
     *  ``{ label: characteristicKey }`` so the curator can reattach a
     *  proper category afterwards. */
    category?: OntologyTerm;
  },
): {
  design: Design;
  factorId: number;
  sampleCount: number;
  fvCount: number;
} {
  const key = characteristicKey.trim();
  if (!key) {
    return { design, factorId: -1, sampleCount: 0, fvCount: 0 };
  }
  const factorId = nextFactorId(design);
  let nextFvId = nextFvIdValue(design);

  // Group BMs by trimmed value, preserving first-seen order so the
  // FV order in the editor matches what curators see scanning the
  // characteristic column top-down.
  const order: string[] = [];
  const buckets = new Map<string, string[]>();
  let sampleCount = 0;
  for (const bm of design.biomaterials ?? []) {
    const raw = bm.characteristics?.[key];
    if (raw == null) continue;
    const value = String(raw).trim();
    if (!value) continue;
    sampleCount++;
    if (!buckets.has(value)) {
      buckets.set(value, []);
      order.push(value);
    }
    buckets.get(value)!.push(bm.short_name);
  }

  const factorValues: FactorValue[] = order.map((value) => ({
    id: nextFvId++,
    free_text_label: value,
    is_baseline: false,
    biomaterial_short_names: buckets.get(value) ?? [],
    statements: [],
  }));

  const factor: Factor = {
    id: factorId,
    name: options?.name?.trim() || key,
    category: options?.category ?? { label: key, uri: null },
    description: "",
    type: "categorical",
    factor_values: factorValues,
  };
  return {
    design: { ...design, factors: [...design.factors, factor] },
    factorId,
    sampleCount,
    fvCount: factorValues.length,
  };
}

/** Heuristic: are this characteristic's values numeric across most
 *  of the cohort? Used by the "promote to factor" affordance on the
 *  Sample tab to decide which char column headers get the
 *  ``+ promote to factor`` link.
 *
 *  Permissive on purpose: we surface the affordance on anything
 *  numeric (including identifier-shaped keys like ``subject id``) and
 *  let the curator decide whether the promotion makes biological
 *  sense. An earlier version filtered ID-shaped key names by token
 *  match; that ruled out legitimate cases (e.g. a numeric subject-
 *  id channel that the curator *wants* to surface as a factor) and
 *  hid promote affordances inconsistently across columns.
 *
 *  A characteristic counts as continuous when at least ``threshold``
 *  (default 0.8) of the non-empty values parse as finite floats. */
export function isContinuousCharacteristic(
  biomaterials: { characteristics?: Record<string, string> }[],
  key: string,
  threshold = 0.8,
): boolean {
  let total = 0;
  let numeric = 0;
  for (const bm of biomaterials) {
    const raw = bm.characteristics?.[key];
    if (raw == null) continue;
    const v = String(raw).trim();
    if (!v) continue;
    total++;
    const n = Number(v);
    if (Number.isFinite(n)) numeric++;
  }
  if (total === 0) return false;
  return numeric / total >= threshold;
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
        // Turning on. If the FV already carries any non-empty
        // statement the curator authored, just flip the flag — don't
        // append a "has role: control" line on top of their work.
        // Paul 2026-06-14: "setting this to baseline caused another
        // factor value to be inserted." Earlier rule only checked for
        // the canonical baseline-term LABELS; biological-sex
        // ``female`` (PATO:0000383) didn't match those, so the
        // injection fired anyway and left the curator with a spurious
        // ``female has role control`` row alongside their original.
        const hasRealStatement = fv.statements.some(
          (s) =>
            (s.subject?.label || "").trim() ||
            (s.predicate?.label || "").trim() ||
            (s.object?.label || "").trim(),
        );
        if (hasRealStatement || fvHasBaselineStatement(fv) || !tpl) {
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

/**
 * Atomic per-FV revert. Restores a single FactorValue to its
 * server-saved state without affecting siblings.
 *
 * Three cases the caller resolves before calling:
 *   - **modified** (`savedFv != null`, FV present in draft): replace
 *     the draft FV's label / baseline / statements / biomaterials
 *     with the saved values.
 *   - **added**    (`savedFv == null`, FV present in draft): drop
 *     the FV from the draft (since saved had nothing).
 *   - **removed**  (`savedFv != null`, FV NOT present in draft):
 *     re-insert the saved FV at the end of the factor's FV list.
 *     Order isn't preserved — Gemma stores FVs as a set, the
 *     curator's display order is incidental.
 *
 * The caller (a UI handler) gets the saved FV from `change.before`
 * on the diff index, so it always has the right shape on hand.
 */
export function revertFactorValue(
  design: Design,
  factorId: number,
  fvId: number,
  savedFv: FactorValue | null,
): Design {
  return mapFactor(design, factorId, (f) => {
    const present = f.factor_values.some((fv) => fv.id === fvId);
    if (!savedFv) {
      // Added in draft, nothing to restore — drop it.
      return {
        ...f,
        factor_values: f.factor_values.filter((fv) => fv.id !== fvId),
      };
    }
    if (!present) {
      // Removed in draft, restore from saved (append; order isn't
      // load-bearing on the wire).
      return {
        ...f,
        factor_values: [...f.factor_values, savedFv],
      };
    }
    // Modified — replace by id. Use a deep copy of the saved FV so
    // the caller can't accidentally mutate the saved baseline by
    // editing the restored draft.
    return {
      ...f,
      factor_values: f.factor_values.map((fv) =>
        fv.id === fvId
          ? {
              ...savedFv,
              statements: savedFv.statements.map((s) => ({ ...s })),
              biomaterial_short_names: [...savedFv.biomaterial_short_names],
            }
          : fv,
      ),
    };
  });
}

/**
 * Atomic per-Factor revert. Restores a Factor's metadata (name /
 * category / type / description) AND every FV back to saved state.
 *
 * Cases:
 *   - **factor added in draft** (`savedFactor == null`): drop the
 *     whole factor.
 *   - **factor present + edited** (`savedFactor != null`): replace
 *     the draft factor wholesale with a deep copy of saved.
 *   - **factor removed in draft** (`savedFactor != null` AND not
 *     present): re-insert.
 *
 * Use case: curator made several edits to one factor (renamed,
 * added an FV, edited two FV labels) and wants a one-click "back
 * to baseline" without picking through each change.
 */
export function revertFactor(
  design: Design,
  factorId: number,
  savedFactor: Factor | null,
): Design {
  const present = design.factors.some((f) => f.id === factorId);
  if (!savedFactor) {
    return {
      ...design,
      factors: design.factors.filter((f) => f.id !== factorId),
    };
  }
  const restored: Factor = {
    ...savedFactor,
    category: savedFactor.category
      ? { ...savedFactor.category }
      : savedFactor.category,
    factor_values: savedFactor.factor_values.map((fv) => ({
      ...fv,
      statements: fv.statements.map((s) => ({ ...s })),
      biomaterial_short_names: [...fv.biomaterial_short_names],
    })),
  };
  if (!present) {
    return { ...design, factors: [...design.factors, restored] };
  }
  return {
    ...design,
    factors: design.factors.map((f) => (f.id === factorId ? restored : f)),
  };
}

export function addFactorValue(design: Design, factorId: number): Design {
  const id = nextFvId(design);
  const factor = design.factors.find((f) => f.id === factorId);
  const factorCategory = factor?.category ?? null;
  // Seed the new FV with a starter statement from the matching
  // template when the factor's category has one (genotype-ko for
  // genotype, treatment-dose for treatment, etc — see
  // statementTemplates.ts). Picks the first matching template;
  // curator swaps via the per-statement template picker if a
  // different shape fits better. No matching template (block /
  // batch / ad-hoc category labels) → fall back to one empty
  // statement carrying just the factor category, matching the
  // pre-templates default so the editor still renders consistently.
  const matching =
    factorCategory && factorCategory.label.trim()
      ? templatesFor(factorCategory)
      : [];
  // Filter out the catch-all "*" templates so e.g. a genotype FV
  // doesn't get seeded with a generic "subject + has role + role"
  // pattern when a more specific genotype template exists.
  const specific = matching.filter((t) => t.category !== "*");
  const seedStatement: Statement =
    specific.length > 0
      ? specific[0].build(factorCategory)
      : {
          category: factorCategory ? { ...factorCategory } : null,
          subject: { label: "" },
        };
  const newFv: FactorValue = {
    id,
    free_text_label: "",
    is_baseline: false,
    statements: [seedStatement],
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
  return mapFactorValue(design, factorId, fvId, (fv) => {
    const last = fv.statements.length
      ? fv.statements[fv.statements.length - 1]
      : null;
    // First-statement seed: when the FV has no statements yet but
    // carries a free-text label (the common post-Apply shape — agent
    // proposed an FV without resolving it to ontology), pre-fill the
    // subject with that free text so the curator can promote it to
    // an ontology term in place instead of re-typing.
    const seedSubject = last?.subject
      ? { ...last.subject }
      : fv.free_text_label?.trim()
        ? { label: fv.free_text_label.trim() }
        : { label: "" };
    return {
      ...fv,
      statements: [
        ...fv.statements,
        {
          category: last?.category ?? defaultCategory,
          subject: seedSubject,
        },
      ],
    };
  });
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
    description?: string;
    factor_type?: "categorical" | "continuous";
    baseline_relevance?: "required" | "not_applicable" | "uncertain";
    baseline_relevance_reason?: string;
    factor_values: {
      free_text_label: string;
      is_baseline: boolean;
      numeric_value?: number | null;
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
  // Dedup by factor category (URI when present, label otherwise) —
  // mirrors the tag dedup above. A second click on Apply must NOT
  // double-add factors that the curator already accepted on a prior
  // click; the proposer convention is one factor per category, so
  // matching on category is the right granularity. To re-apply a
  // proposal after editing, the curator discards the draft (which
  // drops the in-progress factors) and clicks Apply again.
  const existingFactors = design.factors ?? [];
  const seenFactorKeys = new Set(
    existingFactors.map((f) => factorKey(f.category)),
  );
  let nextFactorId =
    existingFactors.reduce((m, f) => Math.max(m, f.id), 0) + 1;
  let nextFvId = nextFvIdValue(design);
  const addedFactors: Factor[] = [];
  for (const p of proposalFactors) {
    const k = factorKey(p.category);
    if (seenFactorKeys.has(k)) continue;
    seenFactorKeys.add(k);
    const factorId = nextFactorId++;
    const factor: Factor = {
      id: factorId,
      name: p.name_in_design || p.category.label,
      category: { label: p.category.label, uri: p.category.uri ?? null },
      // Per Paul 2026-06-11: the agent's ≤80-char `description` (which
      // renders as the proposal card's subtitle) was being dropped at
      // accept, forcing the curator to re-type it. Carry it across.
      description: (p.description ?? "").trim(),
      type: p.factor_type === "continuous" ? "continuous" : "categorical",
      baseline_relevance: p.baseline_relevance,
      baseline_relevance_reason: p.baseline_relevance_reason,
      factor_values: p.factor_values.map((fv) => ({
        id: nextFvId++,
        free_text_label: fv.free_text_label,
        is_baseline: fv.is_baseline,
        numeric_value: fv.numeric_value ?? null,
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
    addedFactors.push(factor);
  }

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

  // Dedup key = `${name}||${categoryKey}`. categoryKey is URI-first
  // (via factorKey) so two proposals with the same name + label but
  // distinct category URIs (multi-factor-same-category designs)
  // don't collapse to the same bucket. The original label-only
  // version mis-removed the wrong factor on accept.
  const proposalFactorKeys = new Set(
    proposalFactors.map((f) =>
      `${(f.name_in_design || f.category.label || "").toLowerCase()}||${factorKey(
        f.category,
      )}`,
    ),
  );
  const savedFactorIds = new Set((saved?.factors ?? []).map((f) => f.id));
  const remainingFactors = (design.factors ?? []).filter((f) => {
    const k = `${(f.name || f.category.label || "").toLowerCase()}||${factorKey(
      f.category,
    )}`;
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

function factorKey(cat: { label: string; uri?: string | null }): string {
  return (cat.uri || cat.label || "").toLowerCase();
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

/**
 * Adopt an agent's near-match factor proposal into an existing gold
 * factor — the curator's "Alt is better" button on a
 * ``calibration_factor_match_near`` finding.
 *
 * Near-match means the agent and gold share the same partition (every
 * agent FV's biomaterial set lines up 1:1 with a gold FV's), but the
 * labels / statements / URIs differ. The mutator keeps the gold
 * factor's identity (id, name, biomaterial assignments) and overwrites
 * its category + each FV's label + statements with the agent's
 * version. New FV ids stay stable for FVs whose biomaterial set
 * matches an existing gold FV; FVs without a partition match get
 * fresh ids.
 *
 * Preserved on every FV: ``biomaterial_short_names`` (the partition is
 * already correct by definition of "near match") and ``id`` (so
 * downstream references to the FV stay intact).
 *
 * Replaced from the agent's proposal: ``category`` (factor-level),
 * ``free_text_label``, ``is_baseline``, ``numeric_value``,
 * ``statements`` (with ontology terms resolved from the agent's
 * proposal).
 *
 * Wired by ``ComparisonFactorCard``'s Accept handler for
 * ``calibration_factor_match_near`` findings — bro 2026-06-12 ship:
 * "Accept doesn't do anything; should swap the gold factor for the
 * agent's alt".
 */
export function adoptNearMatchAgentFactor(
  design: Design,
  agentFactor: FactorProposal,
): Design {
  // Locate the factor in the WRITABLE design (not a chip-strip
  // baseline that may be a non-writable curation). Match by category
  // URI when present (most reliable; survives label drift), fall
  // back to case-insensitive label. Without this lookup-by-content
  // step the earlier "match by goldFactorId" path silently no-op'd
  // when the chip strip was showing a curation whose ids don't line
  // up with the local draft (Paul 2026-06-12: "I see the message
  // accepted the alts but the factor doesn't get updated").
  const agentCatUri = agentFactor.category?.uri ?? null;
  const agentCatLabel = (agentFactor.category?.label ?? "")
    .trim()
    .toLowerCase();
  const factor = design.factors.find((f) => {
    if (agentCatUri && f.category?.uri && f.category.uri === agentCatUri) {
      return true;
    }
    return (
      !!agentCatLabel &&
      (f.category?.label ?? "").trim().toLowerCase() === agentCatLabel
    );
  });
  if (!factor) return design;
  const goldFactorId = factor.id;

  // Map biomaterial-set → existing gold FV id so the same partition
  // keeps its id (downstream refs survive). FVs in the agent's
  // proposal whose partition doesn't match any gold FV get a fresh
  // id from ``nextFvId``.
  const goldFvByBmKey = new Map<string, FactorValue>();
  for (const gfv of factor.factor_values) {
    goldFvByBmKey.set(bmKey(gfv.biomaterial_short_names), gfv);
  }

  let freshId = nextFvId(design);

  const nextFactorValues: FactorValue[] = agentFactor.factor_values.map(
    (afv) => {
      const key = bmKey(afv.biomaterial_short_names);
      const goldMatch = goldFvByBmKey.get(key);
      return mergeAgentFvIntoGold(
        afv,
        goldMatch ?? null,
        goldMatch ? goldMatch.id : freshId++,
      );
    },
  );

  const updated: Factor = {
    ...factor,
    // Prefer the agent's human-readable ``name_in_design`` over the
    // gold's name. The agent's whole point is "I have a better
    // shape", and that includes the curator-facing label. Falls back
    // to the gold's name when the agent didn't supply one. Per Paul
    // 2026-06-12: "the name of the factor: doesn't the agent suggest
    // one? I mean a human-readable one".
    name: (agentFactor.name_in_design || factor.name || "").trim(),
    category: {
      label: agentFactor.category.label,
      uri: agentFactor.category.uri ?? null,
    },
    // ``description`` rides along if the agent supplied one — same
    // convention as ``applyProposalToDesign``.
    description: (agentFactor.description ?? factor.description ?? "").trim(),
    factor_values: nextFactorValues,
  };

  return {
    ...design,
    factors: design.factors.map((f) =>
      f.id === goldFactorId ? updated : f,
    ),
  };
}

function bmKey(names: readonly string[]): string {
  return [...names].sort().join("");
}

function mergeAgentFvIntoGold(
  agent: FactorValueProposal,
  _gold: FactorValue | null,
  id: number,
): FactorValue {
  const statements: Statement[] = (agent.statements ?? []).map((st) => ({
    category: st.category
      ? {
          label: st.category.label,
          uri: st.category.uri ?? null,
        }
      : { label: "", uri: null },
    subject: st.subject
      ? {
          label: st.subject.label,
          uri: st.subject.uri ?? null,
        }
      : { label: "", uri: null },
    predicate: st.predicate
      ? {
          label: st.predicate.label,
          uri: st.predicate.uri ?? null,
        }
      : null,
    object: st.object
      ? {
          label: st.object.label,
          uri: st.object.uri ?? null,
        }
      : null,
  }));

  return {
    id,
    // Use the agent's own concise label (e.g. "kanamycin") rather
    // than auto-generating a long comma-joined summary from every
    // statement. Per Paul 2026-06-12: "good lord, the name is even
    // longer now" / "I called it 'antibiotic cocktail PND 14-21'" —
    // long labels are noise; the agent's label or the curator's
    // manual label is what they want.
    free_text_label: agent.free_text_label,
    is_baseline: agent.is_baseline,
    numeric_value: agent.numeric_value ?? null,
    statements,
    biomaterial_short_names: [...agent.biomaterial_short_names],
  };
}

/**
 * Merge an agent's near-match factor proposal INTO the gold factor —
 * the curator's "+ Merge" button on a ``calibration_factor_match_near``
 * finding. Unlike ``adoptNearMatchAgentFactor`` (which replaces gold's
 * content with agent's), this takes the UNION of statements per
 * paired FV.
 *
 * Motivating case (Paul 2026-06-12, GSE near-match): gold's FV2 had
 * "<drug> · delivered at dose · <dose>" statements for each drug;
 * agent's FV2 had "<drug> · delivered for duration · <duration>" for
 * the same drugs. Both are useful curation content. "Alt is better"
 * would drop the doses; "Keep" would drop the durations. The merge
 * keeps both.
 *
 * Dedupe rule: full S-P-O signature (subject URI || label, predicate
 * URI || label, object URI || label, all lowercased + trimmed). Two
 * statements that say the same thing collapse to one. Two statements
 * with the same subject but different predicates BOTH survive — that's
 * the win in the motivating case.
 *
 * Preserved on every FV: ``id``, ``free_text_label`` (kept from gold —
 * the curator isn't relabelling), ``is_baseline``, ``numeric_value``.
 * Factor-level ``category`` stays as gold's; agent and gold share it
 * by definition of near-match.
 *
 * FVs that exist on the agent but have no biomaterial-set partner on
 * gold are appended as new FVs (rare on a near-match — the partition
 * is by definition aligned — but defensive).
 */
export function mergeNearMatchAgentFactor(
  design: Design,
  agentFactor: FactorProposal,
): Design {
  const agentCatUri = agentFactor.category?.uri ?? null;
  const agentCatLabel = (agentFactor.category?.label ?? "")
    .trim()
    .toLowerCase();
  const factor = design.factors.find((f) => {
    if (agentCatUri && f.category?.uri && f.category.uri === agentCatUri) {
      return true;
    }
    return (
      !!agentCatLabel &&
      (f.category?.label ?? "").trim().toLowerCase() === agentCatLabel
    );
  });
  if (!factor) return design;
  const goldFactorId = factor.id;

  // Map biomaterial-set → existing gold FV so the per-FV merge runs
  // against the right partner. Unmatched agent FVs append at the end.
  const goldFvByBmKey = new Map<string, FactorValue>();
  for (const gfv of factor.factor_values) {
    goldFvByBmKey.set(bmKey(gfv.biomaterial_short_names), gfv);
  }
  const claimedGoldIds = new Set<number>();
  let freshId = nextFvId(design);

  const merged: FactorValue[] = [];

  // Pass 1: every gold FV keeps its slot (preserves order + ids). If
  // a paired agent FV exists, merge its statements in. The merge
  // normalises each merged-in agent statement's ``category`` to
  // match the gold-side statement with the same subject — so
  // ``groupStatementsBySubject`` (which buckets by category+subject)
  // collapses them into one compact "subject + stacked P/O pairs"
  // row in the design-tab renderer instead of 2N flat rows. Paul
  // 2026-06-12: "we treat it as if it was two statements about the
  // subject like you did, but it's more compact".
  const factorCategoryFallback = factor.category ?? null;
  for (const gfv of factor.factor_values) {
    const key = bmKey(gfv.biomaterial_short_names);
    const agentMatch = agentFactor.factor_values.find(
      (afv) => bmKey(afv.biomaterial_short_names) === key,
    );
    if (!agentMatch) {
      merged.push(gfv);
      continue;
    }
    claimedGoldIds.add(gfv.id);
    const nextStatements = unionStatements(
      gfv.statements,
      agentMatch.statements,
      factorCategoryFallback,
    );
    // Preserve gold's ``free_text_label`` on merge — it's the
    // current state, possibly the curator's manual rename (Paul
    // 2026-06-12: "I called it 'antibiotic cocktail PND 14-21'").
    // Auto-regenerating from statements ballooned the title into
    // a 10-phrase comma list.
    merged.push({
      ...gfv,
      statements: nextStatements,
    });
  }

  // Pass 2: agent FVs whose biomaterial set didn't pair with any
  // gold FV — append as new FVs with fresh ids. Defensive; on a real
  // near-match the partition aligns.
  for (const afv of agentFactor.factor_values) {
    const key = bmKey(afv.biomaterial_short_names);
    const gold = goldFvByBmKey.get(key);
    if (gold && claimedGoldIds.has(gold.id)) continue;
    merged.push(mergeAgentFvIntoGold(afv, null, freshId++));
  }

  const updated: Factor = {
    ...factor,
    // Same name-adoption rule as ``adoptNearMatchAgentFactor``: the
    // agent's ``name_in_design`` is the human-readable label the
    // curator opted into by clicking Merge.
    name: (agentFactor.name_in_design || factor.name || "").trim(),
    factor_values: merged,
  };

  return {
    ...design,
    factors: design.factors.map((f) =>
      f.id === goldFactorId ? updated : f,
    ),
  };
}

/** Union two statement lists, deduping by full S-P-O signature
 *  (subject/predicate/object URI when present, label otherwise; all
 *  lowercased). Gold-side entries win on collision (the curator's
 *  original wording survives).
 *
 *  Gemma's wire model is a single statement carrying multiple
 *  (predicate, object) pairs per subject; the UI flattens that to
 *  many ``Statement`` rows sharing ``(category, subject)``, and
 *  ``CompactStatementGroup`` / ``groupStatementsBySubject`` collapse
 *  them back to one visual row at render time. Crucially, the
 *  grouper buckets by ``(category, subject)`` — so for the merge to
 *  read as one compact row instead of 2N flat ones, each merged-in
 *  agent statement has to land in the same bucket as its gold
 *  counterpart.
 *
 *  Strategy: for every agent statement, find a gold statement with
 *  the same subject and copy ITS category onto the agent statement.
 *  Falls back to ``factorCategoryFallback`` (the owning factor's
 *  category) when no same-subject gold statement exists — every
 *  merged statement still ends up with a category that aligns with
 *  the factor's identity, and the grouper collapses across the
 *  whole FV cleanly. */
function unionStatements(
  gold: readonly Statement[],
  agentProposal: readonly { subject?: { label?: string; uri?: string | null } | null; predicate?: { label?: string; uri?: string | null } | null; object?: { label?: string; uri?: string | null } | null; category?: { label?: string; uri?: string | null } | null }[],
  factorCategoryFallback: OntologyTerm | null = null,
): Statement[] {
  const sig = (
    s: {
      subject?: { label?: string; uri?: string | null } | null;
      predicate?: { label?: string; uri?: string | null } | null;
      object?: { label?: string; uri?: string | null } | null;
    },
  ): string => {
    const part = (t?: { label?: string; uri?: string | null } | null) =>
      ((t?.uri || t?.label) ?? "").trim().toLowerCase();
    return `${part(s.subject)}|${part(s.predicate)}|${part(s.object)}`;
  };
  const subjKey = (
    s: { subject?: { label?: string; uri?: string | null } | null },
  ): string => {
    const t = s.subject;
    return ((t?.uri || t?.label) ?? "").trim().toLowerCase();
  };
  // Pre-index gold's categories by subject so each merged-in agent
  // statement can inherit the same (category, subject) bucket key.
  const goldCategoryBySubject = new Map<string, OntologyTerm>();
  for (const g of gold) {
    const k = subjKey(g);
    if (!k || goldCategoryBySubject.has(k)) continue;
    if (g.category && (g.category.label || g.category.uri)) {
      goldCategoryBySubject.set(k, g.category);
    }
  }
  const seen = new Set<string>();
  const out: Statement[] = [];
  for (const g of gold) {
    const k = sig(g);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(g);
  }
  for (const a of agentProposal) {
    const k = sig(a);
    if (seen.has(k)) continue;
    seen.add(k);
    // Category inheritance: prefer the gold side's category for this
    // subject (so paired statements bucket together), then the
    // factor-level fallback, then whatever the agent shipped, then
    // empty.
    const agentSubjKey = subjKey(a);
    const inheritedCategory =
      (agentSubjKey ? goldCategoryBySubject.get(agentSubjKey) : null) ??
      factorCategoryFallback ??
      (a.category
        ? { label: a.category.label ?? "", uri: a.category.uri ?? null }
        : { label: "", uri: null });
    out.push({
      category: {
        label: inheritedCategory.label ?? "",
        uri: inheritedCategory.uri ?? null,
      },
      subject: a.subject
        ? { label: a.subject.label ?? "", uri: a.subject.uri ?? null }
        : { label: "", uri: null },
      predicate: a.predicate
        ? { label: a.predicate.label ?? "", uri: a.predicate.uri ?? null }
        : null,
      object: a.object
        ? { label: a.object.label ?? "", uri: a.object.uri ?? null }
        : null,
    });
  }
  return out;
}
