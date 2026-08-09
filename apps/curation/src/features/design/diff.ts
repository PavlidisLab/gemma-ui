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
  /** Counts for non-factor/-tag mutations the editor surfaces
   *  (banner short-name + title + description; per-sample name and
   *  characteristics; publication list). Each is the number of
   *  edited items, NOT a boolean — the commit bar can still surface
   *  a per-row breakdown if desired. ``isDirty`` already folds
   *  ``> 0`` of any of these into its OR-chain. Added 2026-06-13
   *  per the continuity sweep — the prior diff ignored these
   *  fields entirely, so curator edits to them never dirty the
   *  draft, never persist to localStorage, and silently survive a
   *  background ``/design`` refetch. */
  metadata: {
    biomaterialsModified: number;
    publicationsAdded: number;
    publicationsRemoved: number;
    shortNameChanged: boolean;
    titleChanged: boolean;
    descriptionChanged: boolean;
  };
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
  metadata: {
    biomaterialsModified: 0,
    publicationsAdded: 0,
    publicationsRemoved: 0,
    shortNameChanged: false,
    titleChanged: false,
    descriptionChanged: false,
  },
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
  const metadata = diffMetadata(saved, draft);

  const isDirty =
    factorsAdded.length > 0 ||
    factorsRemoved.length > 0 ||
    factorsChanged.length > 0 ||
    tagDiff.added.length > 0 ||
    tagDiff.removed.length > 0 ||
    tagDiff.modified.length > 0 ||
    metadata.biomaterialsModified > 0 ||
    metadata.publicationsAdded > 0 ||
    metadata.publicationsRemoved > 0 ||
    metadata.shortNameChanged ||
    metadata.titleChanged ||
    metadata.descriptionChanged;

  return {
    isDirty,
    factorsAdded,
    factorsRemoved,
    factorsChanged,
    tags: tagDiff,
    metadata,
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
  // Tags are statement-shaped EE-tags: category + value (the subject)
  // PLUS an optional statement list carrying predicate/object. Editing
  // only a tag's predicate/object changes ``statements`` but neither
  // category nor value — so comparing those two alone left such edits
  // invisible to the diff, the commit bar never lit, and the edit was
  // lost on the next refetch. Compare the statement arrays too, reusing
  // the same helper FactorValue statements use. Design review 2026-07-21.
  return (
    sameTerm(a.category, b.category) &&
    sameTerm(a.value, b.value) &&
    sameStatements(a.statements ?? [], b.statements ?? [])
  );
}

/** Diff the non-factor / non-tag fields the curator can edit. Counts:
 *
 *  - ``biomaterialsModified`` — number of biomaterials whose
 *    ``name`` or ``characteristics`` (incl. ``characteristic_uris``)
 *    differ between saved and draft. Keyed on ``short_name`` since
 *    that's the stable id agents-side ships.
 *  - ``publicationsAdded`` / ``publicationsRemoved`` — set diff
 *    keyed on ``pubmed_id`` first, then ``doi``, then a stable
 *    ``title|citation`` composite. (Publications without any of
 *    these fall back to never-matching, which is conservative — a
 *    truly-empty add reads as added, a truly-empty remove as
 *    removed, and the curator's commit bar shows the count.)
 *  - boolean ``Changed`` flags for ``experiment_short_name`` /
 *    ``title`` / ``description`` — single-value scalars.
 *
 *  Per the 2026-06-13 continuity sweep: all five were silently
 *  ignored by the prior diff so curator edits to them never
 *  dirtied the draft. */
function diffMetadata(saved: Design, draft: Design): DesignDiff["metadata"] {
  // -- Biomaterials -----------------------------------------------
  const savedBmByShort = new Map(
    (saved.biomaterials ?? []).map((b) => [b.short_name, b]),
  );
  let biomaterialsModified = 0;
  for (const dbm of draft.biomaterials ?? []) {
    const sbm = savedBmByShort.get(dbm.short_name);
    if (!sbm) {
      // New biomaterial on draft (rare — biomaterials are usually
      // server-allocated). Count as modified so the change surfaces.
      biomaterialsModified++;
      continue;
    }
    if (sbm.name !== dbm.name) {
      biomaterialsModified++;
      continue;
    }
    if (
      !sameStringMap(sbm.characteristics ?? {}, dbm.characteristics ?? {})
    ) {
      biomaterialsModified++;
      continue;
    }
    if (
      !sameUriMap(
        sbm.characteristic_uris ?? {},
        dbm.characteristic_uris ?? {},
      )
    ) {
      biomaterialsModified++;
      continue;
    }
  }

  // -- Publications -----------------------------------------------
  const pubKey = (p: { pubmed_id?: string; doi?: string; title?: string; citation?: string }): string => {
    const pmid = (p.pubmed_id ?? "").trim();
    if (pmid) return `pmid:${pmid.toLowerCase()}`;
    const doi = (p.doi ?? "").trim();
    if (doi) return `doi:${doi.toLowerCase()}`;
    return `tc:${(p.title ?? "").trim()}|${(p.citation ?? "").trim()}`;
  };
  const savedPubs = new Set((saved.publications ?? []).map(pubKey));
  const draftPubs = new Set((draft.publications ?? []).map(pubKey));
  let publicationsAdded = 0;
  let publicationsRemoved = 0;
  for (const k of draftPubs) if (!savedPubs.has(k)) publicationsAdded++;
  for (const k of savedPubs) if (!draftPubs.has(k)) publicationsRemoved++;

  // -- Scalars ----------------------------------------------------
  const shortNameChanged =
    (saved.experiment_short_name ?? "") !== (draft.experiment_short_name ?? "");
  const titleChanged = (saved.title ?? "") !== (draft.title ?? "");
  const descriptionChanged = (saved.description ?? "") !== (draft.description ?? "");

  return {
    biomaterialsModified,
    publicationsAdded,
    publicationsRemoved,
    shortNameChanged,
    titleChanged,
    descriptionChanged,
  };
}

function sameStringMap(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

function sameUriMap(
  a: Record<string, { category_uri?: string | null; value_uri?: string | null }>,
  b: Record<string, { category_uri?: string | null; value_uri?: string | null }>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    const av = a[k];
    const bv = b[k];
    if (!bv) return false;
    if ((av.category_uri ?? null) !== (bv.category_uri ?? null)) return false;
    if ((av.value_uri ?? null) !== (bv.value_uri ?? null)) return false;
  }
  return true;
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

// ---------------------------------------------------------------------------
// Cross-source semantic diff.
//
// ``diffDesign`` above matches by Gemma-assigned IDs (factor.id,
// tag.id, fv.id) — correct for the in-experiment edit buffer where
// the draft is a structural mutation of the saved server design.
// Cross-source comparisons (preboard vs Cy's polished export, Cy
// polished vs Am polished, …) can't trust the IDs — separate
// curation lineages may produce different IDs for what is
// conceptually the same factor / tag.
//
// ``summariseSemanticDiff`` matches on OBVIOUS keys only:
//   - factors  → category URI (or category label if URI absent)
//   - tags     → (category URI || label, value URI || label)
// Anything that doesn't match on those keys lands in added/removed.
// We do NOT reach for fuzzy / ontology-distance / RAG matchers —
// per design review 2026-05-27, "if it's not obvious, it doesn't deserve to
// match." Honest add/remove pairs beat over-eager "modified".
// ---------------------------------------------------------------------------

export interface SemanticDiffSummary {
  addedTags: number;
  removedTags: number;
  modifiedTags: number;
  addedFactors: number;
  removedFactors: number;
  modifiedFactors: number;
  /** ``true`` when every count is zero — drives the regression-test
   *  invariant (baseline = comparator → empty diff). */
  empty: boolean;
}

const EMPTY_SEMANTIC_DIFF: SemanticDiffSummary = {
  addedTags: 0,
  removedTags: 0,
  modifiedTags: 0,
  addedFactors: 0,
  removedFactors: 0,
  modifiedFactors: 0,
  empty: true,
};

function factorKey(f: Factor): string {
  const cat = f.category;
  if (cat?.uri) return `uri:${cat.uri.toLowerCase()}`;
  if (cat?.label) return `label:${cat.label.toLowerCase()}`;
  return `name:${(f.name || "").toLowerCase()}`;
}

function tagKey(t: Tag): string {
  const c = t.category;
  const v = t.value;
  const ck = c?.uri ?? c?.label ?? "";
  const vk = v?.uri ?? v?.label ?? "";
  return `${ck.toLowerCase()}|${vk.toLowerCase()}`;
}

export function summariseSemanticDiff(
  baseline: Design | null | undefined,
  comparator: Design | null | undefined,
): SemanticDiffSummary {
  if (!baseline || !comparator) return EMPTY_SEMANTIC_DIFF;

  const baseFactors = baseline.factors ?? [];
  const cmpFactors = comparator.factors ?? [];
  const baseByFactor = new Map(baseFactors.map((f) => [factorKey(f), f]));
  const cmpByFactor = new Map(cmpFactors.map((f) => [factorKey(f), f]));

  let addedFactors = 0;
  let removedFactors = 0;
  let modifiedFactors = 0;
  for (const [k, cmp] of cmpByFactor) {
    const base = baseByFactor.get(k);
    if (!base) {
      addedFactors++;
      continue;
    }
    if (!sameFactorFields(base, cmp)) modifiedFactors++;
  }
  for (const k of baseByFactor.keys()) {
    if (!cmpByFactor.has(k)) removedFactors++;
  }

  // Inferred rows are excluded from BOTH sides. An ``inferred`` row is
  // Gemma's display of a constant biomaterial characteristic, not a
  // stored ExperimentTag — it isn't something either curation lineage
  // asserted, so it can't be added or removed BY one. Counting them
  // made GSE102352 read "TAGS -3" for gold vs the agent's proposal
  // where gold holds one real tag and two projections of the sample
  // table (handoff AGENTS_ASK_2026_08_09_TICKET_SHOULD_PIN_ITS_BASELINE,
  // addendum). The Overview marks them inherited and offers a Hide
  // toggle; this readout had no such out.
  //
  // Consequence worth knowing: when one side carries a value only as a
  // projection and the other has curated it into a real tag, that now
  // reads as an added tag — which is exactly what happened.
  const baseTags = (baseline.tags ?? []).filter((t) => !t.inferred);
  const cmpTags = (comparator.tags ?? []).filter((t) => !t.inferred);
  const baseByTag = new Map(baseTags.map((t) => [tagKey(t), t]));
  const cmpByTag = new Map(cmpTags.map((t) => [tagKey(t), t]));

  let addedTags = 0;
  let removedTags = 0;
  let modifiedTags = 0;
  for (const [k, cmp] of cmpByTag) {
    const base = baseByTag.get(k);
    if (!base) {
      addedTags++;
      continue;
    }
    if (!sameTag(base, cmp)) modifiedTags++;
  }
  for (const k of baseByTag.keys()) {
    if (!cmpByTag.has(k)) removedTags++;
  }

  const empty =
    addedFactors + removedFactors + modifiedFactors === 0 &&
    addedTags + removedTags + modifiedTags === 0;

  return {
    addedFactors,
    removedFactors,
    modifiedFactors,
    addedTags,
    removedTags,
    modifiedTags,
    empty,
  };
}
