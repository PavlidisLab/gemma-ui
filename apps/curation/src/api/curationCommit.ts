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
 * 🛑 **Nothing is ever DELETED.** `deletedIds` is deliberately not
 * populated: an absent `deletedIds` removes nothing, so this document
 * can add and update but cannot drop a factor, value or tag. A
 * curator's deletion therefore does NOT reach Gemma yet, which is the
 * safe half of the asymmetry to ship first — a missed deletion is
 * visible and fixable, an unintended one is neither. Wiring deletion
 * needs a tombstone list the editor does not currently hand us.
 *
 * 🛑 **Inferred tags are skipped.** They are projections of a sample
 * characteristic or an FV statement, not rows of their own, and Gemma
 * derives them. Sending one would ask Gemma to create a duplicate of
 * something it computes. See `feedback_inferred_rows_are_not_tags`.
 */
export function buildCurationDocument(
  design: CommittableDesign,
  opts: { mode: "local" | "remote"; baselineLastModified?: string },
): CurationDocument {
  if (opts.mode !== "remote") {
    throw new Error(LOCAL_DESIGN_NOT_COMMITTABLE);
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
      items: (f.factor_values ?? []).map((v) => ({
        ...commitTarget(v.id, "fv"),
        ...(v.free_text_label ? { freeTextLabel: v.free_text_label } : {}),
        isBaseline: !!v.is_baseline,
        ...(v.biomaterial_short_names?.length
          ? { biomaterialShortNames: v.biomaterial_short_names }
          : {}),
        statements: {
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
  const tags: TagCommit[] = (design.tags ?? [])
    .filter((t) => !t.inferred)
    .map((t) => ({
      ...commitTarget(t.id, "tag"),
      ...(term(t.category) ? { category: term(t.category) } : {}),
      ...(term(t.value) ? { value: term(t.value) } : {}),
    }));
  return {
    ...(opts.baselineLastModified
      ? { baseline: { lastModified: opts.baselineLastModified } }
      : {}),
    design: {
      factors: { items: factors },
      ...(typeof design.should_split_on_factor_id === "number"
        ? { shouldSplitOnFactorId: design.should_split_on_factor_id }
        : {}),
      ...(design.should_split_rationale
        ? { shouldSplitRationale: design.should_split_rationale }
        : {}),
    },
    tags: { items: tags },
  };
}
