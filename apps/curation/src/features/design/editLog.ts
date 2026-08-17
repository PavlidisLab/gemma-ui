/**
 * What the curator changed — as a record of the change, not a picture
 * of the result.
 *
 * ## Why this exists
 *
 * `commit()` sends the whole design. The store therefore keeps a base
 * design AND a curator row so a reconcile can subtract one from the
 * other and recover *what the curator meant*. But the UI knew that at
 * the moment of the click and threw it away. Everything downstream —
 * the base-vs-curator diff, the `ui-base → store-gold → pinned-commit`
 * fallback chain, the "a base must predate the edit" invariant,
 * timestamp windows, same-save tolerances — is machinery for
 * reconstructing an intent that was never written down.
 *
 * Three failures this answers, all measured on live landings
 * (`UI_WRITE_THE_EDIT_NOT_THE_DESIGN_2026_08_17`):
 *
 * 1. **A seeded row competing with gold.** A curator row was written
 *    whose content was the baseline, not gold, from a session with no
 *    edit in it. The reconcile could not tell that from a real change
 *    and would have reverted two factor descriptions and an FV
 *    relabel. Here, no edit means `edits: []` — a no-op commit says so
 *    out loud, and the row cannot compete with anything.
 * 2. **A factor the curator never touched deadlocking a landing.** The
 *    edit was a tag and a URI; the snapshot also carried a `disease`
 *    factor as it stood at save time, which later disagreed with a
 *    6-arm partition ruled into gold. A snapshot cannot distinguish
 *    "I changed this" from "this was on screen". A log only contains
 *    what moved.
 * 3. **Blank-vs-missing, 38 refusals across 24 experiments.** The
 *    reconcile refuses a factor differing from gold only by a blank
 *    description, because *"a blank is missing data, not an erase"*.
 *    {@link FactorFieldChange} carries both readings, so it is a fact.
 *
 * ## What a record has to carry
 *
 * **Identity, not position.** Every target ships every identity we
 * hold — `gemma_factor_id`, `local_factor_id`, category/value URIs,
 * labels — and lets the reader match on the strongest it recognises.
 * Same contract as {@link ProvenanceRef}, deliberately: half the
 * identity rollout has landed and a client that had to track which
 * half would be wrong on the other.
 *
 * **The base it was computed against.** {@link EditBase} is the field
 * that retires the fallback chain. Tonight's tally was `ui-base 1 ·
 * store-gold 0 · pinned-commit 62` — for 62 experiments the reconcile
 * diffed against a *git commit* because "which document was this edit
 * made against?" was nowhere on the wire. It is a question only the
 * client can answer, and it costs one object to answer it.
 *
 * ## Scope
 *
 * This is step 1 of three: write the edit *alongside* the snapshot, so
 * the log can be checked against the diff the reconcile computes today
 * before anything depends on it. Nothing here changes what `commit()`
 * writes. Steps 2 and 3 — read the log, then drop the snapshot and the
 * base/curator pair with it — are the store's, and are gated on that
 * agreement holding over a full landing.
 *
 * Derived from {@link diffDesign} rather than from a second walk of the
 * two designs: the point of step 1 is that the log and the reconcile's
 * diff agree, and they cannot drift apart if there is only one diff.
 */

import type {
  Biomaterial,
  Design,
  Factor,
  FactorValue,
  OntologyTerm,
  Publication,
  Statement,
  SubsetRecommendation,
  Tag,
} from "@/features/experiment/types";
import type { DesignDiff, FvChange } from "./diff";
import { diffDesign, publicationKey } from "./diff";
import { factorTarget, tagTarget } from "@/features/audit/targetIds";

/** add = it wasn't there and now is · remove = it was and isn't ·
 *  modify = it is there and one field reads differently. */
export type EditOp = "add" | "remove" | "modify";

export type EditTargetKind =
  | "factor"
  | "factor_value"
  | "tag"
  | "biomaterial"
  | "publication"
  | "subset_recommendation"
  /** The experiment itself — title, description, short name, the
   *  split decision. */
  | "design";

/**
 * What an edit was made to.
 *
 * `ref_id` is OUR handle for joining edits within one log, never an
 * identity claim — it is derived from draft-local ids that are stable
 * for the life of a page and meaningless outside it. The identity
 * fields beside it are the claim, and the reader matches on the
 * strongest one it recognises.
 */
export interface EditTarget {
  kind: EditTargetKind;
  ref_id: string;
  /** For a factor value: its owning factor's `ref_id`. A factor value
   *  has no identity of its own — 32 of 3,735 gold FVs carry an id,
   *  and an FV's de-facto identity is its sample partition within its
   *  factor — so the parent plus `label` is how one is found. */
  parent_ref_id?: string | null;
  gemma_factor_id?: number | null;
  local_factor_id?: string | null;
  category_uri?: string | null;
  category_label?: string | null;
  value_uri?: string | null;
  /** The reading that locates this thing in the base: an FV's label
   *  BEFORE the edit, a tag's value, a factor's name. For an `add`
   *  there is no before, so it is the new reading. */
  label?: string | null;
  /** Display convenience and last-resort match. NOT the key — the
   *  slug collides (two same-category factors share one). */
  target_id?: string | null;
}

/**
 * One thing the curator changed.
 *
 * `field` is null for a whole-object add or remove, where the object
 * IS the edit; otherwise it names what moved (`label`, `description`,
 * `category`, `baseline`, `statements`, `biomaterials`, or
 * `characteristics.<name>` for a per-characteristic edit).
 *
 * 🛑 `before` / `after` distinguish `null` (absent) from `""`
 * (emptied). Collapsing them is the bug this whole file exists to fix.
 */
export interface CurationEdit {
  op: EditOp;
  target: EditTarget;
  field: string | null;
  /** Absent-before for an `add`. */
  before: unknown;
  /** Absent-after for a `remove`. */
  after: unknown;
}

/**
 * Which document the edits were computed against.
 *
 * The reconcile's fallback chain exists because this was never
 * recorded. `content_hash` is the one field always available and
 * always sufficient — it identifies the exact bytes the curator
 * edited, whatever row they came from.
 */
export interface EditBase {
  /** `design` = the local editable design · `curation` = a chip-
   *  selected curation row the draft was seeded from. */
  source_kind: "design" | "curation";
  /** The curation row's own kind (`curator_polish`, `consensus`, …)
   *  when the base was a curation row. */
  curation_source_kind?: string | null;
  curation_id?: string | null;
  /** What the chip called it — `gold`, `local-curator`, … */
  label?: string | null;
  /** The gold version stamped on the base, where it carries one. */
  gold_data_version?: string | null;
  /** FNV-1a over the base design, the same hash the draft cache keys
   *  on. Identifies the bytes without needing a row to point at. */
  content_hash: string;
}

export interface EditActor {
  kind: "curator";
  /** The reviewer id the commit went out under. Empty when the UI has
   *  no curator key — the commit still happens (it writes /design),
   *  so the log has to be honest that the author is unknown rather
   *  than inventing one. */
  name: string;
}

export interface CurationEditLog {
  experiment_id: number | string;
  /** When the curator committed, not when each edit was made. Step 1
   *  derives the log from a diff at commit time, so per-edit
   *  timestamps would be fiction. */
  at: string;
  actor: EditActor;
  base: EditBase;
  edits: CurationEdit[];
}

/**
 * The gold version stamped on a design, where it carries one.
 *
 * The store's `Design` model has `goldDataVersion` and the snakeified
 * response therefore has `gold_data_version`, but the UI's `Design`
 * type does not model it: nothing renders it and nothing edits it. It
 * matters here and only here, as base identity, so it is read
 * defensively rather than declared — declaring it would invite
 * `normaliseDesignForSave` to start round-tripping a field the UI has
 * no business authoring.
 */
export function goldDataVersionOf(design: Design | null | undefined): string | null {
  const v = (design as unknown as { gold_data_version?: unknown } | null | undefined)
    ?.gold_data_version;
  return typeof v === "string" && v.length > 0 ? v : null;
}

/* ------------------------------------------------------------------ */
/* handles                                                             */
/* ------------------------------------------------------------------ */

export function factorEditRefId(factorId: number): string {
  return `factor:${factorId}`;
}

export function factorValueEditRefId(factorId: number, fvId: number): string {
  return `fv:${factorId}:${fvId}`;
}

export function tagEditRefId(tagId: number): string {
  return `tag:${tagId}`;
}

function factorEditTarget(factor: Factor): EditTarget {
  return {
    kind: "factor",
    ref_id: factorEditRefId(factor.id),
    gemma_factor_id: factor.gemma_factor_id ?? null,
    local_factor_id: factor.local_factor_id ?? null,
    category_uri: factor.category?.uri ?? null,
    category_label: factor.category?.label ?? null,
    label: factor.name || factor.category?.label || "",
    target_id: factorTarget(factor.category?.label || factor.name || ""),
  };
}

/** A factor value, named by its parent factor plus the label that
 *  locates it in the base. `at` is the reading to use: the BEFORE side
 *  for a modify or remove, the after side for an add. */
function factorValueEditTarget(parent: Factor, fv: FactorValue): EditTarget {
  return {
    kind: "factor_value",
    ref_id: factorValueEditRefId(parent.id, fv.id),
    parent_ref_id: factorEditRefId(parent.id),
    gemma_factor_id: parent.gemma_factor_id ?? null,
    local_factor_id: parent.local_factor_id ?? null,
    category_uri: parent.category?.uri ?? null,
    category_label: parent.category?.label ?? null,
    label: fv.free_text_label ?? null,
  };
}

function tagEditTarget(tag: Tag): EditTarget {
  return {
    kind: "tag",
    ref_id: tagEditRefId(tag.id),
    category_uri: tag.category?.uri ?? null,
    category_label: tag.category?.label ?? null,
    value_uri: tag.value?.uri ?? null,
    label: tag.value?.label ?? null,
    target_id: tagTarget(tag.category?.label ?? "", tag.value?.label ?? ""),
  };
}

function designEditTarget(design: Design): EditTarget {
  return {
    kind: "design",
    ref_id: `design:${design.experiment_id}`,
    label: design.experiment_short_name ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* serialization                                                       */
/* ------------------------------------------------------------------ */

/** A factor as the content of an add / remove. The factor values ride
 *  along because a factor without its arms is not the thing that was
 *  added — but each is reduced to what identifies it, not the whole
 *  editor-side object. */
function factorContent(f: Factor) {
  return {
    name: f.name ?? null,
    category: termContent(f.category),
    description: f.description ?? null,
    type: f.type ?? null,
    gemma_factor_id: f.gemma_factor_id ?? null,
    local_factor_id: f.local_factor_id ?? null,
    factor_values: (f.factor_values ?? []).map(factorValueContent),
  };
}

function factorValueContent(fv: FactorValue) {
  return {
    free_text_label: fv.free_text_label ?? null,
    is_baseline: fv.is_baseline ?? false,
    statements: (fv.statements ?? []).map(statementContent),
    biomaterial_short_names: [...(fv.biomaterial_short_names ?? [])].sort(),
    numeric_value: fv.numeric_value ?? null,
  };
}

function tagContent(t: Tag) {
  return {
    category: termContent(t.category),
    value: termContent(t.value),
    statements: (t.statements ?? []).map(statementContent),
    inferred: t.inferred ?? false,
    inferred_source: t.inferred_source ?? null,
    evidence_code: t.evidence_code ?? null,
  };
}

function statementContent(s: Statement) {
  return {
    category: termContent(s.category ?? null),
    subject: termContent(s.subject),
    predicate: termContent(s.predicate ?? null),
    object: termContent(s.object ?? null),
  };
}

function termContent(t: OntologyTerm | null | undefined) {
  if (!t) return null;
  return { label: t.label ?? null, uri: t.uri ?? null };
}

function subsetContent(r: SubsetRecommendation) {
  return {
    id: r.id,
    status: r.status ?? null,
    rationale: r.rationale ?? null,
    by_factor_id: r.by_factor_id ?? null,
    level_labels: [...(r.level_labels ?? [])],
    source: r.source ?? null,
  };
}

function publicationContent(p: Publication) {
  return {
    pubmed_id: p.pubmed_id ?? null,
    doi: p.doi ?? null,
    title: p.title ?? null,
    citation: p.citation ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* the build                                                           */
/* ------------------------------------------------------------------ */

export interface BuildEditLogArgs {
  experimentId: number | string;
  saved: Design | null;
  draft: Design | null;
  base: EditBase;
  reviewer: string;
  /** Injectable so tests don't race the clock. */
  at?: string;
  /** Reuse the diff the provider already computed rather than
   *  recomputing it — same object the commit bar rendered, so the log
   *  cannot describe a different edit than the one the curator saw. */
  diff?: DesignDiff;
}

/**
 * The curator's edit as a list of changes.
 *
 * Returns a log with `edits: []` when nothing moved. That empty log is
 * the useful case, not a degenerate one: it is how a commit says "I
 * opened this and changed nothing", which is what a seeded row could
 * never say for itself.
 */
export function buildEditLog(args: BuildEditLogArgs): CurationEditLog {
  const { experimentId, saved, draft, base, reviewer } = args;
  const at = args.at ?? new Date().toISOString();
  const log: CurationEditLog = {
    experiment_id: experimentId,
    at,
    actor: { kind: "curator", name: reviewer ?? "" },
    base,
    edits: [],
  };
  if (!saved || !draft) return log;

  const diff = args.diff ?? diffDesign(saved, draft);
  const edits: CurationEdit[] = [];

  collectFactorEdits(saved, draft, diff, edits);
  collectTagEdits(diff, edits);
  collectDesignEdits(saved, draft, edits);
  collectSubsetEdits(saved, draft, edits);
  collectPublicationEdits(saved, draft, edits);
  collectBiomaterialEdits(saved, draft, edits);

  log.edits = edits;
  return log;
}

function collectFactorEdits(
  saved: Design,
  draft: Design,
  diff: DesignDiff,
  out: CurationEdit[],
): void {
  for (const f of diff.factorsAdded) {
    out.push({
      op: "add",
      target: factorEditTarget(f),
      field: null,
      before: null,
      after: factorContent(f),
    });
  }
  for (const f of diff.factorsRemoved) {
    out.push({
      op: "remove",
      target: factorEditTarget(f),
      field: null,
      before: factorContent(f),
      after: null,
    });
  }

  const savedFactors = new Map((saved.factors ?? []).map((f) => [f.id, f]));
  const draftFactors = new Map((draft.factors ?? []).map((f) => [f.id, f]));

  for (const fd of diff.factorsChanged) {
    const before = savedFactors.get(fd.factorId);
    const after = draftFactors.get(fd.factorId);
    if (!before || !after) continue;
    // Identify the factor by how it read BEFORE the edit — that is
    // how it is found in the base. A rename that identified itself by
    // its new name would be unresolvable against gold.
    const target = factorEditTarget(before);

    for (const fc of fd.fieldChanges) {
      out.push({
        op: "modify",
        target,
        field: fc.field,
        before: fc.field === "category" ? termContent(fc.before as OntologyTerm) : fc.before,
        after: fc.field === "category" ? termContent(fc.after as OntologyTerm) : fc.after,
      });
    }

    for (const c of fd.added) pushFvEdit(before, after, c, out);
    for (const c of fd.removed) pushFvEdit(before, after, c, out);
    for (const c of fd.modified) pushFvEdit(before, after, c, out);
  }
}

/** An FV change becomes one edit for an add/remove, and one edit PER
 *  changed field for a modify — a relabel and a repartition are
 *  different claims about the same arm and a reader has to be able to
 *  take one without the other. */
function pushFvEdit(
  parentBefore: Factor,
  parentAfter: Factor,
  change: FvChange,
  out: CurationEdit[],
): void {
  if (change.kind === "added" && change.after) {
    out.push({
      op: "add",
      target: factorValueEditTarget(parentAfter, change.after),
      field: null,
      before: null,
      after: factorValueContent(change.after),
    });
    return;
  }
  if (change.kind === "removed" && change.before) {
    out.push({
      op: "remove",
      target: factorValueEditTarget(parentBefore, change.before),
      field: null,
      before: factorValueContent(change.before),
      after: null,
    });
    return;
  }
  const { before, after, fields } = change;
  if (!before || !after || !fields) return;
  const target = factorValueEditTarget(parentBefore, before);
  if (fields.label) {
    out.push({
      op: "modify",
      target,
      field: "label",
      before: before.free_text_label ?? null,
      after: after.free_text_label ?? null,
    });
  }
  if (fields.baseline) {
    out.push({
      op: "modify",
      target,
      field: "baseline",
      before: before.is_baseline ?? false,
      after: after.is_baseline ?? false,
    });
  }
  if (fields.statements) {
    out.push({
      op: "modify",
      target,
      field: "statements",
      before: (before.statements ?? []).map(statementContent),
      after: (after.statements ?? []).map(statementContent),
    });
  }
  if (fields.biomaterials) {
    out.push({
      op: "modify",
      target,
      field: "biomaterials",
      before: [...(before.biomaterial_short_names ?? [])].sort(),
      after: [...(after.biomaterial_short_names ?? [])].sort(),
    });
  }
}

function collectTagEdits(diff: DesignDiff, out: CurationEdit[]): void {
  for (const t of diff.tags.added) {
    out.push({
      op: "add",
      target: tagEditTarget(t),
      field: null,
      before: null,
      after: tagContent(t),
    });
  }
  for (const t of diff.tags.removed) {
    out.push({
      op: "remove",
      target: tagEditTarget(t),
      field: null,
      before: tagContent(t),
      after: null,
    });
  }
  for (const { before, after } of diff.tags.modified) {
    // Named by its before-reading, same reason as a factor rename.
    const target = tagEditTarget(before);
    if (!sameTermShallow(before.category, after.category)) {
      out.push({
        op: "modify",
        target,
        field: "category",
        before: termContent(before.category),
        after: termContent(after.category),
      });
    }
    if (!sameTermShallow(before.value, after.value)) {
      out.push({
        op: "modify",
        target,
        field: "value",
        before: termContent(before.value),
        after: termContent(after.value),
      });
    }
    const beforeStatements = (before.statements ?? []).map(statementContent);
    const afterStatements = (after.statements ?? []).map(statementContent);
    if (JSON.stringify(beforeStatements) !== JSON.stringify(afterStatements)) {
      out.push({
        op: "modify",
        target,
        field: "statements",
        before: beforeStatements,
        after: afterStatements,
      });
    }
  }
}

function sameTermShallow(
  a: OntologyTerm | null | undefined,
  b: OntologyTerm | null | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.label === b.label && (a.uri ?? null) === (b.uri ?? null);
}

/** Experiment-level scalars. `??  null` normalizes only `undefined` —
 *  an emptied title is `""` and stays `""`. */
function collectDesignEdits(
  saved: Design,
  draft: Design,
  out: CurationEdit[],
): void {
  const target = designEditTarget(saved);
  const scalar = (
    field: string,
    before: string | null | undefined,
    after: string | null | undefined,
  ) => {
    if ((before ?? null) === (after ?? null)) return;
    out.push({ op: "modify", target, field, before: before ?? null, after: after ?? null });
  };
  scalar("experiment_short_name", saved.experiment_short_name, draft.experiment_short_name);
  scalar("title", saved.title, draft.title);
  scalar("description", saved.description, draft.description);
  scalar("should_split_rationale", saved.should_split_rationale, draft.should_split_rationale);

  // ``-1`` (asserted "do NOT split") and ``null`` (no decision made)
  // are different answers — see diffMetadata.
  const beforeSplit = saved.should_split_on_factor_id ?? null;
  const afterSplit = draft.should_split_on_factor_id ?? null;
  if (beforeSplit !== afterSplit) {
    out.push({
      op: "modify",
      target,
      field: "should_split_on_factor_id",
      before: beforeSplit,
      after: afterSplit,
    });
  }
}

function collectSubsetEdits(
  saved: Design,
  draft: Design,
  out: CurationEdit[],
): void {
  const savedById = new Map(
    (saved.subset_recommendations ?? []).map((r) => [r.id, r]),
  );
  const draftById = new Map(
    (draft.subset_recommendations ?? []).map((r) => [r.id, r]),
  );
  const target = (r: SubsetRecommendation): EditTarget => ({
    kind: "subset_recommendation",
    ref_id: `subset:${r.id}`,
    label: r.id,
  });
  for (const r of draft.subset_recommendations ?? []) {
    const before = savedById.get(r.id);
    if (!before) {
      out.push({ op: "add", target: target(r), field: null, before: null, after: subsetContent(r) });
      continue;
    }
    const b = subsetContent(before);
    const a = subsetContent(r);
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      out.push({ op: "modify", target: target(before), field: null, before: b, after: a });
    }
  }
  for (const r of saved.subset_recommendations ?? []) {
    if (!draftById.has(r.id)) {
      out.push({ op: "remove", target: target(r), field: null, before: subsetContent(r), after: null });
    }
  }
}

function collectPublicationEdits(
  saved: Design,
  draft: Design,
  out: CurationEdit[],
): void {
  const savedByKey = new Map(
    (saved.publications ?? []).map((p) => [publicationKey(p), p]),
  );
  const draftByKey = new Map(
    (draft.publications ?? []).map((p) => [publicationKey(p), p]),
  );
  const target = (key: string, p: Publication): EditTarget => ({
    kind: "publication",
    ref_id: `publication:${key}`,
    label: p.pubmed_id ?? p.doi ?? p.title ?? null,
  });
  for (const [key, p] of draftByKey) {
    if (savedByKey.has(key)) continue;
    out.push({ op: "add", target: target(key, p), field: null, before: null, after: publicationContent(p) });
  }
  for (const [key, p] of savedByKey) {
    if (draftByKey.has(key)) continue;
    out.push({ op: "remove", target: target(key, p), field: null, before: publicationContent(p), after: null });
  }
}

/**
 * Per-biomaterial edits, one record per characteristic that moved.
 *
 * 🛑 The keys of `characteristics` are names the SUBMITTER wrote
 * (`BioSource`, `Genetic modification`) — they are data, not schema.
 * They travel verbatim into the `field` path and must never be
 * case-normalized on either side of the wire.
 */
function collectBiomaterialEdits(
  saved: Design,
  draft: Design,
  out: CurationEdit[],
): void {
  const savedByShort = new Map(
    (saved.biomaterials ?? []).map((b) => [b.short_name, b]),
  );
  const target = (b: Biomaterial): EditTarget => ({
    kind: "biomaterial",
    ref_id: `biomaterial:${b.short_name}`,
    label: b.short_name,
  });
  for (const after of draft.biomaterials ?? []) {
    const before = savedByShort.get(after.short_name);
    if (!before) {
      out.push({
        op: "add",
        target: target(after),
        field: null,
        before: null,
        after: { short_name: after.short_name, name: after.name ?? null },
      });
      continue;
    }
    if ((before.name ?? null) !== (after.name ?? null)) {
      out.push({
        op: "modify",
        target: target(before),
        field: "name",
        before: before.name ?? null,
        after: after.name ?? null,
      });
    }
    const keys = new Set([
      ...Object.keys(before.characteristics ?? {}),
      ...Object.keys(after.characteristics ?? {}),
      ...Object.keys(before.characteristic_uris ?? {}),
      ...Object.keys(after.characteristic_uris ?? {}),
    ]);
    for (const k of keys) {
      const bVal = before.characteristics?.[k] ?? null;
      const aVal = after.characteristics?.[k] ?? null;
      const bUri = before.characteristic_uris?.[k] ?? null;
      const aUri = after.characteristic_uris?.[k] ?? null;
      const sameUri =
        (bUri?.category_uri ?? null) === (aUri?.category_uri ?? null) &&
        (bUri?.value_uri ?? null) === (aUri?.value_uri ?? null);
      if (bVal === aVal && sameUri) continue;
      out.push({
        op: "modify",
        target: target(before),
        field: `characteristics.${k}`,
        before: { value: bVal, category_uri: bUri?.category_uri ?? null, value_uri: bUri?.value_uri ?? null },
        after: { value: aVal, category_uri: aUri?.category_uri ?? null, value_uri: aUri?.value_uri ?? null },
      });
    }
  }
}
