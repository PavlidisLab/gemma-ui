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
  /** Wider surrounding text — paragraphs / neighbour rows / full
   *  characteristic block. UI shows ``quote`` as the preview and
   *  reveals ``context`` behind a "Show more" expander. Empty when
   *  no wider context applies (single-line characteristic, etc.);
   *  UI hides the expander.
   *  See AUDIT_EVIDENCE_CONTEXT_HANDOFF.md for caps + per-source
   *  shape. */
  context?: string;
  /** Deep-link to the canonical source so the curator can bounce
   *  out to the GEO record / PubMed / Gemma sample page when the
   *  inline context isn't enough. UI renders an "open ↗" next to
   *  the source-label chip; hidden when empty. */
  source_url?: string;
  /** Half-open ``(start, end)`` byte offsets into ``context`` to
   *  highlight (typically the anchor ``quote`` substring). UI wraps
   *  matching spans in a soft yellow highlight so the eye lands on
   *  the anchor inside the wider context. Multi-range supported.
   *  Empty when no highlight applies (one-line contexts, paraphrased
   *  quotes that aren't literal substrings). */
  highlights?: [number, number][];
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
  /** Defender-style "second opinion" attached to the finding when
   *  the audit ran a defender pass against this target. Populated on
   *  ``calibration_agent_extra`` and ``calibration_gold_only_miss``
   *  findings on calibration packages ≥ v9; ``null`` on
   *  ``calibration_match`` findings (defender doesn't run on
   *  matches), on older calibration packages, and on freshly-audited
   *  live experiments where the defender hasn't been invoked. UI
   *  hides the panel when null. See
   *  ``AUDIT_DEFENDER_VERDICT_HANDOFF.md``. */
  defender_verdict?: AttachedDefenderVerdict | null;
  /** Debate-loop badge for the tag this finding is about.
   *  ``"gold"`` = approved without objection,
   *  ``"silver"`` = one contested round,
   *  ``"bronze"`` = multiple contested rounds,
   *  ``"stuck"`` = no consensus.
   *  Empty string or absent = no debate was run (``--debate`` not
   *  used) or finding is a gold-only-miss. */
  debate_badge?: string;
  /** Structured side-by-side diff for a ``calibration_factor_rename``
   *  finding. Populated when the arbiter classifies a factor pair as
   *  same-factor-different-label (commit 767f7f6, 2026-05-17). Null
   *  on every other finding type and on older packages. The UI gates
   *  the FV-pair diff render on ``rename != null``. */
  rename?: FactorRenamePayload | null;
}

/** One FV-pair across a renamed factor (agent FV ↔ gold FV). */
export interface FvPair {
  agent: OntologyTerm;
  gold: OntologyTerm;
  /** How strong the pair is:
   *  - ``"exact"``    — same URI or string-identical label
   *  - ``"synonym"``  — different label, arbiter judged equivalent
   *  - ``"judgment"`` — same partition position, arbiter only ranked
   *                     by index (no semantic match) */
  equivalence: "exact" | "synonym" | "judgment" | (string & {});
}

/** Compact factor reference inside a rename payload. */
export interface FactorRef {
  category: OntologyTerm;
  factor_type?: string;
}

/** Side-by-side diff for a factor classified as same-factor-different-
 *  label by the calibration arbiter. ``direction`` is load-bearing
 *  for the UI: ``"gold_correct"`` → curator keeps Gemma's label
 *  (severity ok), ``"agent_correct"`` → adopt agent's label (severity
 *  minor), ``"equivalent"`` → arbiter declines to pick (severity ok). */
export interface FactorRenamePayload {
  agent: FactorRef;
  gold: FactorRef;
  fv_pairs: FvPair[];
  direction: "gold_correct" | "agent_correct" | "equivalent" | (string & {});
}

/** Judge's verdict on a single audit finding. ``side`` constrains
 *  the ``verdict`` enum (gold-only-miss findings only ever carry
 *  ``agent_*`` values; agent-extra findings only ever carry
 *  ``extra_*`` values). Folded into the proposer-suggestion panel:
 *  ``strength`` drives the header label, ``rationale`` the Judge
 *  one-liner. */
export interface AttachedDefenderVerdict {
  side: "agent_extra" | "agent_missed_gold";
  verdict:
    // Tag side (original six, AUDIT_DEFENDER_VERDICT_HANDOFF.md).
    | "agent_miss_genuine"
    | "agent_correct_inherited"
    | "agent_correct_overzealous_gold"
    | "extra_genuine_new"
    | "extra_inherited_redundant"
    | "extra_unsupported"
    // Factor side (FACTOR_DEFENDER_VERDICT_HANDOFF.md, 2026-05-14).
    // `extra_genuine_new` + `extra_unsupported` are shared with the
    // tag enum.
    | "extra_confounded"
    | "extra_borderline"
    | "miss_genuine"
    | "miss_inherited_from_design"
    | "miss_overzealous_gold"
    | "miss_borderline"
    // Forward-compat: future producers (curator-triggered
    // "investigate further" / extra-review pass) will emit the same
    // shape with new verdict labels we don't enumerate here. UI keys
    // off ``strength`` rather than the verdict literal.
    | (string & {});
  /** Producer-side strength signal, calibration package v10+ (commit
   *  5b1f811). Three levels so future investigator verdicts that
   *  aren't open-and-shut have a natural slot. ``undefined`` on v9-
   *  and-older packages — UI falls back to ``verdictStrength()`` for
   *  the known six verdicts. */
  strength?: "weak" | "moderate" | "strong";
  /** One-paragraph explanation. Renders as the Judge one-liner at
   *  the bottom of the proposer panel. */
  rationale: string;
  /** Rule-section reference (e.g. ``"09_experiment_tags.md § Sample
   *  applicability"``). Rendered as a tooltip on the Judge line. */
  citation: string;
  /** Arbiter judgement mode, calibration package v11+ (defender-as-
   *  arbiter swap, HANDOFF_2026-05-16_DEFENDER_ARBITER.md). Tells the
   *  curator *how* the verdict was reached:
   *
   *  - ``"rule"`` — verdict cites a specific guideline section
   *    (``citation`` is populated and load-bearing).
   *  - ``"judgment"`` — TMTOWTDI / equivalence call where guidelines
   *    leave room for interpretation; ``citation`` may be empty.
   *  - ``"meta"`` — verdict about the guidelines themselves
   *    (``guideline_omission``: prose missing for an implicit rule).
   *  - ``"escape"`` — arbiter declined to rule (``cannot_judge``).
   *
   *  ``undefined`` on packages predating the arbiter prompt swap. */
  mode?: "rule" | "judgment" | "meta" | "escape";
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
  /** Per-factor design debate transcripts loaded from
   *  ``data/<gse>/design_debate_transcripts.json``. Absent when the
   *  run didn't use ``--debate-design`` or the sidecar file is missing.
   *  Factors not in this list were silently approved. */
  design_debate_transcripts?: DesignDebateEntry[];
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
  /** Structured-reason fields echoed back on read so the edit
   *  dialog can prefill the curator's chip selection. Set only when
   *  the disposition's status matches (dismiss → dismissed, etc.);
   *  null/absent on older agent services that pre-date the round-
   *  trip ask (AUDIT_DISPOSITION_EDIT_HANDOFF.md, 2026-05-14). */
  dismiss_reason?: DismissReason | null;
  accept_reason?: AcceptReason | null;
  not_sure_reason?: NotSureReason | null;
}

/** Closed enum of structured "why this is a dismiss" reasons.
 *  Mirrors the agent-side ``DismissReason`` enum (revised
 *  2026-05-10 per AUDIT_DISPOSITION_REASONS_HANDOFF.md). Required
 *  by the server when ``status === "dismissed"``; null/absent
 *  otherwise. Free-text ``notes`` stays alongside (mandatory when
 *  reason is "other"). The closed enum lets my brother cluster
 *  dismissals for prompt-quality analysis without parsing arbitrary
 *  curator prose.
 *
 *  Old values ``auditor_wrong`` / ``curator_wrong`` were dropped —
 *  they described *whose fault* rather than *what was wrong*. The
 *  ``string`` opening keeps legacy dispositions that still carry
 *  those values render-clean. */
export type DismissReason =
  | "redundant"
  | "out_of_scope"
  | "weak_evidence"
  | "accepted_elsewhere"
  | "wont_fix"
  | "other"
  // Calibration-specific reasons promoted to canonical 2026-05-13
  // (agents-side enum extension; see schemas.py:444-448). Chip keys
  // map straight through to the structured field — no client-side
  // squash anymore.
  | "missed_evidence"
  | "no_evidence"
  | "borderline"
  // Cross-curator chip-gap closures landed 2026-05-14 (agents side
  // CALIBRATION_CHIP_GAP_HANDOFF.md). Per-issue-code gating on the
  // server side:
  //   agent_real_miss          → calibration_{gold_only_miss,
  //                              factor_gold_only_miss}
  //   redundant_with_bm_source → calibration_agent_extra (tag-side)
  //   not_sample_applicable    → calibration_agent_extra (tag-side)
  | "agent_real_miss"
  | "redundant_with_bm_source"
  | "not_sample_applicable"
  | (string & {});

/** Closed enum of structured "why I accepted this" reasons. Required
 *  by the server when ``status === "accepted"`` AND the finding is
 *  in the agent-extra family (``calibration_agent_extra``, future
 *  ``agent_extra_*`` codes); other accept paths skip the field. */
export type AcceptReason =
  | "well_evidenced"
  | "fills_gap"
  | "more_specific"
  | "other"
  // Calibration-specific reasons promoted to canonical 2026-05-13
  // (agents-side enum extension). Chip keys map straight through
  // to the structured field — no client-side squash anymore.
  | "gold_was_wrong"
  | "borderline"
  | (string & {});

/** Closed enum of structured "why I'm parking this" reasons.
 *  Required by the server when ``status === "needs_more_info"``.
 *  The "Park" button on the audit sidebar gates on the dialog so
 *  the UI never sends the status without a reason. */
export type NotSureReason =
  | "need_more_data"
  | "need_expert"
  | "pending_update"
  | "other"
  | (string & {});

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
  /** The finding's ``issue_code``, looked up from the report by
   *  ``target_id`` and echoed in the patch body so the server-side
   *  validator can gate reason chips by code (e.g. ``agent_real_miss``
   *  only valid on ``calibration_{gold_only_miss,
   *  factor_gold_only_miss}``). Required by the agent-side validator
   *  as of the 2026-05-16 chip-gap closure pass. Always populated by
   *  ``setDisposition`` from the live report. */
  issue_code?: string;
  dismiss_reason?: DismissReason;
  /** Required when ``status === "accepted"`` and the finding's
   *  ``issue_code`` is in the agent-extra family — captures the
   *  curator's "why I'm adding this" so my brother can cluster
   *  accept signal symmetrically with dismiss signal. */
  accept_reason?: AcceptReason | null;
  /** Required when ``status === "needs_more_info"``. Parking is now
   *  a decided disposition (counts as closed in the UI), so my
   *  brother needs to know what kind of follow-up is missing. */
  not_sure_reason?: NotSureReason | null;
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
  /** Curator's optional free-text note attached to the finalize
   *  click — "I'm closing this because X". Surfaced post-close in
   *  the audit header strip and pre-filled into the close textarea
   *  when the curator reopens to re-close with edits.
   *
   *  Optional/nullable on the read shape: old agent services
   *  routed the note into the audit_events row without echoing it
   *  back on `AuditReport`. Bro adds the echo in a follow-up
   *  (AUDIT_DISPOSITION_EDIT_HANDOFF.md). UI degrades to "(no
   *  note recorded)" when undefined. */
  finalized_notes?: string | null;
}

/** One round in a challenger/defender/arbiter debate loop. Shared
 *  by both EE-tag debates (``debate_transcripts.jsonl``) and design
 *  debates (``design_debate_transcripts.json``). */
export interface DebateRound {
  challenge_citation: string;
  challenge_reason: string;
  defense_concedes: boolean;
  defense_response: string;
  /** ``"defense"`` | ``"challenge"`` | ``"uncertain"`` */
  verdict_side: string;
  verdict_reason: string;
}

/** One factor entry in ``design_debate_transcripts.json``. Factors
 *  that were silently approved (no challenge) are omitted from the
 *  file — absent entry means the factor passed without objection. */
export interface DesignDebateEntry {
  gse: string;
  factor_category: string;
  factor_category_uri: string;
  /** Same badge vocabulary as EE-tag debates: ``"gold"`` / ``"silver"``
   *  / ``"bronze"`` / ``"dropped"`` / ``"stuck"``. */
  badge: string;
  rounds: DebateRound[];
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
