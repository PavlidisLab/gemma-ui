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
 * 🛑 **No document BUILDER lives here yet, and that is deliberate.**
 * Every commit item names its target with either `gemmaId` (update
 * this existing thing) or `clientRef` (create a new one). The store's
 * design carries neither: `gemma_factor_id` is null on every
 * experiment checked, and its ids are small locals (1, 2, 3) against
 * Gemma's 8715 / 64275. Mapping the draft today would send every
 * factor, value and tag as a `clientRef` and Gemma would CREATE them
 * all — duplicating a dataset's design instead of updating it. The
 * transport is safe to build; the identity is an open question.
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
