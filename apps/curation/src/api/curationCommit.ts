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
import { api, ApiError } from "./client";
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
  /** The second predicate-object pair, stated plainly. Live on gemma2
   *  from `7cba4a75eb1d` (deployed 2026-09-08); before it the keys were
   *  accepted, ignored and dropped with no warning.
   *
   *  🛑 **Never alongside the flattened spelling.** A compound
   *  statement also reaches us as two `statements[]` rows sharing one
   *  id, and sending both forms for one statement is a 400. We emit
   *  these fields and one item per statement — see {@link statementItems}. */
  secondPredicate?: OntologyTermRef;
  secondObject?: OntologyTermRef;
  /** Drop the stored second pair on purpose. Live on gemma2 from
   *  `003b932cf7`; before it, OMITTING the pair was the clear, and
   *  after it omission is a 400 instead.
   *
   *  🛑 **Only ever `true`, and never beside a pair.** Sending it
   *  together with `secondPredicate`/`secondObject` is a 400, not a
   *  precedence rule, so a statement whose pair is being KEPT must
   *  leave the key absent rather than send `false`. */
  clearSecondPair?: true;
  supportingEvidence?: unknown;
  /** 🛑 Must be sent back or it is CLEARED — see the emit site. */
  evidenceCode?: string;
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
  /** Declares that this tag's free-text value is DELIBERATE.
   *
   *  🛑 Gemma refuses a new tag whose `value.uri` is blank unless this
   *  is true (`UNGROUNDED_NOT_DECLARED`, `DatasetsWebService:3938`),
   *  and the gate reads the tag's own value only — a grounded
   *  statement object does not satisfy it.
   *
   *  Set here ONLY for a tag the curator has hooked to the ontology
   *  through a statement. That hook is the declaration: the curator
   *  authored a `derives from …` clause rather than leaving the value
   *  dangling. A bare free-text tag never reaches this builder — the
   *  validator flags it and the commit gate holds it back — which is
   *  why this cannot become the blanket default the field's own
   *  javadoc warns against. */
  freeTextIntended?: boolean;
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

/** Per-section tally on a commit report's `changes` map — the shape
 *  Gemma's `CurationSectionChange` declares. */
export interface CommitSectionChange {
  created?: number;
  updated?: number;
  deleted?: number;
  unchanged?: number;
}

/**
 * What a commit / preflight / restore answers with, AS IT REACHES US.
 *
 * 🐍 **Snake, where the request above is camel — and that asymmetry is
 * real, not an oversight.** A request body is handed to `fetch`
 * verbatim, so `CurationDocument` is spelled the way Gemma's OpenAPI
 * declares it. Every RESPONSE goes through `snakeify` in `api/client.ts`
 * on its way out of `api.post`, so Gemma's `newBaseline` /
 * `deletedIdentities` / `auditEventIds` arrive here as `new_baseline` /
 * `deleted_identities` / `audit_event_ids`, and the section names under
 * `changes` come with them. That is the project's one normalization
 * chokepoint doing its job; this type says what it produces rather than
 * re-spelling the fields a second time.
 *
 * This type declared camelCase until 2026-09-10, so every one of these
 * fields read `undefined` at runtime: the stale-baseline 409 guard never
 * got a token to thread (`DesignDraftContext`), `deletedIdentities`
 * never rendered, and `changes.curationDetails` never matched. The
 * render tests passed throughout because their fixtures were written in
 * the declared spelling rather than the served one.
 */
export interface CommitReport {
  applied: boolean;
  id_map: Record<string, number>;
  /** Section name -> tally. `design`, `tags`, `curation_details`, … */
  changes: Record<string, CommitSectionChange>;
  /** 🛑 **The "content, not identity" warning, made concrete.** Old id
   *  -> new id for every entity that could not be restored in place and
   *  came back as a new row. Empty on an ordinary commit; the reason a
   *  restore preview is worth reading. Declared 2026-09-04 off Gemma's
   *  `CurationCommitReport`; the UI type had `changes` as `unknown` and
   *  these three not at all. */
  reidentified?: Record<string, number>;
  /** Ids that go away. */
  deleted_identities?: number[];
  /** Set when the operation could not be carried out. */
  error?: string | null;
  audit_event_ids: number[];
  canonicalizations: unknown[];
  commit_annotation_set_id: number | null;
  /** Feed to the NEXT commit as `baselineLastModified` — that is what
   *  lets a curator edit and commit repeatedly without re-reading. */
  new_baseline?: string | null;
  /** The undo: the annotation set captured before this commit. */
  snapshot_annotation_set_id?: number | null;
  /** What the design section would do — Gemma's `DesignPreflightReport`.
   *  Null when the document carried no design section. */
  design_report?: DesignPreflightReport | null;
}

/** The part of Gemma's `DesignPreflightReport` a sign-off is decided on:
 *  the analyses a commit would delete and the subsets it would leave
 *  anchored on deleted factor values. Declared only as far as the UI
 *  reads it. */
export interface DesignPreflightReport {
  requires_force?: boolean;
  differential_expression_analyses_to_delete?: Array<{
    id: number;
    name?: string | null;
    subset_factor_value_id?: number | null;
  }>;
  subsets_with_stale_anchor?: Array<{
    id: number;
    name?: string | null;
    lost_factor_value_ids?: number[];
  }>;
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
 * A 200 means everything applied except, possibly, tag deletions: an
 * id in `tags.deletedIds` that names no tag on the dataset is skipped
 * rather than refused. See {@link tagDeletionShortfall}.
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
 * Pass the refused document as `body`. With no body Gemma signs the
 * caller's server-side DRAFT annotation set instead.
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

/**
 * What `POST /curation-apply` answers with, post-`snakeify`.
 *
 * The agent plans one audit finding's `apply_action` against the live
 * design, and — unless it is a dry run — commits it as `gemmaAgent` on
 * behalf of the curator, reads the dataset back, and records the
 * disposition itself: `accepted` when the read-back shows the edit,
 * `needs_more_info` with the reason when it does not.
 */
export interface FindingApplyResult {
  dry_run: boolean;
  experiment_id: number;
  target_id: string;
  kind: string;
  /** `ready`: the plan changes the design. `already_present`: the
   *  design already holds the edit, so nothing is committed. `refused`:
   *  the plan cannot run — a dry run answers 200 with this, a real
   *  apply answers 422 (see {@link applyRefusalOf}). */
  status: "ready" | "already_present" | "refused";
  /** What the edit does, or why it is refused. */
  detail: string;
  /** The `CurationDocument` the agent sends. Display only: it has been
   *  through `snakeify`, so it is no longer spelled the way Gemma reads
   *  it. */
  document?: unknown;
  expect?: {
    tags_deleted?: number;
    tags_created?: number;
    factors_deleted?: number;
  };
  baseline_last_modified?: string | null;
  /** Gemma's preflight report — dry run only. */
  preflight?: CommitReport | null;
  commit_report?: CommitReport | null;
  verified?: boolean | null;
  verify_detail?: string | null;
  disposition?: unknown;
}

/**
 * One-click Accept: the agent executes an audit finding and records the
 * ruling, in one call. `dryRun` writes nothing and returns the plan with
 * Gemma's preflight.
 *
 * `onBehalfOf` is required by the route. A 409 carries the same reason
 * envelope as `/curation-commit` ({@link conflictOf}); the route never
 * forces, so `REQUIRES_FORCE` means a sign-off.
 */
export function applyFinding(
  annotationSetId: number | string,
  findingId: string,
  opts: {
    onBehalfOf: string;
    dryRun?: boolean;
    baselineLastModified?: string;
    /** The curator's reason for the ruling the route records — the same
     *  `"chip: notes"` text `/curation-disposition` carries. */
    reason?: string;
  },
): Promise<FindingApplyResult> {
  return api.post<FindingApplyResult>(
    `/curation-apply/${annotationSetId}/${encodeURIComponent(findingId)}${qs({
      onBehalfOf: opts.onBehalfOf,
      dryRun: opts.dryRun ? true : undefined,
      baselineLastModified: opts.baselineLastModified,
    })}`,
    opts.reason ? { reason: opts.reason } : {},
  );
}

/** The agent's reason when a real apply was refused, or null when the
 *  error is not that. A refusal is a 422 whose body is
 *  `{detail: {error: "refused", detail, …}}` and writes nothing — no
 *  commit, no disposition. */
export function applyRefusalOf(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 422) return null;
  const d = (err.body as { detail?: unknown } | undefined)?.detail;
  if (d && typeof d === "object" && "error" in d && "detail" in d) {
    const m = (d as { detail?: unknown }).detail;
    if (typeof m === "string" && m) return m;
  }
  return null;
}

/** Tag deletions a commit asked for that Gemma did not make.
 *
 *  🛑 **A 200 does not mean every tag deletion happened.** Gemma counts a
 *  deletion only when `removeAnnotation` returns a row, so an id that
 *  names no tag on the dataset is skipped: the commit still answers 200,
 *  the other sections still apply, and `changes.tags.deleted` comes back
 *  lower than the number sent (gembro, 2026-09-13, read from
 *  `ExpressionExperimentServiceImpl.commitCuration`). A dry run counts
 *  what was sent, so preflight cannot see it.
 *
 *  Null when no tag was deleted or every one was. A report with no tag
 *  tally counts as nothing deleted. */
export function tagDeletionShortfall(
  doc: CurationDocument,
  report: CommitReport | null | undefined,
): { sent: number; deleted: number } | null {
  const sent = doc.tags?.deletedIds?.length ?? 0;
  if (sent === 0) return null;
  const deleted = report?.changes?.tags?.deleted ?? 0;
  return deleted < sent ? { sent, deleted } : null;
}

/** The curator-facing sentence for {@link tagDeletionShortfall}. */
export function tagDeletionShortfallMessage(s: {
  sent: number;
  deleted: number;
}): string {
  return (
    `Committed, but Gemma deleted ${s.deleted} of the ${s.sent} tags this ` +
    `commit removed. It skips a tag id it does not find on this dataset ` +
    `and applies everything else, so check the experiment's tags.`
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
 * 🛑 **The witness is MEMBERSHIP IN THE BASELINE, not the sign of the
 * id.** An id goes out as `gemmaId` only when the design Gemma last
 * served carries it; everything else gets a `clientRef` and is created.
 *
 * The sign cannot answer this. Rows seeded from Gemma keep Gemma's id
 * verbatim (`composeCurationDesign`: `id: ef.id`, `id: v.id`) and rows
 * that exist only in an agent PROPOSAL are materialised negative —
 * `-(fi + 1)` for a factor, `-((fi + 1) * 1000 + (vi + 1))` for a value
 * — but the EDITOR mints its own ids as `max(existing) + 1`
 * (`features/design/mutations.ts::nextFvId` / `nextFactorId`), and
 * those are positive. On gemma2 design 1658 (factors 8715 / 11727 /
 * 11728 / 23079, values 64275 … 77279) "add factor value" mints 77280,
 * so the sign test named a brand-new value as `{gemmaId: 77280}` — an
 * in-place UPDATE of whatever dataset holds FactorValue 77280, not a
 * create. The tags block has always decided this by baseline
 * membership; the design section now does too, off the same baseline.
 *
 * ⚠️ **With no baseline design in hand the sign is all there is.** A
 * caller that passes no `baseline.factors` keeps the old test, because
 * the alternative — reading every factor as new — would duplicate the
 * entire design. The commit path always passes the saved design.
 *
 * 🛑 **The sign test is meaningless in LOCAL mode**, where the store's
 * ids are small locals AND positive: `1, 2, 3` would go out as
 * `gemmaId` and corrupt a real design. That is why the builder refuses
 * outright rather than trying to be clever per row. See
 * `reference_factor_value_identity_two_conventions`.
 */
function commitTarget(
  id: number | null | undefined,
  kind: string,
  issuedByGemma: boolean,
): CommitTarget {
  if (issuedByGemma && typeof id === "number") return { gemmaId: id };
  // Stable within one document, which is all `clientRef` has to be —
  // the response's `idMap` keys off it to report what was created.
  // Editor-minted ids are unique across the whole design
  // (`nextFvId` / `nextFactorId` scan every factor), so is this.
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

/** Whether this item must carry `clearSecondPair`. True only when the
 *  row is an in-place update of a statement Gemma issued (`gemma_id`)
 *  whose stored form has two pairs while the draft kept one. With no
 *  baseline in hand the answer is no: inventing the flag would delete a
 *  pair on a guess. */
function clearsStoredSecondPair(
  first: StatementRow | undefined,
  storedPairCounts: ReadonlyMap<number, number> | undefined,
): boolean {
  if (!storedPairCounts || !first) return false;
  const id = first.gemma_id;
  if (typeof id !== "number" || id <= 0) return false;
  return (storedPairCounts.get(id) ?? 0) >= 2;
}

/**
 * One statement, as the wire wants it.
 *
 * Shared by factor values and by tags: template 9b hangs a
 * `derives from …` clause off a free-text tag, so the two sections
 * carry the same shape and a fork would drift the carries below apart.
 *
 * 🛑 **Re-sent, not edited.** `design` is full-record replacement
 * (2026-09-06), so an omitted key clears the stored value. Both
 * `evidenceCode` and `supportingEvidence` are guarded since the
 * 2026-09-06 11:05 PDT deploy — omitting either on a row that has one
 * is a 400. Before it, `evidenceCode` cleared SILENTLY: 657 statement
 * 30030391, committed without it, `IC` gone, `updated: 1`, no warning.
 * Nothing in the UI edits either; they are carried from `/design`
 * purely so a commit does not destroy them.
 *
 * Evidence is sent only when the read carried it. `[]` and `null` are
 * both no-ops on Gemma's side (measured on 30030391), never a clear,
 * so inventing either in place of an absence buys nothing and asserts
 * something we were not told.
 */
interface StatementRow {
  gemma_id?: number | null;
  category?: { label?: string; uri?: string | null } | null;
  subject?: { label?: string; uri?: string | null } | null;
  predicate?: { label?: string; uri?: string | null } | null;
  object?: { label?: string; uri?: string | null } | null;
  evidence_code?: string | null;
  supporting_evidence?: unknown;
}

/**
 * The statements of one container, as the wire wants them.
 *
 * 🛑 **The draft holds one PAIR per row; Gemma holds one STATEMENT with
 * up to two pairs.** Rows sharing a `gemma_id` are the pairs of one
 * statement (`types.ts::Statement`), so this groups before it emits —
 * one item per statement, second pair under `secondPredicate` /
 * `secondObject`.
 *
 * Until `7cba4a75eb1d` (gemma2, 2026-09-08) those keys did not exist on
 * the request type and we emitted the flattened form instead: the two
 * rows as two items sharing one `gemmaId`, which
 * `unflattenStatements` re-joins. That still works on the READ side and
 * is still how a compound statement comes back. What it never reached
 * is a statement being CREATED — regrouping keys on a non-null id, so
 * two id-less halves stayed two single-clause statements. Hence the
 * explicit fields, and hence only ONE spelling per statement: sending
 * both is a 400.
 *
 * `scope` makes a new statement's `clientRef` unique. It used to be the
 * constant `stmt-new` for every id-less row in the document, so two
 * unrelated new statements collided on the one key the response's
 * `idMap` reports creations under.
 */
function statementItems(
  rows: readonly StatementRow[] | null | undefined,
  scope: string,
  storedPairCounts?: ReadonlyMap<number, number>,
): StatementCommit[] {
  const groups: StatementRow[][] = [];
  const byId = new Map<number, StatementRow[]>();
  for (const r of rows ?? []) {
    const id = typeof r.gemma_id === "number" && r.gemma_id > 0 ? r.gemma_id : null;
    if (id === null) {
      // No id: its own statement. The draft cannot express a compound
      // statement that does not exist yet — each uncommitted pair
      // becomes one — so there is nothing here to group.
      groups.push([r]);
      continue;
    }
    const seen = byId.get(id);
    if (seen) seen.push(r);
    else {
      const g = [r];
      byId.set(id, g);
      groups.push(g);
    }
  }
  return groups.map((g, i) => {
    const [first, second] = g;
    return {
      ...(typeof first.gemma_id === "number" && first.gemma_id > 0
        ? { gemmaId: first.gemma_id }
        : { clientRef: `stmt-${scope}-${i}` }),
      ...(term(first.category) ? { category: term(first.category) } : {}),
      ...(term(first.subject) ? { subject: term(first.subject) } : {}),
      ...(term(first.predicate) ? { predicate: term(first.predicate) } : {}),
      ...(term(first.object) ? { object: term(first.object) } : {}),
      // A pair is both halves or neither — half a pair is a 400.
      ...(second && term(second.predicate) && term(second.object)
        ? {
            secondPredicate: term(second.predicate),
            secondObject: term(second.object),
          }
        : // The draft holds one pair where the stored statement holds
          // two: the curator dropped a clause. Omission USED to say
          // that and now 400s, so say it with the flag. Needs the
          // baseline because the group alone cannot tell a dropped
          // pair from a statement that never had one.
          clearsStoredSecondPair(first, storedPairCounts)
          ? { clearSecondPair: true as const }
          : {}),
      ...(first.evidence_code ? { evidenceCode: first.evidence_code } : {}),
      ...(first.supporting_evidence === undefined ||
      first.supporting_evidence === null
        ? {}
        : { supportingEvidence: first.supporting_evidence }),
    };
  });
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
      /** What Gemma STORES in the free-text column, as opposed to the
       *  rendering `free_text_label` is seeded from. Re-sent verbatim
       *  on an untouched value — see `freeTextLabelField` and
       *  `FactorValue.gemma_free_text_value`. */
      gemma_free_text_value?: string | null;
      is_baseline?: boolean;
      /** Whether the baseline flag was EXPLICIT in what Gemma served —
       *  see `FactorValue.is_baseline_explicit`. */
      is_baseline_explicit?: boolean;
      biomaterial_short_names?: string[];
      statements?: Array<{
        gemma_id?: number | null;
        /** Re-sent verbatim; omitting it CLEARS the stored code. */
        evidence_code?: string | null;
        /** Re-sent verbatim; omitting it on a row that has evidence
         *  is a 400. */
        supporting_evidence?: unknown;
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
    /** Provenance already on the tag. Carried across a re-term — see
     *  the emit site. */
    supporting_evidence?: unknown;
    /** The clause that hooks a free-text value to the ontology — see
     *  `TagCommit.freeTextIntended`. Part of the tag's identity, so it
     *  is compared as well as sent. */
    statements?: Array<{
      gemma_id?: number | null;
      category?: { label?: string; uri?: string | null } | null;
      subject?: { label?: string; uri?: string | null } | null;
      predicate?: { label?: string; uri?: string | null } | null;
      object?: { label?: string; uri?: string | null } | null;
      evidence_code?: string | null;
      supporting_evidence?: unknown;
    }>;
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
    /** The design as Gemma last served it. The ONLY witness for three
     *  things the draft cannot answer on its own: whether a tag already
     *  exists and whether its content changed (see the tags block),
     *  whether a factor value's baseline flag was ever SET (see
     *  `baselineFlag`), and whether a factor / factor value carries an
     *  id Gemma issued or one the editor minted (see `commitTarget` —
     *  both are positive). Required once any tag carries an id; without
     *  `factors` the identity question falls back to the sign. */
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
  // How many pairs each stored statement holds, off the same baseline.
  // Rows sharing a `gemma_id` are the pairs of ONE statement, so this
  // counts rows per id — the only way to tell "the curator dropped a
  // clause" from "this statement never had a second one", which
  // `statementItems` cannot see from the draft alone.
  const storedPairCounts = new Map<number, number>();
  for (const f of opts.baseline?.factors ?? []) {
    for (const v of f.factor_values ?? []) {
      for (const s of v.statements ?? []) {
        const id = s.gemma_id;
        if (typeof id !== "number" || id <= 0) continue;
        storedPairCounts.set(id, (storedPairCounts.get(id) ?? 0) + 1);
      }
    }
  }
  // The ids Gemma issued, read off the same baseline. `priorValues` is
  // the factor-value half of the answer; this is the factor half.
  const baselineFactorIds = new Set<number>();
  for (const f of opts.baseline?.factors ?? []) {
    baselineFactorIds.add(f.gemma_factor_id ?? f.id);
  }
  // Absent `factors` — not empty — means the caller handed over no
  // baseline design, and there is nothing to ask. See `commitTarget`.
  const haveBaselineDesign = Array.isArray(opts.baseline?.factors);
  const issuedByGemma = (id: number | null | undefined, inBaseline: boolean) =>
    haveBaselineDesign ? inBaseline : typeof id === "number" && id > 0;

  function baselineFlag(
    v: { id: number; is_baseline?: boolean },
    prior: { is_baseline?: boolean; is_baseline_explicit?: boolean } | undefined,
  ): { isBaseline?: boolean } {
    if (v.is_baseline) return { isBaseline: true };
    // Stored state already explicit → an explicit false is a real
    // un-setting the curator asked for, not a default.
    //
    // 🛑 `prior.is_baseline !== undefined` did NOT test this. `prior`
    // comes through `composeDesign`, which collapses `?? false`, so the
    // field is ALWAYS defined and the guard fired on every value —
    // forcing `isBaseline: false` over Gemma's nulls, which is the
    // exact write this block exists to prevent. `is_baseline_explicit`
    // is the collapse-surviving witness.
    // A stored `true` is explicit by construction — a null collapses to
    // `false` on the way in, never to `true` — so it stands on its own
    // for a producer that does not yet carry the witness.
    if (prior && (prior.is_baseline_explicit || prior.is_baseline)) {
      return { isBaseline: false };
    }
    // No baseline in hand, or the stored flag was null: say nothing.
    return {};
  }

  /**
   * The free-text label to write, or nothing at all.
   *
   * 🛑 **`free_text_label` is not the stored field.** `composeDesign`
   * seeds it `v.summary || v.value`, and `summary` is Gemma's own
   * rendering of the value's statements — unbounded in length, while
   * `FACTOR_VALUE.VALUE` is `VARCHAR(255)`. This builder used to ship
   * that field for every value on every commit, so Gemma wrote its own
   * rendering back into a column the curator owns.
   *
   * Measured on experiment 38401 (Gemma side, 2026-09-22): of 18
   * factor values, 7 had a summary longer than 255 — the longest 318
   * characters, 7 statements — and the stored value was empty on all
   * of them. A commit that only DELETED statements came back
   * `500 … Data truncation: Data too long for column 'VALUE'`.
   *
   * The overflow is the loud half. On the same design, 10 of the 18
   * values DO store something, and on fv 382172 the stored value is
   * `"0 h"` while the summary renders `"initial time point"` — so
   * every commit against that dataset quietly replaced the curator's
   * string with Gemma's rendering, well under any column limit.
   *
   * ⇒ Send the curator's label when they actually wrote it, and
   * otherwise re-send what Gemma already stores:
   *
   *   new value    → the label is the only name it has; send it
   *   label edited → differs from the baseline; send it
   *   untouched    → echo the stored value, or say nothing
   *
   * The echo is deliberate rather than an omission. `design` items are
   * full replacements — an omitted field is cleared, not left alone
   * (measured on 657/GSE7866, 2026-09-05: a partial statement item
   * nulled `subject`, `subjectUri` and `category` and still reported
   * `updated: 1`) — and whether `freeTextLabel` is exempt is a
   * question this builder does not have to ask if it sends the stored
   * value back unchanged. Nothing is emitted only when there is
   * nothing stored, where cleared and unchanged are the same state.
   *
   * ⚠️ **Known limitation: clearing a label does not clear the column.**
   * An empty label falls through to the echo, so a curator who empties
   * the field sees the stored value survive. That matches what this
   * builder did before (it never sent an empty `freeTextLabel`), and
   * the alternative — sending `""` — is a write whose acceptance on
   * the Gemma side has not been checked.
   */
  function freeTextLabelField(
    v: {
      free_text_label?: string;
      gemma_free_text_value?: string | null;
    },
    prior:
      | { free_text_label?: string; gemma_free_text_value?: string | null }
      | undefined,
    existing: boolean,
  ): { freeTextLabel?: string } {
    const label = v.free_text_label ?? "";
    // A value Gemma never issued: whatever it is called, the curator or
    // the proposal named it, and nothing on the far side can supply it.
    if (!existing) return label.trim() ? { freeTextLabel: label } : {};
    // ⚠️ No baseline row, on a value Gemma DID issue: "edited" is not a
    // question that can be asked, and answering it from the label alone
    // would send the rendering on every commit — the bug itself. The
    // commit path always passes the saved design (`commitTarget`), so
    // this is the fallback, and it falls back to writing nothing new.
    if (prior) {
      const priorLabel = prior.free_text_label ?? "";
      if (label.trim() && label.trim() !== priorLabel.trim()) {
        return { freeTextLabel: label };
      }
    }
    // The baseline is what Gemma served, so it answers "what is stored"
    // ahead of the draft — a row the editor rebuilt may not carry it.
    const stored = prior?.gemma_free_text_value ?? v.gemma_free_text_value ?? "";
    return stored ? { freeTextLabel: stored } : {};
  }

  const factors: FactorCommit[] = (design.factors ?? []).map((f) => {
    // Gemma's own `gemmaFactorId` where the experiment was imported;
    // `id` is what the editor holds the factor by, and equals it there.
    const factorId = f.gemma_factor_id ?? f.id;
    return {
      ...commitTarget(
        factorId,
        "factor",
        issuedByGemma(factorId, baselineFactorIds.has(factorId)),
      ),
      ...(f.name ? { name: f.name } : {}),
      ...(f.description ? { description: f.description } : {}),
      ...(f.type ? { type: f.type } : {}),
      ...(term(f.category) ? { category: term(f.category) } : {}),
      factorValues: {
        ...deletion(
          (removals?.factorValues ?? []).find((r) => r.factorId === factorId)
            ?.valueIds,
        ),
        items: (f.factor_values ?? []).map((v) => ({
          ...commitTarget(
            v.id,
            "fv",
            issuedByGemma(v.id, priorValues.has(v.id)),
          ),
          ...freeTextLabelField(
            v,
            priorValues.get(v.id),
            issuedByGemma(v.id, priorValues.has(v.id)),
          ),
          ...baselineFlag(v, priorValues.get(v.id)),
          ...(v.biomaterial_short_names?.length
            ? { biomaterialShortNames: v.biomaterial_short_names }
            : {}),
          statements: {
            ...deletion(
              (removals?.statements ?? []).find((r) => r.valueId === v.id)
                ?.statementIds,
            ),
            items: statementItems(v.statements, `fv${v.id}`, storedPairCounts),
          },
        })),
      },
    };
  });
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

  /** 🛑 A tag's statements are part of its IDENTITY, not decoration.
   *
   *  A tag is add/delete only, so "did this change" decides between a
   *  keep-marker and a delete-plus-recreate. Comparing category and
   *  value alone made an edited clause invisible: the curator changes
   *  `derives from cell line cell` to a different parent line, the two
   *  terms still match, and the edit is silently discarded as
   *  unchanged. Compared on the wire shape so a difference that cannot
   *  reach Gemma is not treated as one. */
  const sameStatements = (
    a: NonNullable<CommittableDesign["tags"]>[number]["statements"],
    b: NonNullable<CommittableDesign["tags"]>[number]["statements"],
  ) =>
    // One scope for both sides: this asks whether the CONTENT differs,
    // and a `clientRef` that encoded position would answer a different
    // question.
    JSON.stringify(statementItems(a, "cmp")) ===
    JSON.stringify(statementItems(b, "cmp"));

  const tags: TagCommit[] = [];
  const retermedIds: number[] = [];
  let unidentified = 0;
  for (const t of (design.tags ?? []).filter((x) => !x.inferred)) {
    const prior = typeof t.id === "number" ? baselineTags.get(t.id) : undefined;
    if (prior) {
      if (
        sameTerm(prior.category, t.category) &&
        sameTerm(prior.value, t.value) &&
        sameStatements(prior.statements, t.statements)
      ) {
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
    const statements = t.statements ?? [];
    // 🛑 The hook is what makes a free-text value legitimate, so it has
    // to travel. Template 9b (cab (eval), 2026-09-06): a tag whose
    // value carries no URI while its statement object does —
    // `cell line: WTC-11` + `derives from cell line cell` + a grounded
    // parent line. Without the statements this section emitted only
    // `{category, value}`, so the clause the whole shape exists for
    // was dropped on the way to Gemma.
    // The OBJECT, not the subject — the subject is the tag's own value
    // said again. See `tagReachesOntology`, which decides the same
    // question for the validator and must not drift from this.
    const hookedToOntology =
      !t.value?.uri && statements.some((s) => !!s.object?.uri);
    tags.push({
      // Named for the id it replaces where there is one, so the
      // report's `idMap` reads `tag-9018 → 9019` and the
      // reidentification is legible rather than a bare counter.
      clientRef:
        typeof t.id === "number" ? `tag-${t.id}` : `tag-new${(unidentified += 1)}`,
      ...(term(t.category) ? { category: term(t.category) } : {}),
      ...(term(t.value) ? { value: term(t.value) } : {}),
      ...(statements.length
        ? {
            statements: {
              items: statementItems(
                statements,
                `tag${typeof t.id === "number" ? t.id : `new${unidentified}`}`,
              ),
            },
          }
        : {}),
      // 🛑 **A re-term must not destroy provenance.** A tag is
      // add/delete only, so an edit is a delete plus a fresh create —
      // and a create that omits this drops evidence the curator never
      // chose to remove. Paul, 2026-09-06: *"the existing supporting
      // evidence should survive."*
      //
      // Not written by us: the agents author it, and a curator's own
      // act is recorded as `IC` plus the audit event naming them, not
      // as a quote. So this is a carry and never an authorship — the
      // only thing that reaches it is what the read handed over.
      ...(t.supporting_evidence === undefined || t.supporting_evidence === null
        ? {}
        : { supportingEvidence: t.supporting_evidence }),
      // Declared only for a hooked tag — see `TagCommit.freeTextIntended`.
      // A bare free-text tag deliberately gets nothing here and takes
      // Gemma's refusal, which is the outcome the validator's
      // `bare_free_text_tags` flag exists to prevent reaching.
      ...(hookedToOntology ? { freeTextIntended: true } : {}),
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
 * `CommitReport.snapshot_annotation_set_id` — so an "undo that last
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
 * 🛑 **Through the agent relay, not straight at Gemma — same as
 * `preflightCuration`.** A dry run mutates nothing, so a direct call
 * would work; it would also be the one curation operation in this file
 * that bypasses the agent, and cab built the relay to serve both halves
 * precisely so "the preview is not a special case". `dryRun=true` is
 * exempt from the agent's `GEMMA_WRITE_TARGET` guard on purpose: it is
 * the half a curator runs BEFORE agreeing, so requiring a write target
 * to see a diff would make the preview harder to reach than the act it
 * exists to make safe.
 *
 * The report is a `CommitReport` because the route replays the
 * snapshot's `CurationDocument` through the ordinary all-or-none
 * commit, so nothing here re-implements a diff — `CommitChangeSummary`
 * renders this and a real commit with the same code.
 *
 * 🛑 **A restore returns the curation's CONTENT, not its IDENTITY.**
 * Gemma's own words. An entity whose id no longer exists — because an
 * intervening run deleted and recreated it — comes back as a NEW row
 * with a NEW id, and a differential-expression analysis that survived
 * that run is cascaded again on the way back. `reidentified` on the
 * report is where that shows up, and it is why the dry run is the thing
 * the curator decides on rather than a formality.
 */
export function previewRestore(
  experimentId: number | string,
  snapshotId: number,
  onBehalfOf?: string,
): Promise<CommitReport> {
  return api.post<CommitReport>(
    `/curation-restore/${experimentId}/${snapshotId}${qs({
      dryRun: true,
      onBehalfOf,
    })}`,
    {},
  );
}

/**
 * Put the curation back to this snapshot.
 *
 * 🛑 **`force` is consent AFTER the consequences have been reviewed,
 * never a checkbox.** Gemma 409s when a restore would delete analyses
 * or strand a subset. `commitCuration` refuses to take a force
 * parameter at all for that reason, and cab kept the same restraint on
 * the relay — default off, never supplied by habit, with a test
 * asserting the parameter is absent unless passed. So a caller reaching
 * here with `force` must have shown the curator `previewRestore`'s
 * report first: wire the confirm step, not a checkbox. Undo should not
 * be the app's first force button.
 *
 * A 409 arrives in the same envelope as commit and sign — `reason` plus
 * `retryableAfterReread` — so a caller need not know which route it
 * called to know whether the failure is retryable.
 *
 * ⚠️ Relay committed by cab 2026-09-04, NOT deployed anywhere yet.
 */
export function restoreSnapshot(
  experimentId: number | string,
  snapshotId: number,
  opts: { force?: boolean; onBehalfOf?: string } = {},
): Promise<CommitReport> {
  return api.post<CommitReport>(
    `/curation-restore/${experimentId}/${snapshotId}${qs({
      force: opts.force ? true : undefined,
      onBehalfOf: opts.onBehalfOf,
    })}`,
    {},
  );
}
