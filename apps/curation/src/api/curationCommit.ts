/**
 * The curation commit chain, through the agent relay.
 *
 * `preflight` -> `commit` -> `sign`, replacing the UI's own
 * `PUT /design`. The UI is a read-only client of Gemma; the agent does
 * the writing, so these post to the agent and it forwards.
 *
 * Types mirror Gemma's `CurationDocument` as its OpenAPI declares it
 * (`WellComposedErrorBody`, `SectionFactorCommit`, …), not a sample —
 * the relay itself declares an untyped passthrough body, so the schema
 * on the far side is the only contract there is.
 *
 * 🛑 **The document builder is REMOTE-MODE ONLY.** Every commit item
 * names its target with `gemmaId` (update this) or `clientRef` (create
 * this), and sending a local id as a `gemmaId` rewrites whatever
 * happens to hold that id in Gemma. See `buildCurationDocument`.
 */
import { api } from "./client";
import { commitConflictOf, type CommitConflict } from "./commitConflict";

/** A term as the commit wire names it — label plus URI, nothing else. */
export interface OntologyTermRef {
  label?: string;
  uri?: string;
}

/** Every commit item names its target ONE of two ways.
 *  `gemmaId` updates an existing entity; `clientRef` creates a new one
 *  and comes back in the response's `idMap`. Sending neither, or a
 *  `clientRef` for something that already exists, creates a duplicate. */
export interface CommitTarget {
  gemmaId?: number;
  clientRef?: string;
}

export interface StatementCommit extends CommitTarget {
  category?: OntologyTermRef;
  subject?: OntologyTermRef;
  predicate?: OntologyTermRef;
  object?: OntologyTermRef;
  supportingEvidence?: unknown;
}

/** A section of the document: the items to keep or change, and the
 *  gemmaIds to remove. Absent `deletedIds` removes nothing. */
export interface CommitSection<T> {
  items?: T[];
  deletedIds?: number[];
}

export interface FactorValueCommit extends CommitTarget {
  freeTextLabel?: string;
  measurement?: unknown;
  biomaterialShortNames?: string[];
  statements?: CommitSection<StatementCommit>;
  isBaseline?: boolean;
}

export interface FactorCommit extends CommitTarget {
  name?: string;
  category?: OntologyTermRef;
  description?: string;
  type?: string;
  factorValues?: CommitSection<FactorValueCommit>;
}

export interface TagCommit extends CommitTarget {
  category?: OntologyTermRef;
  value?: OntologyTermRef;
  statements?: CommitSection<StatementCommit>;
  supportingEvidence?: unknown;
}

export interface CurationDocument {
  /** The dataset state this edit was built against. Gemma 409s with
   *  `STALE_BASELINE` when it has moved on. */
  baseline?: { lastModified?: string };
  basics?: { name?: string; description?: string; shortName?: string };
  design?: {
    factors?: CommitSection<FactorCommit>;
    shouldSplitOnFactorId?: number;
    shouldSplitRationale?: string;
  };
  tags?: CommitSection<TagCommit>;
  curationDetails?: {
    troubled?: boolean;
    needsAttention?: boolean;
    curationNote?: string;
  };
}

export interface CommitReport {
  applied: boolean;
  idMap: Record<string, number>;
  changes: Record<string, unknown>;
  auditEventIds: number[];
  canonicalizations: unknown[];
  commitAnnotationSetId: number | null;
  /** Feed to the NEXT commit as `baselineLastModified` — that is what
   *  lets a curator edit and commit repeatedly without re-reading. */
  newBaseline?: string | null;
  /** The undo: the annotation set captured before this commit. */
  snapshotAnnotationSetId?: number | null;
}

function qs(params: Record<string, string | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

/**
 * The dry run. Writes nothing, needs no write target, and reports
 * which analyses a commit would invalidate — the invalidation rule is
 * an exclusion, so nearly every structural edit triggers it and this
 * report is what the curator decides on.
 *
 * 🛑 **A green preflight is NOT a green commit, and the gap is not
 * small.** Preflight does not take the curation lock and is exempt
 * from the agent's `require_gemma_write_base` guard; commit is neither.
 * Measured 2026-08-29, two different ways:
 *
 *   - through the agent relay: `POST /curation-preflight/{id}` -> 401
 *     (route live, wants auth) while commit and sign -> 502, the write
 *     guard refusing for want of a target;
 *   - direct at Gemma, by cab on the sandbox: preflight -> 200 with
 *     `changes.design.updated = 1`, and the very same commit -> 500 on
 *     a lock-table column the schema lacked.
 *
 * So whatever surface wires this must NOT present a clean preflight as
 * "this will work" — it means "the document is well formed and here is
 * what it would change", nothing about whether the commit can run.
 */
export function preflightCuration(
  experimentId: number | string,
  doc: CurationDocument,
  onBehalfOf?: string,
): Promise<CommitReport> {
  return api.post<CommitReport>(
    `/curation-preflight/${experimentId}${qs({ onBehalfOf })}`,
    doc,
  );
}

/**
 * The commit.
 *
 * 🛑 `force` is deliberately NOT a parameter here. Sign is the route
 * for a change with consequences, and Gemma gates sign on holding the
 * lock rather than on being an admin — so a `REQUIRES_FORCE` conflict
 * becomes "review what is affected, then sign", never a force button.
 *
 * A 200 means EVERYTHING applied; there is no partial write to
 * reconcile.
 *
 * 🛑 **A 403 here does NOT mean the curator lacks permission**, and the
 * surface that wires this must not say so. Settled 2026-08-29 across
 * three of us:
 *
 * `applyDesignChange` → `updateFactorMetadata` →
 * `experimentalFactorService.update`, which is
 * `@Secured({"GROUP_USER","ACL_SECURABLE_EDIT"})` and reads the
 * **ExperimentalFactor's own** `acl_object_identity` row. Factors are
 * `SecuredChild` entities that get their OI at CREATE time via
 * `AclAdvice`. Where that row is missing there is no OI to read, the
 * voter denies, and **an admin is denied too** — mask 16 on the parent
 * EE does not help, because it is the child being read.
 *
 * This is not hypothetical on production: gembro's ACL linter counted
 * **1,920 FactorValues and others without OIs** (partial scan). So a
 * design commit fails on an ACL-incomplete dataset, and the honest
 * message is "this dataset's annotation records are incomplete —
 * report it", never "you do not have permission". Sending a curator to
 * ask for access they already hold is the failure mode to avoid.
 *
 * Tells it apart from a real authorization problem: `curationDetails`
 * commits fine on the same dataset (it never touches a factor) and
 * preflight 200s (a dry run reads nothing secured).
 */
export function commitCuration(
  experimentId: number | string,
  doc: CurationDocument,
  opts: { baselineLastModified?: string; onBehalfOf?: string } = {},
): Promise<CommitReport> {
  return api.post<CommitReport>(
    `/curation-commit/${experimentId}${qs({
      baselineLastModified: opts.baselineLastModified,
      onBehalfOf: opts.onBehalfOf,
    })}`,
    doc,
  );
}

/**
 * Sign off on a commit whose consequences the curator has accepted.
 *
 * ⚠️ A successful sign RELEASES the curation lock. Anything showing
 * lock state must re-read rather than assume it still holds — the
 * chip's own 30 s poll gets there eventually, but not promptly.
 */
export function signCuration(
  experimentId: number | string,
  body?: unknown,
  onBehalfOf?: string,
): Promise<CommitReport> {
  return api.post<CommitReport>(
    `/curation-sign/${experimentId}${qs({ onBehalfOf })}`,
    body ?? {},
  );
}

/** The reason a commit was refused, or null when it was not a 409
 *  carrying one. Re-exported so callers need one import. */
export function conflictOf(err: unknown): CommitConflict | null {
  return commitConflictOf(err);
}

// ---------------------------------------------------------------------------
// Design -> CurationDocument
// ---------------------------------------------------------------------------

/** Thrown instead of building a document from a design Gemma did not
 *  seed. Its message is what a developer reads, not a curator. */
export const LOCAL_DESIGN_NOT_COMMITTABLE =
  "Refusing to build a curation document from a local-mode design: its " +
  "ids are the store's own and would be sent to Gemma as `gemmaId`, " +
  "rewriting whatever holds those ids there.";

/**
 * Does this row already exist in Gemma, and under what id?
 *
 * 🛑 **In remote mode the discriminator is the SIGN of the id**, and
 * that is not a convention anyone declared — it falls out of
 * `composeCurationDesign`. Rows seeded from Gemma keep Gemma's id
 * verbatim (`id: ef.id`, `id: v.id`); rows that exist only in an agent
 * PROPOSAL are materialised negative — `-(fi + 1)` for a factor,
 * `-((fi + 1) * 1000 + (vi + 1))` for a value.
 *
 * Measured on gemma2 design 1658: factors 8715 / 11727 / 11728 / 23079,
 * values 64275 … 77279 — all positive, five-digit, so they cannot
 * collide with the negatives.
 *
 * 🛑 **The sign test is meaningless in LOCAL mode**, where the store's
 * ids are small locals AND positive: `1, 2, 3` would go out as
 * `gemmaId` and corrupt a real design. That is why the builder refuses
 * outright rather than trying to be clever per row. See
 * `reference_factor_value_identity_two_conventions`.
 */
function commitTarget(id: number | null | undefined, kind: string): CommitTarget {
  if (typeof id === "number" && id > 0) return { gemmaId: id };
  // Stable within one document, which is all `clientRef` has to be —
  // the response's `idMap` keys off it to report what was created.
  return { clientRef: `${kind}-${id ?? "new"}` };
}

function term(t: { label?: string; uri?: string | null } | null | undefined):
  | OntologyTermRef
  | undefined {
  if (!t) return undefined;
  const label = t.label?.trim();
  const uri = t.uri ?? undefined;
  if (!label && !uri) return undefined;
  return { ...(label ? { label } : {}), ...(uri ? { uri } : {}) };
}

/**
 * What the curator deleted, as ids Gemma issued.
 *
 * Structural for the same reason as {@link CommittableDesign} — the
 * commit contract does not depend on the editor's types. Build it with
 * `removalsFromDiff` in `features/design/removals.ts`, which is where
 * the `DesignDiff` that knows these ids lives.
 *
 * 🛑 **A statement id is shared by the PAIRS of one statement.** Two
 * rows carrying the same `gemma_id` are two pairs of a single Gemma
 * statement, so removing one pair and keeping the other is an UPDATE of
 * that statement, not a deletion. Only an id whose every pair is gone
 * belongs here; `removalsFromDiff` enforces that, and a caller building
 * this by hand must too. See `reference_statement_max_two_pairs`.
 */
export interface CommittableRemovals {
  /** Factors deleted outright. Their values go with them — do not also
   *  list those under {@link factorValues}. */
  factorIds?: number[];
  /** Values deleted from a factor that SURVIVES, keyed by the id the
   *  design gives that factor (`gemma_factor_id ?? id`). */
  factorValues?: Array<{ factorId: number; valueIds: number[] }>;
  /** Statements deleted from a value that SURVIVES, keyed by the
   *  value's id. */
  statements?: Array<{ valueId: number; statementIds: number[] }>;
  /** Experiment-level tags deleted. */
  tagIds?: number[];
}

/** Ids Gemma issued, in the order given, with anything it did not
 *  issue dropped. In remote mode a non-positive id is an agent-proposed
 *  row that was never sent, so there is nothing on the far side to
 *  delete and naming it would be a guess. */
function gemmaIds(ids: number[] | undefined): number[] {
  return (ids ?? []).filter((id) => typeof id === "number" && id > 0);
}

/** A `deletedIds` key, or nothing at all. An absent key removes
 *  nothing; an empty array is the same instruction spelled louder, and
 *  emitting one would put a delete section on every commit that has no
 *  deletions in it. */
function deletion(ids: number[] | undefined): { deletedIds?: number[] } {
  const kept = gemmaIds(ids);
  return kept.length ? { deletedIds: kept } : {};
}

/** Minimal shape this builder reads. Declared structurally rather than
 *  importing `Design` so the commit contract does not acquire a
 *  dependency on the whole editor's type surface. */
export interface CommittableDesign {
  factors?: Array<{
    id: number;
    gemma_factor_id?: number | null;
    name?: string;
    description?: string;
    type?: string;
    category?: { label?: string; uri?: string | null } | null;
    factor_values?: Array<{
      id: number;
      free_text_label?: string;
      is_baseline?: boolean;
      biomaterial_short_names?: string[];
      statements?: Array<{
        gemma_id?: number | null;
        category?: { label?: string; uri?: string | null } | null;
        subject?: { label?: string; uri?: string | null } | null;
        predicate?: { label?: string; uri?: string | null } | null;
        object?: { label?: string; uri?: string | null } | null;
      }>;
    }>;
  }>;
  tags?: Array<{
    id: number;
    inferred?: boolean;
    category?: { label?: string; uri?: string | null } | null;
    value?: { label?: string; uri?: string | null } | null;
  }>;
  should_split_on_factor_id?: number | null;
  should_split_rationale?: string;
}

/**
 * Build the commit document for a design that was seeded from Gemma.
 *
 * 🛑 **Deletions travel in `removals`, NOT in the design.** The design
 * argument is what the curator has now, so something they deleted is
 * simply absent from it, and absent means "unchanged" to Gemma, not
 * "remove this". The tombstones are a separate argument because they
 * are separate information — `DesignDiff` is the only thing that knows
 * an id used to be there. `removalsFromDiff` converts one to the other.
 *
 * 🛑 **Omitting `removals` keeps the old behaviour exactly**: no
 * `deletedIds` key is emitted and the document removes nothing. That
 * is still the right call for any caller that has no diff in hand — a
 * missed deletion is visible and fixable, an unintended one is neither.
 *
 * 🛑 **Only ids Gemma issued are ever named.** In remote mode a
 * positive id came from Gemma and a negative one was minted for an
 * agent-proposed row (`composeDesign.ts`), so a negative id has nothing
 * to delete and is dropped rather than sent. The builder throws in
 * local mode, where ids are small positive locals and the sign carries
 * no such meaning.
 *
 * 🛑 **Inferred tags are skipped.** They are projections of a sample
 * characteristic or an FV statement, not rows of their own, and Gemma
 * derives them. Sending one would ask Gemma to create a duplicate of
 * something it computes. See `feedback_inferred_rows_are_not_tags`.
 */
export function buildCurationDocument(
  design: CommittableDesign,
  opts: {
    mode: "local" | "remote";
    baselineLastModified?: string;
    /** The design as Gemma last served it. The ONLY witness for two
     *  things the draft cannot answer on its own: whether a tag already
     *  exists and whether its content changed (see the tags block), and
     *  whether a factor value's baseline flag was ever SET (see
     *  `baselineFlag`). Required once any tag carries an id. */
    baseline?: Pick<CommittableDesign, "tags" | "factors">;
  },
  removals?: CommittableRemovals,
): CurationDocument {
  if (opts.mode !== "remote") {
    throw new Error(LOCAL_DESIGN_NOT_COMMITTABLE);
  }
  // 🛑 **`isBaseline` has THREE states, and `false` is not the empty
  // one.** Gemma's `BaselineSelection.isBaselineCondition` short-
  // circuits on an explicit flag and otherwise INFERS from the terms:
  //
  //     null  → unforced; infer (a control-group term IS the baseline)
  //     true  → forced baseline
  //     false → forced NOT baseline, and inference is off permanently
  //
  // So writing `false` over a null is destructive rather than
  // cosmetic: on a factor value whose terms imply a control
  // (`control`, `reference substance role`, `wild type`, …) it turns
  // baseline detection OFF, changing which group differential
  // expression treats as the reference — the direction of every
  // contrast on that factor.
  //
  // This builder emitted `isBaseline: !!v.is_baseline` unconditionally,
  // and `composeDesign` collapses `?? false` on the way in, so the
  // first remote commit of any dataset carrying a null flag forced it
  // to false. Caught 2026-09-04 on sandbox factor value 9005, which had
  // no flag before a probe commit and reads `false` after; gembro
  // confirmed the semantics from `BaselineSelection`.
  //
  // ⇒ Absent stays absent. The flag is emitted when the curator forces
  // a baseline, or when the stored state already carried an explicit
  // value to overwrite — never to write a default over a null.
  //
  // ⚠️ **Known limitation, and it is the smaller of two wrongs.** A
  // curator who UNMARKS a value Gemma inferred as baseline (null flag,
  // control-group term) means a forced `false`, and this omits it, so
  // the inference stands and the unmark appears to revert. The model
  // cannot tell that apart from the default it used to invent —
  // `is_baseline: boolean` in `features/experiment/types.ts` has no
  // third state, and `composeDesign` collapses `?? false` before this
  // code ever sees it. Fixing it properly means a tri-state there.
  // Until then: the systematic wrong (every null flag forced to false
  // on first commit, silently, changing DE contrast direction) beats
  // the rare and VISIBLE one (an unmark that does not stick).
  const priorValues = new Map<
    number,
    NonNullable<NonNullable<CommittableDesign["factors"]>[number]["factor_values"]>[number]
  >();
  for (const f of opts.baseline?.factors ?? []) {
    for (const v of f.factor_values ?? []) priorValues.set(v.id, v);
  }

  function baselineFlag(
    v: { id: number; is_baseline?: boolean },
    prior: { is_baseline?: boolean } | undefined,
  ): { isBaseline?: boolean } {
    if (v.is_baseline) return { isBaseline: true };
    // Stored state already explicit → an explicit false is a real
    // un-setting the curator asked for, not a default.
    if (prior && prior.is_baseline !== undefined) return { isBaseline: false };
    // No baseline in hand, or the stored flag was null: say nothing.
    return {};
  }

  const factors: FactorCommit[] = (design.factors ?? []).map((f) => ({
    // A factor has a second, better witness than the sign: Gemma's own
    // `gemmaFactorId`, populated on every imported experiment. Prefer
    // it, fall back to the sign of `id`.
    ...commitTarget(f.gemma_factor_id ?? f.id, "factor"),
    ...(f.name ? { name: f.name } : {}),
    ...(f.description ? { description: f.description } : {}),
    ...(f.type ? { type: f.type } : {}),
    ...(term(f.category) ? { category: term(f.category) } : {}),
    factorValues: {
      ...deletion(
        (removals?.factorValues ?? []).find(
          (r) => r.factorId === (f.gemma_factor_id ?? f.id),
        )?.valueIds,
      ),
      items: (f.factor_values ?? []).map((v) => ({
        ...commitTarget(v.id, "fv"),
        ...(v.free_text_label ? { freeTextLabel: v.free_text_label } : {}),
        ...baselineFlag(v, priorValues.get(v.id)),
        ...(v.biomaterial_short_names?.length
          ? { biomaterialShortNames: v.biomaterial_short_names }
          : {}),
        statements: {
          ...deletion(
            (removals?.statements ?? []).find((r) => r.valueId === v.id)
              ?.statementIds,
          ),
          items: (v.statements ?? []).map((st) => ({
            ...commitTarget(st.gemma_id, "stmt"),
            ...(term(st.category) ? { category: term(st.category) } : {}),
            ...(term(st.subject) ? { subject: term(st.subject) } : {}),
            ...(term(st.predicate) ? { predicate: term(st.predicate) } : {}),
            ...(term(st.object) ? { object: term(st.object) } : {}),
          })),
        },
      })),
    },
  }));
  // 🛑 **A tag is not updatable, and the id's sign is not the witness.**
  //
  // Gemma's own `PUT /datasets/{id}/curation` says it: in `tags` and
  // `sampleCharacteristics`, an item carrying a `gemmaId` is a
  // KEEP-MARKER, the id is the only field read, and any other field on
  // such an item is a 400 naming every offending one, "because
  // accepting it would report success for an edit that never
  // happened". The `design` section is the opposite — a `gemmaId`
  // factor / FV / statement IS updated in place from the fields it
  // carries — so the intuition does not carry across sections.
  //
  // This builder used to emit `{gemmaId, category, value}` for every
  // existing tag: precisely the rejected shape. It never fired because
  // the remote commit path had never written; the first commit against
  // a dataset carrying any tag would have 400'd.
  //
  // So the three cases are spelled out, and the BASELINE decides which:
  //   unchanged → `{gemmaId}` alone, the keep-marker
  //   changed   → `{clientRef, …}` plus the old id in `deletedIds`,
  //               the detour Gemma's own description names
  //   new       → `{clientRef, …}`
  //
  // 🛑 The baseline also replaces the sign rule, which was WRONG here
  // in the other direction: a curator-added tag is given
  // `max(existing id) + 1` (`mutations.ts::nextTagId`), so a NEW tag
  // carried a positive id one past a real Gemma id and read as "update
  // this". Membership in the baseline cannot be fooled that way.
  //
  // ⚠️ A re-term is therefore delete + create, so the replacement is a
  // NEW identity and the tag's provenance does not survive its own
  // correction. That is a real cost, raised with gembro; the blocker on
  // in-place update is that `Characteristic.hashCode()` hashes exactly
  // the fields a re-term changes while `Investigation.characteristics`
  // is a `HashSet`.
  const baselineTags = new Map<number, NonNullable<CommittableDesign["tags"]>[number]>();
  for (const t of opts.baseline?.tags ?? []) {
    if (typeof t.id === "number") baselineTags.set(t.id, t);
  }
  const sameTerm = (
    a: { label?: string; uri?: string | null } | null | undefined,
    b: { label?: string; uri?: string | null } | null | undefined,
  ) => JSON.stringify(term(a) ?? null) === JSON.stringify(term(b) ?? null);

  const tags: TagCommit[] = [];
  const retermedIds: number[] = [];
  let unidentified = 0;
  for (const t of (design.tags ?? []).filter((x) => !x.inferred)) {
    const prior = typeof t.id === "number" ? baselineTags.get(t.id) : undefined;
    if (prior) {
      if (sameTerm(prior.category, t.category) && sameTerm(prior.value, t.value)) {
        // Keep-marker: the id and NOTHING else, or Gemma 400s.
        tags.push({ gemmaId: t.id });
        continue;
      }
      retermedIds.push(t.id);
    } else if (typeof t.id === "number" && t.id > 0 && !opts.baseline) {
      // 🛑 No baseline, and an id that MIGHT be Gemma's. The builder
      // cannot tell an untouched tag from an edited one, and both wrong
      // answers are bad: a keep-marker silently discards the curator's
      // edit, and content beside the id is a 400. Refuse rather than
      // pick one — the caller has the saved design and can pass it.
      throw new Error(
        `Cannot build a tag commit without the baseline design: tag ${t.id} ` +
          `carries a Gemma id, and whether its content changed is only ` +
          `answerable against what Gemma last served. Pass ` +
          `opts.baseline.`,
      );
    }
    tags.push({
      // Named for the id it replaces where there is one, so the
      // report's `idMap` reads `tag-9018 → 9019` and the
      // reidentification is legible rather than a bare counter.
      clientRef:
        typeof t.id === "number" ? `tag-${t.id}` : `tag-new${(unidentified += 1)}`,
      ...(term(t.category) ? { category: term(t.category) } : {}),
      ...(term(t.value) ? { value: term(t.value) } : {}),
    });
  }
  // A re-term's old id rides with the curator's own deletions: same
  // section, same key, and Gemma applies the whole document in one
  // transaction, so the delete and the create cannot half-land.
  const tagDeletions = [...(removals?.tagIds ?? []), ...retermedIds];

  return {
    ...(opts.baselineLastModified
      ? { baseline: { lastModified: opts.baselineLastModified } }
      : {}),
    design: {
      factors: { ...deletion(removals?.factorIds), items: factors },
      ...(typeof design.should_split_on_factor_id === "number"
        ? { shouldSplitOnFactorId: design.should_split_on_factor_id }
        : {}),
      ...(design.should_split_rationale
        ? { shouldSplitRationale: design.should_split_rationale }
        : {}),
    },
    tags: { ...deletion(tagDeletions), items: tags },
  };
}

// ---------------------------------------------------------------------------
// Undo — the snapshot history and the compare
// ---------------------------------------------------------------------------

/** One snapshot in a dataset's undo history, as the annotation-set
 *  envelope serves it. Only the fields a history list renders are
 *  declared; the payload is a `CurationDocument` and is not read here —
 *  `restore` replays it server-side. */
export interface CurationSnapshot {
  id: number;
  dataset_id: number;
  created_at: string | null;
  created_by: string | null;
  /** `curator` on the auto-captures a commit makes. */
  source: string | null;
}

/**
 * A dataset's snapshots, newest first.
 *
 * 🛑 **Nobody has to make these — a commit already captures one.**
 * Measured on gemma2 2026-09-04: dataset 2706 carries 7 and 5381
 * carries 5, `source: "curator"`, spanning 2026-08-31 to 09-02, with
 * no snapshot feature in the UI at all. Corpus-wide it is 2,494 of
 * 2,495 annotation sets. So undo works retroactively over curation
 * that predates the button, which is the argument for building it on
 * these rather than on a buffer of our own.
 *
 * Every commit also hands back the handle to the one taken before it —
 * `CommitReport.snapshotAnnotationSetId` — so an "undo that last
 * commit" affordance needs no lookup at all.
 */
export function snapshotsPath(experimentId: number | string): string {
  return `/rest/v2/datasets/${experimentId}/annotation-sets?role=snapshot`;
}

export function listSnapshots(
  experimentId: number | string,
): Promise<CurationSnapshot[]> {
  return api.get<CurationSnapshot[]>(snapshotsPath(experimentId));
}

/**
 * What restoring this snapshot would change. Writes nothing.
 *
 * 🛑 **Goes straight at Gemma rather than through the agent relay, and
 * that is the same carve-out `preflight` has**: a dry run takes no
 * lock, needs no write target, and mutates nothing, so the
 * agent-does-the-writing rule has nothing to guard here. The MUTATING
 * restore is a different matter — see `restoreSnapshot` below.
 *
 * The report is a `CommitReport`, and deliberately so: Gemma's route
 * *"replays the snapshot's CurationDocument through the ordinary
 * all-or-none commit, so there is no second diff implementation that
 * could disagree with the first."* Whatever renders a commit's changes
 * renders this unchanged.
 *
 * 🛑 **A restore returns the curation's CONTENT, not its IDENTITY.**
 * Gemma's own words. An entity whose id no longer exists — because an
 * intervening run deleted and recreated it — comes back as a NEW row
 * with a NEW id, and a differential-expression analysis that survived
 * that run is cascaded again on the way back. So this is not a plain
 * undo and the surface must not call it one: the preview is what the
 * curator decides on, not a formality.
 *
 * 409 means the restore would delete analyses or strand a subset.
 * `force` is deliberately NOT a parameter here, for the same reason
 * `commitCuration` refuses one — a consequence is reviewed and
 * consented to, never checkbox-ed past.
 */
export function previewRestore(
  experimentId: number | string,
  snapshotId: number,
): Promise<CommitReport> {
  return api.post<CommitReport>(
    `/rest/v2/datasets/${experimentId}/annotation-sets/${snapshotId}/restore?dryRun=true`,
    {},
  );
}

/**
 * 🛑 **The mutating restore has no route to call yet.**
 *
 * Restore is a write, and writes go through the agent
 * (`feedback_ui_is_readonly_client_agent_writes`). The relays that
 * exist are `/curation-{draft,lock,disposition,finalize,reopen,
 * preflight,commit,sign}` — there is no `/curation-restore`. Posting
 * at Gemma directly would be the UI writing curation, which is the one
 * thing this client does not do.
 *
 * Paul, 2026-09-04: *"restore is a curator action"* — so this is a
 * missing relay, not a permissions question. Filed with cab. This
 * throws rather than silently offering a button that cannot work, and
 * deletes itself the day the relay lands.
 */
export function restoreSnapshot(): never {
  throw new Error(
    "Restore needs the agent relay (/curation-restore), which does not " +
      "exist yet. The preview is live; the restore is not.",
  );
}
