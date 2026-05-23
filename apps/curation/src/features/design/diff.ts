/**
 * Pure diff utilities for the Design edit buffer.
 *
 * `diffDesign(saved, draft)` produces a per-factor breakdown of which
 * FactorValues are added / removed / modified relative to the saved
 * server state. The DesignEditor uses this to badge the UI and
 * populate the commit bar; the diff has no knowledge of React.
 *
 * "Modified" is defined by structural inequality on label / baseline /
 * statements / biomaterial set. Statement order is significant — Gemma
 * preserves order — so a reorder counts as modified.
 */
import type {
  Design,
  Factor,
  FactorValue,
  Statement,
  Tag,
} from "@/features/experiment/types";

export type FvChangeKind = "added" | "removed" | "modified";

export interface FvModification {
  label: boolean;
  baseline: boolean;
  statements: boolean;
  biomaterials: boolean;
}

export interface FvChange {
  kind: FvChangeKind;
  factorId: number;
  fvId: number;
  before?: FactorValue; // undefined for "added"
  after?: FactorValue;  // undefined for "removed"
  /** which fields differ; only populated for "modified". */
  fields?: FvModification;
}

export interface FactorDiff {
  factorId: number;
  factorName: string;
  /** factor-level: name / category / type changes. */
  factorFieldsChanged: boolean;
  added: FvChange[];
  removed: FvChange[];
  modified: FvChange[];
}

export interface TagDiff {
  added: Tag[];
  removed: Tag[];
  modified: { before: Tag; after: Tag }[];
}

export interface DesignDiff {
  isDirty: boolean;
  factorsAdded: Factor[];
  factorsRemoved: Factor[];
  factorsChanged: FactorDiff[];
  tags: TagDiff;
  totals: {
    addedFvs: number;
    removedFvs: number;
    modifiedFvs: number;
    addedFactors: number;
    removedFactors: number;
    factorFieldsChanged: number;
    addedTags: number;
    removedTags: number;
    modifiedTags: number;
  };
}

const EMPTY_DIFF: DesignDiff = {
  isDirty: false,
  factorsAdded: [],
  factorsRemoved: [],
  factorsChanged: [],
  tags: { added: [], removed: [], modified: [] },
  totals: {
    addedFvs: 0,
    removedFvs: 0,
    modifiedFvs: 0,
    addedFactors: 0,
    removedFactors: 0,
    factorFieldsChanged: 0,
    addedTags: 0,
    removedTags: 0,
    modifiedTags: 0,
  },
};

export function diffDesign(saved: Design | null, draft: Design | null): DesignDiff {
  if (!saved || !draft) return EMPTY_DIFF;
  // Defensive: a malformed payload (e.g. Gemma 2.0's design shape
  // mapped through the wrong adapter, or an error envelope reaching
  // this far) can leave ``factors`` / ``tags`` / ``biomaterials``
  // undefined. The diff machinery should treat those as empty
  // rather than crashing the whole DesignDraftProvider with
  // "cannot read properties of undefined (reading 'map')".
  const savedFactorList = saved.factors ?? [];
  const draftFactorList = draft.factors ?? [];

  const savedFactors = new Map(savedFactorList.map((f) => [f.id, f]));
  const draftFactors = new Map(draftFactorList.map((f) => [f.id, f]));

  const factorsAdded: Factor[] = draftFactorList.filter(
    (f) => !savedFactors.has(f.id),
  );
  const factorsRemoved: Factor[] = savedFactorList.filter(
    (f) => !draftFactors.has(f.id),
  );

  const factorsChanged: FactorDiff[] = [];
  let addedFvs = 0;
  let removedFvs = 0;
  let modifiedFvs = 0;
  let factorFieldsChangedCount = 0;

  for (const sf of savedFactorList) {
    const df = draftFactors.get(sf.id);
    if (!df) continue;
    const fd = diffFactorValues(sf, df);
    const factorFieldsChanged = !sameFactorFields(sf, df);
    if (factorFieldsChanged) factorFieldsChangedCount++;
    if (
      fd.added.length === 0 &&
      fd.removed.length === 0 &&
      fd.modified.length === 0 &&
      !factorFieldsChanged
    ) {
      continue;
    }
    // Continuous factors carry one FV per sample (the per-sample
    // measurement). Curator-facing FV-count summaries treat those
    // as a single unit alongside the factor itself, not as N
    // independent edits — otherwise an N=171 cohort lands as
    // "171 new FVs" in the commit bar, which is meaningless to
    // the curator. The detail breakdown still includes them so
    // the editor can render the FV cards individually.
    const isContinuous = df.type === "continuous" || sf.type === "continuous";
    if (!isContinuous) {
      addedFvs += fd.added.length;
      removedFvs += fd.removed.length;
      modifiedFvs += fd.modified.length;
    }
    factorsChanged.push({
      factorId: sf.id,
      factorName: sf.name,
      factorFieldsChanged,
      ...fd,
    });
  }

  // FVs inside newly-added factors are "added" too — surface for
  // totals, but only for categorical factors (continuous factors'
  // per-sample measurements ride with the factor add itself).
  for (const f of factorsAdded) {
    if (f.type !== "continuous") addedFvs += f.factor_values.length;
  }
  for (const f of factorsRemoved) {
    if (f.type !== "continuous") removedFvs += f.factor_values.length;
  }

  const tagDiff = diffTags(saved.tags ?? [], draft.tags ?? []);

  const isDirty =
    factorsAdded.length > 0 ||
    factorsRemoved.length > 0 ||
    factorsChanged.length > 0 ||
    tagDiff.added.length > 0 ||
    tagDiff.removed.length > 0 ||
    tagDiff.modified.length > 0;

  return {
    isDirty,
    factorsAdded,
    factorsRemoved,
    factorsChanged,
    tags: tagDiff,
    totals: {
      addedFvs,
      removedFvs,
      modifiedFvs,
      addedFactors: factorsAdded.length,
      removedFactors: factorsRemoved.length,
      factorFieldsChanged: factorFieldsChangedCount,
      addedTags: tagDiff.added.length,
      removedTags: tagDiff.removed.length,
      modifiedTags: tagDiff.modified.length,
    },
  };
}

function diffTags(saved: Tag[], draft: Tag[]): TagDiff {
  const savedById = new Map(saved.map((t) => [t.id, t]));
  const draftById = new Map(draft.map((t) => [t.id, t]));

  const added = draft.filter((t) => !savedById.has(t.id));
  const removed = saved.filter((t) => !draftById.has(t.id));
  const modified: { before: Tag; after: Tag }[] = [];
  for (const t of saved) {
    const after = draftById.get(t.id);
    if (after && !sameTag(t, after)) {
      modified.push({ before: t, after });
    }
  }
  return { added, removed, modified };
}

function sameTag(a: Tag, b: Tag): boolean {
  return sameTerm(a.category, b.category) && sameTerm(a.value, b.value);
}

function diffFactorValues(
  saved: Factor,
  draft: Factor,
): { added: FvChange[]; removed: FvChange[]; modified: FvChange[] } {
  const savedById = new Map(saved.factor_values.map((fv) => [fv.id, fv]));
  const draftById = new Map(draft.factor_values.map((fv) => [fv.id, fv]));

  const added: FvChange[] = [];
  const removed: FvChange[] = [];
  const modified: FvChange[] = [];

  for (const fv of draft.factor_values) {
    if (!savedById.has(fv.id)) {
      added.push({
        kind: "added",
        factorId: draft.id,
        fvId: fv.id,
        after: fv,
      });
    }
  }
  for (const fv of saved.factor_values) {
    if (!draftById.has(fv.id)) {
      removed.push({
        kind: "removed",
        factorId: saved.id,
        fvId: fv.id,
        before: fv,
      });
      continue;
    }
    const after = draftById.get(fv.id)!;
    const fields = fvFieldDiff(fv, after);
    if (anyFieldChanged(fields)) {
      modified.push({
        kind: "modified",
        factorId: saved.id,
        fvId: fv.id,
        before: fv,
        after,
        fields,
      });
    }
  }

  return { added, removed, modified };
}

function fvFieldDiff(a: FactorValue, b: FactorValue): FvModification {
  return {
    label: a.free_text_label !== b.free_text_label,
    baseline: a.is_baseline !== b.is_baseline,
    statements: !sameStatements(a.statements, b.statements),
    biomaterials: !sameStringSet(
      a.biomaterial_short_names,
      b.biomaterial_short_names,
    ),
  };
}

function anyFieldChanged(f: FvModification): boolean {
  return f.label || f.baseline || f.statements || f.biomaterials;
}

function sameFactorFields(a: Factor, b: Factor): boolean {
  return (
    a.name === b.name &&
    a.type === b.type &&
    a.description === b.description &&
    sameTerm(a.category, b.category)
  );
}

function sameStatements(a: Statement[], b: Statement[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!sameStatement(a[i], b[i])) return false;
  }
  return true;
}

function sameStatement(a: Statement, b: Statement): boolean {
  return (
    sameTerm(a.category ?? null, b.category ?? null) &&
    sameTerm(a.subject, b.subject) &&
    sameTerm(a.predicate ?? null, b.predicate ?? null) &&
    sameTerm(a.object ?? null, b.object ?? null)
  );
}

function sameTerm(
  a: { label: string; uri?: string | null } | null,
  b: { label: string; uri?: string | null } | null,
): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a.label === b.label && (a.uri ?? null) === (b.uri ?? null);
}

function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  for (const x of b) if (!setA.has(x)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Per-FV change lookup, used by the editor to badge cards.
// ---------------------------------------------------------------------------

export interface FvChangeIndex {
  /** factorId → fvId → change. Includes "removed" so the UI can
   *  optionally render tombstones. */
  byFv: Map<number, Map<number, FvChange>>;
  factorsAdded: Set<number>;
  factorsRemoved: Set<number>;
}

export function indexChanges(diff: DesignDiff): FvChangeIndex {
  const byFv = new Map<number, Map<number, FvChange>>();
  const ensure = (factorId: number) => {
    let m = byFv.get(factorId);
    if (!m) {
      m = new Map();
      byFv.set(factorId, m);
    }
    return m;
  };
  for (const fc of diff.factorsChanged) {
    const m = ensure(fc.factorId);
    for (const c of fc.added) m.set(c.fvId, c);
    for (const c of fc.removed) m.set(c.fvId, c);
    for (const c of fc.modified) m.set(c.fvId, c);
  }
  for (const f of diff.factorsAdded) {
    const m = ensure(f.id);
    for (const fv of f.factor_values) {
      m.set(fv.id, {
        kind: "added",
        factorId: f.id,
        fvId: fv.id,
        after: fv,
      });
    }
  }
  return {
    byFv,
    factorsAdded: new Set(diff.factorsAdded.map((f) => f.id)),
    factorsRemoved: new Set(diff.factorsRemoved.map((f) => f.id)),
  };
}
