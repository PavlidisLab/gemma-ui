/**
 * Wire types for the audit-existing-curation feature.
 *
 * Mirrors the Pydantic models in
 * `gemma-curation-agents/agents/audit/schemas.py` and the contract
 * documented in `AUDIT_FEATURE.md`. When the agent side renames a
 * field, that doc updates first and these shapes follow.
 *
 * Audits never rewrite curation. ``AuditFinding.suggested_fix`` is
 * free-text only; materialising a fix is always a curator click in
 * the UI.
 */
import type { Proposal } from "./types";

/** What an `AuditFinding` is *about*. ``"statement"`` is reserved for
 *  Phase 2 (predicate/object on an FV) — no Phase 1 emitter should
 *  produce one, but the literal stays here so we don't break the wire
 *  when it lands. */
export type AuditTargetKind =
  | "experiment"
  | "factor"
  | "fv"
  | "tag"
  | "assignment"
  | "statement";

/** ``ok`` is emitted for green checks so the report can show what was
 *  verified, not just what failed. The UI default-collapses ``ok``
 *  findings — see `AuditReportView`. */
export type Severity = "ok" | "minor" | "major" | "blocker";

/** Subset-selectable scope so a tags-only or design-only audit
 *  doesn't pay for the whole pipeline. Empty array is rejected by the
 *  server (400). */
export type AuditScopeItem = "factors" | "fvs" | "tags" | "assignments";

/** Roll-up for inbox sorting. Derived server-side from finding
 *  severity counts; treat as authoritative rather than recomputing
 *  client-side so the ``ok``-finding policy stays consistent. */
export type OverallVerdict =
  | "clean"
  | "minor_issues"
  | "major_issues"
  | "blockers";

export interface AuditFinding {
  target_kind: AuditTargetKind;
  /** Stable id of the existing curation element this finding addresses
   *  (factor.id, fv.id, tag.id, biomaterial.short_name, …). Free-form
   *  string for forward-compat; the UI uses it as an opaque key to
   *  anchor the finding card to the rendered curation element. */
  target_id: string;
  severity: Severity;
  /** Programmatic short id — used in tests, eval aggregations, and as
   *  a stable handle the UI can switch on for custom rendering.
   *  Examples: ``forbidden_efc``, ``missing_baseline``,
   *  ``ungrounded_term``, ``low_confidence_assignment``,
   *  ``coverage_zero``, ``ok``. */
  issue_code: string;
  rationale: string;
  citation: string;
  citation_url: string;
  suggested_fix: string;
  /** One-line rendering of what the silent comparison proposer
   *  produced for the same target, when comparable. Empty when there's
   *  no clean correspondence (experiment-wide findings, or a tag the
   *  proposer didn't suggest). Always empty when
   *  ``AuditEvidence.comparison_proposal`` is ``null``. */
  proposer_suggestion: string;
}

export interface AuditScope {
  include: AuditScopeItem[];
}

export interface AuditEvidence {
  skeleton_excerpt: string;
  paper_source: string | null;
  paper_excerpt: string;
  /** Silent comparison proposer run that anchors judge findings.
   *  Nullable: future scope choices (e.g. tags-only audits) may skip
   *  the proposer entirely. When ``null``, every finding's
   *  ``proposer_suggestion`` will also be empty. */
  comparison_proposal: Proposal | null;
}

export interface AuditSummary {
  n_blocker: number;
  n_major: number;
  n_minor: number;
  n_ok: number;
  overall_verdict: OverallVerdict;
}

/** Where a finding sits in the curator's triage. The audit pipeline
 *  always emits findings as ``pending``; the disposition table tracks
 *  the curator's verdicts. The UI sources from `AuditFinding`s on
 *  the report PLUS the parallel `dispositions` list. */
export type DispositionStatus =
  | "pending"
  | "accepted"
  | "dismissed"
  | "needs_more_info";

/** One curator verdict on one finding, identified by `target_id`.
 *  The mock API stores an append-only log of these and serves the
 *  latest row per `target_id` on the read path — so any
 *  `AuditReport.dispositions` entry is the curator's most recent
 *  call on that finding. */
export interface AuditFindingDisposition {
  target_id: string;
  status: DispositionStatus;
  reviewer: string;
  /** ISO 8601 UTC; null on the initial pending state. */
  reviewed_at: string | null;
  notes: string;
}

/** Closed enum of structured "why this is a dismiss" reasons.
 *  Mirrors the enum in `AUDIT_DISPOSITIONS.md` Ask #2. Required by
 *  the server when `status === "dismissed"`; null/absent otherwise.
 *  Free-text `notes` stays alongside (mandatory when reason is
 *  "other"). The closed enum lets my brother cluster dismissals for
 *  prompt-quality analysis without parsing arbitrary curator prose. */
export type DismissReason =
  | "auditor_wrong"
  | "redundant"
  | "out_of_scope"
  | "accepted_elsewhere"
  | "wont_fix"
  | "other";

/** PATCH body for `PATCH /rest/v2/audits/{audit_id}`. One disposition
 *  update per request — bulk dispositioning isn't supported on this
 *  endpoint by design.
 *
 *  Optional fields per `AUDIT_DISPOSITIONS.md`:
 *   - `dismiss_reason`: required when status=dismissed (server side
 *     will validate; safe to send always when set).
 *   - `applied_fix`: when the curator accepted **and** edited the
 *     suggested_fix text before applying, the final text.
 *   - `first_seen_at`: client-side timestamp of the first time this
 *     finding rendered to the curator. Sent only on the first PATCH
 *     for the finding so triage time analytics can subtract from
 *     `reviewed_at`. */
export interface AuditFindingDispositionPatch {
  target_id: string;
  status: DispositionStatus;
  reviewer: string;
  notes?: string;
  dismiss_reason?: DismissReason;
  applied_fix?: string;
  first_seen_at?: string;
}

export interface AuditReport {
  /** Server-assigned. Null on a freshly-built report that hasn't been
   *  persisted yet (e.g. mid-stream). */
  audit_id: string | null;
  experiment_id: number;
  experiment_short_name: string;
  /** ISO 8601 UTC. */
  audited_at: string;
  model: string | null;
  scope: AuditScope;
  findings: AuditFinding[];
  evidence: AuditEvidence;
  summary: AuditSummary;
  /** Latest curator disposition per finding (keyed by `target_id`).
   *  Empty on a freshly-produced report; populated by the read
   *  endpoints after PATCH calls. */
  dispositions: AuditFindingDisposition[];
}

/** Body of POST /audit/{accession} and its /stream variant. All
 *  fields optional; the agent service applies defaults. Note:
 *  `scope` here is a flat array — the *report's* `AuditScope`
 *  wraps it as `{ include: [...] }`, but the request shape doesn't.
 *  Documented by my brother in `AUDIT_FEATURE.md` §Status Step 4. */
export interface AuditRequest {
  tier?: "fast" | "standard" | "strong";
  /** Wins over `tier` when present. */
  model?: string;
  /** Subset to audit. Omit to audit everything; pass `[]` and the
   *  server returns 400 (likely a UI bug — checkboxes all off). */
  scope?: AuditScopeItem[];
  /** Run the silent comparison proposer alongside the judges so
   *  `proposer_suggestion` populates on findings. Default true.
   *  Set false for a cheap-pass audit (deterministic checks only). */
  with_comparison?: boolean;
  /** Default true. Mirrors the proposer's cache flag. */
  use_cache?: boolean;
  /** Default false. When true, ignores any cached proposer output
   *  and forces a fresh judge pass. */
  refresh_cache?: boolean;
}
