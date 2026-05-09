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
import type { OntologyTerm, Proposal, StatementProposal } from "./types";

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

/** A single quote / row that grounded the proposer's pick on a
 *  given finding. Rendered as a blockquote with a small source-label
 *  chip in the audit-finding card. Per
 *  AUDIT_PROPOSER_SUGGESTION_HANDOFF.md — solves the per-finding
 *  evidence-anchor gap (the report-level ``evidence.paper_excerpt``
 *  is too coarse). */
export interface FindingEvidence {
  /** Full-sentence rendering. Whole sentences only — half-sentence
   *  fragments read as cherry-picked. */
  quote: string;
  source:
    | "paper"
    | "skeleton"
    | "sample_names"
    | "geo_metadata"
    | "characteristic";
  /** Optional pointer back to the source — paper section, sample
   *  short_name list, characteristic key, etc. Empty when the source
   *  label itself is sufficient. */
  location?: string;
}

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
   *  ``AuditEvidence.comparison_proposal`` is ``null``.
   *
   *  Kept as a fallback caption — the structured ``proposer_term``
   *  / ``proposer_defense`` below are the canonical render targets
   *  on newer reports. */
  proposer_suggestion: string;
  /** Structured ontology term the proposer would have used. Render
   *  as a green linkified Term chip when ``uri`` is set; italic grey
   *  when free-text. Null on older reports (predates the structured
   *  fields) or when the suggestion is structural rather than a term
   *  swap. */
  proposer_term?: OntologyTerm | null;
  /** One-sentence rationale from the proposer / silent defender for
   *  *why* this term was the right pick. Distinct from ``rationale``
   *  — that's the finding's rationale (why the gold curation is
   *  wrong); this is the proposer's positive case for its
   *  alternate. Empty on older reports. */
  proposer_defense?: string;
  /** Per-finding evidence anchors — full-sentence quotes from the
   *  paper / skeleton / sample names / GEO metadata /
   *  characteristics. Rendered as blockquotes. Empty on older
   *  reports or when no specific quote grounds the suggestion. */
  supporting_evidence?: FindingEvidence[];
  /** Structured statement(s) for the proposer's pick — populated
   *  on FV / factor-shape findings so the UI can render the same
   *  ``StatementGlyph`` (S-P-O three-disc visualisation) the
   *  proposal card uses. Empty for tag-shape findings (the single
   *  ``proposer_term`` is enough; tags only have one slot) and on
   *  older reports that pre-date the field. See
   *  ``AUDIT_PROPOSER_STATEMENTS_HANDOFF.md``. */
  proposer_statements?: StatementProposal[];
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
  /** When this disposition was cascaded from a parent factor finding,
   *  carries the parent's `target_id`. Null/absent for direct
   *  dispositions. Used by the dispositions report to weight cascaded
   *  vs direct curator calls differently. */
  inherited_from?: string | null;
  /** ISO 8601 UTC of "I actually addressed this in the data" — see
   *  `AUDIT_DISPOSITIONS.md` Ask #6. Only valid alongside
   *  status=accepted. Two states under accepted:
   *    - parked  → status=accepted AND resolved_at == null
   *    - resolved → status=accepted AND resolved_at != null
   *  The UI distinguishes them so a high parked-rate on a given
   *  issue_code reads as "curators agree but didn't act" (weaker
   *  validation signal) vs "clean win". Optional / nullable for
   *  backwards compat with older mocks. */
  resolved_at?: string | null;
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
  /** Two-step accept marker — see `AUDIT_DISPOSITIONS.md` Ask #6.
   *  Server validator: `resolved_at` is only valid alongside
   *  status=accepted; any other status returns 422. Send when:
   *    - the curator clicks "Mark resolved" on an accepted finding
   *    - an Apply&Focus action with a real mutation runs (the
   *      curator just took the structural action, so accept is
   *      implicitly resolved)
   *  Omit on the bare "Accept" click — that's the parked state. */
  resolved_at?: string;
  /** When cascading a factor disposition to its subsumed FV children,
   *  set to the parent finding's `target_id`. Omit for direct curator
   *  dispositions. Lets the dispositions report weight cascaded
   *  dispositions differently from direct ones. */
  inherited_from?: string;
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
  /** ISO 8601 UTC of the curator's "I'm done triaging this" press —
   *  see `AUDIT_DISPOSITIONS.md` Ask #1. Null on still-open audits;
   *  optional/undefined when an older mock that pre-dates the
   *  finalize endpoint is in front of the UI. PATCH against an
   *  audit with `finalized_at != null` returns 409 — the UI
   *  disables disposition controls when this is set. */
  finalized_at?: string | null;
  /** Reviewer username who finalized. Pairs with `finalized_at`;
   *  same nullable / optional rules. */
  finalized_by?: string | null;
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
