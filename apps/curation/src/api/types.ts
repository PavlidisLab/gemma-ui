/**
 * Hand-written TypeScript mirror of the mock API's pydantic schemas
 * (gemma_curation_agents/agents/curation_proposer/schemas.py).
 *
 * Replace this file with `npm run gen-types` once the mock API is
 * running locally — that calls openapi-typescript against
 * http://localhost:8080/openapi.json and writes a generated schema.ts.
 * Until then this file keeps the UI buildable.
 */

import type {
  AttachedDefenderVerdict,
  FindingEvidence,
  SubtaskDecision,
} from "./justification";

/** 🛑 **Open, not closed** — Paul, 2026-09-04: *"don't lock us into any
 *  kind of enums."* gembro shipped `status` as a free string (non-blank,
 *  ≤32 chars) and deleted the Java enum they were mid-file writing; a
 *  fifth value is stored and returned rather than 400'd. These four are
 *  the values in use, and `(string & {})` keeps the autocomplete without
 *  making an unknown one unrenderable. */
export type ProposalStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "needs_changes"
  | (string & {});

export interface OntologyTerm {
  label: string;
  uri: string | null;
  resolver: string | null;
  score: number | null;
}

export interface TagProposal {
  category: OntologyTerm;
  value: OntologyTerm;
  /** Structured (subject · predicate · object) statements proposed
   *  for this experiment-level tag. Mirrors the post-2026-06-14
   *  rich-tag shape on ``Design.Tag.statements``. Optional + empty
   *  on flat agent proposals; populated when the agent's tag
   *  proposer decomposes a value into S-P-O (e.g. genotype tag
   *  with ``Abca4 · has_genotype · Homozygous negative``). */
  statements?: StatementProposal[];
  evidence_quote: string;
  confidence: string;
  /** Debate-loop outcome. ``"platinum"`` = human-verified,
   *  ``"gold"`` = approved without objection,
   *  ``"silver"`` = settled after one contested round,
   *  ``"bronze"`` = multiple contested rounds,
   *  ``"stuck"`` = no consensus — needs human call.
   *  ``"dropped"`` = retracted before landing.
   *  Empty/absent = debate wasn't run. */
  badge?: string;
  /** Pre-computed alignment against an existing Gemma tag. Absent on
   *  proposals submitted before the alignment annotator landed — UI
   *  falls back to its pre-landing heuristic. */
  match_type?: MatchType;
  gemma_ref?: GemmaRef | null;
  /** Unified-justification fields (landed 2026-05-22 per
   *  `SCHEMA_UNIFIED_JUSTIFICATION.md`). All optional; defaults to
   *  empty / absent when the producer hasn't filled them in yet. */
  defender_verdicts?: AttachedDefenderVerdict[];
  subtask_decisions?: SubtaskDecision[];
  rationale?: string;
  citation?: string;
  citation_url?: string;
  supporting_evidence?: FindingEvidence[];
  proposer_flags?: string[];
}

export interface StatementProposal {
  category: OntologyTerm | null;
  subject: OntologyTerm;
  predicate: OntologyTerm | null;
  object: OntologyTerm | null;
  /** Original free-text the statement came from when there was one
   *  (matches Gemma's ``Characteristic.originalValue``). Often null
   *  when the agent constructs statements from paper text / BM
   *  columns directly. */
  original_value?: string | null;
  /** Per-statement justification slice. Mirrors the FV-level fields;
   *  populated when statement-level evidence is genuinely distinct
   *  from the parent FV's. Empty on payloads from before producer-
   *  migration 4b. */
  rationale?: string;
  citation?: string;
  citation_url?: string;
  supporting_evidence?: FindingEvidence[];
  /** Subtask decisions targeted at this statement (target_id format
   *  e.g. `factor:0/fv:1/subject`). Populated today. */
  subtask_decisions?: SubtaskDecision[];
}

/**
 * Per-sample provenance for one sample-to-FV assignment. Sibling of
 * ``FactorValueProposal.biomaterial_short_names``: each entry
 * corresponds to one sample assigned to the FV. Carries the
 * confidence + the evidence source so the UI can surface uncertain
 * assignments for curator verification.
 *
 * ``confidence`` ∈ {"high", "medium", "low"}; ``source`` is one of
 * "characteristic" / "name" / "geo" / "llm" / "" — see Python schema.
 */
export interface BiomaterialAssignmentMeta {
  biomaterial_short_name: string;
  confidence: string;
  source: string;
  rationale?: string;
}

/**
 * Pointer to a Gemma-side counterpart of an agent proposal. Populated
 * by the agent / audit pipelines when pre-computing alignment between
 * agent factors / FVs / tags and Gemma's existing curation. The
 * comparison panel reads this directly instead of re-deriving the
 * match client-side. Either field may be empty (Gemma free-text
 * label without URI, or URI without a human label).
 */
export interface GemmaRef {
  label: string;
  uri: string;
}

/**
 * Pre-computed alignment verdict between an agent proposal and
 * Gemma's existing curation. Same vocabulary at factor / FV / tag
 * levels (semantics narrows per level):
 *   - ``"exact"`` — same canonical handle (label-equal, or URI-equal).
 *   - ``"close"`` — different label but related ontology terms or
 *     overlapping label tokens.
 *   - ``"new"``   — no Gemma counterpart found.
 * Absent (``undefined``) means alignment wasn't computed for this
 * proposal — UI falls back to its pre-landing heuristic.
 */
export type MatchType = "exact" | "close" | "new";

export interface FactorValueProposal {
  free_text_label: string;
  is_baseline: boolean;
  statements: StatementProposal[];
  biomaterial_short_names: string[];
  /** Per-sample provenance, parallel to ``biomaterial_short_names``.
   *  Older proposals submitted before this field landed have an
   *  empty list — UI should treat missing meta as
   *  ``{confidence: "medium", source: ""}``. */
  biomaterial_assignment_meta?: BiomaterialAssignmentMeta[];
  /** Canonical scalar reading for a continuous-factor FV — mirrors
   *  Gemma's ``FactorValue.measurement.value``. Populated by the
   *  deterministic continuous-populator subtask from the matching
   *  biomaterial characteristic; ``null`` on categorical FVs and on
   *  proposals submitted before the populator landed. ``free_text_label``
   *  carries the human rendering ("86 years") for display. */
  numeric_value?: number | null;
  /** Pre-computed alignment against a Gemma FV within the same factor.
   *  Absent on proposals submitted before the alignment annotator
   *  landed — UI falls back to its pre-landing heuristic. */
  match_type?: MatchType;
  gemma_ref?: GemmaRef | null;
  /** Unified-justification fields — not yet populated by today's
   *  payloads but typed for forward-compat. */
  defender_verdicts?: AttachedDefenderVerdict[];
  subtask_decisions?: SubtaskDecision[];
  rationale?: string;
  citation?: string;
  citation_url?: string;
  supporting_evidence?: FindingEvidence[];
  debate_badge?: string;
  proposer_flags?: string[];
}

export interface FactorProposal {
  category: OntologyTerm;
  name_in_design: string;
  /** Stable per-proposal factor id (wire: `proposalFactorId`), landed
   *  2026-07-31 — replaces the fragile positional `p{idx}` scheme for
   *  the `factor:{category}#{id}` target_id discriminator. Auto-stamped
   *  1..N by the Proposal validator, idempotent across re-reads, so
   *  every proposed factor on the wire carries one — optional here only
   *  to tolerate proposals fetched before this field existed. */
  proposal_factor_id?: number | null;
  /** ≤80-char LLM-emitted summary of what the factor encodes, used
   *  as a subtitle in factor headers. Optional; may be empty. */
  description?: string;
  /** ``"categorical"`` (default) or ``"continuous"``. Continuous
   *  factors emit one FV per distinct numeric measurement, with
   *  ``numeric_value`` populated and ``is_baseline=false`` on every
   *  FV (no baseline by convention). Defaults to "categorical" for
   *  proposals submitted before the field landed. Same string set as
   *  the design-side ``Factor.type`` so the two line up on accept. */
  factor_type?: "categorical" | "continuous";
  /** Per-factor baseline-relevance hint set by the proposer's S6
   *  baseline picker:
   *    - ``"required"`` (default) — a baseline FV is expected; UI
   *      surfaces the existing loud warning + commit gate when it's
   *      missing.
   *    - ``"not_applicable"`` — no baseline by structure (subset
   *      axis, continuous factor, panel category, single-level
   *      factor). UI suppresses both warning and gate.
   *    - ``"uncertain"`` — picker found no canonical reference but
   *      didn't rule it out. UI surfaces a *soft* flag (small inline
   *      chip on the factor row) rather than the loud banner. */
  baseline_relevance?: "required" | "not_applicable" | "uncertain";
  /** One-line agent rationale shown on hover next to the soft flag
   *  / banner bullet. Empty string when the picker didn't emit one. */
  baseline_relevance_reason?: string;
  factor_values: FactorValueProposal[];
  /** Pre-computed alignment against a Gemma factor. Absent on
   *  proposals submitted before the alignment annotator landed —
   *  UI falls back to its pre-landing heuristic. */
  match_type?: MatchType;
  gemma_ref?: GemmaRef | null;
  /** Unified-justification fields (landed 2026-05-22).
   *  `defender_verdicts` populated; `rationale` / `citation` /
   *  `supporting_evidence` pending producer migration 4b. */
  defender_verdicts?: AttachedDefenderVerdict[];
  subtask_decisions?: SubtaskDecision[];
  rationale?: string;
  citation?: string;
  citation_url?: string;
  supporting_evidence?: FindingEvidence[];
  debate_badge?: string;
  proposer_flags?: string[];
}

/**
 * One decision made by a specialist sub-agent on the way to a
 * Proposal. The proposer is being decomposed (see
 * `PLAN-proposer-v2.md`) into a chain of sub-agents (baseline
 * picker, forbidden-EFC detector, statement template selector,
 * etc.); each emits a structured decision with a citation pointing
 * to the Confluence guideline that grounded it.
 */
// `SubtaskDecision` moved to `./justification.ts` per the unified-
// justification schema (2026-05-22). Re-exported here for callers
// that still import from `./types`.
export type { SubtaskDecision } from "./justification";

/** One constant-BM-characteristic the proposer's deterministic
 *  refine-tags pass considered but did NOT emit as a tag. Surfaces
 *  in the UI so the curator isn't blind to why an obvious free-text
 *  BM column (e.g. `strain: TALLYHO`) didn't make it onto the
 *  proposed tag list. */
export interface ConstantKeyConsidered {
  key: string;
  value: string;
  n_samples: number;
  /** "missed" — resolver chain ran but couldn't ground the value to
   *  an ontology URI (free-text BM, no matching resolver). Only
   *  "missed" surfaces here today; "resolved" cases ship as actual
   *  tag proposals. */
  resolver_result: "missed" | "resolved";
  /** Curator-readable one-liner explaining the suppression. */
  reason: string;
}

/** "What the agent looked at but didn't propose" — quiet curator
 *  signal. Not a finding (no disposition, no accept/dismiss). Lives
 *  on the proposal evidence envelope so the curator sees the agent's
 *  inspection scope alongside paper / preboarding excerpts. */
export interface AgentConsidered {
  constant_keys?: ConstantKeyConsidered[];
}

export interface ProposalEvidence {
  preboarding_excerpt: string;
  paper_source: string | null;
  paper_excerpt: string;
  exemplar_experiment_ids: number[];
  extra: Record<string, string>;
  /** Per-decision provenance from the new sub-agent chain. Absent
   *  on proposals submitted by the legacy single-shot pipeline. */
  subtask_decisions?: SubtaskDecision[];
  /** Things the agent inspected but chose NOT to surface as a
   *  proposal. */
  agent_considered?: AgentConsidered;
}

export interface Proposal {
  proposal_id: string | null;
  experiment_id: number;
  experiment_short_name: string;
  submitted_by: string;
  submitted_at: string;
  model: string | null;
  status: ProposalStatus;
  /** Shape counts as Gemma's annotation-set row carries them
   *  (`factorCount` / `tagCount`), for the remote inbox where the
   *  payload is not on the list response.
   *
   *  🛑 **`null` means UNKNOWN, never zero** (gembro, 2026-09-04). They
   *  are read best-effort off a payload Gemma serves verbatim and
   *  unread, so an unrecognized shape yields null — and rendering that
   *  as 0 says "this proposal changes nothing", which is the one wrong
   *  answer that looks entirely plausible on a card. `undefined` on the
   *  local shape, where `factors` / `tags` are in hand and counted. */
  factor_count?: number | null;
  tag_count?: number | null;
  tags: TagProposal[];
  factors: FactorProposal[];
  evidence: ProposalEvidence;
  /** Proposal-wide subtask decisions (target_id="" or routed to
   *  specific elements). Populated today on new-shape proposals. */
  subtask_decisions?: SubtaskDecision[];
  /** Top-level Boss verdict. Stub-only on today's payloads. */
  boss_verdict?: import("./justification").BossVerdict | null;
  /** Curator-facing prose paragraph from the orchestrator — what
   *  the agent observed, any intervention it ran, what the final
   *  design + tags look like. Renders via ``OrientationProse`` at
   *  the top of ``ProposalReviewCard``.
   *
   *  Dual-state per agents-side commit ``5d6e069``: THIS field is
   *  canonical. ``AuditEvidence.experiment_summary`` is a back-
   *  compat mirror; UIB readers should prefer Proposal-side and
   *  fall through to the mirror. */
  experiment_summary?: string | null;
  /** v5 supervisor's audit-trail prose — narrative of what the
   *  orchestrator observed, intervened on, deferred. Canonical
   *  source; mirrored to ``AuditEvidence.experiment_notes`` for
   *  back-compat. Rendered as a collapsible "Pipeline audit
   *  trail" section at the bottom of the findings list. */
  experiment_notes?: string | null;
  /** v5 curator-follow-up requests. Canonical source; mirrored
   *  to ``AuditEvidence.escalation_requests``. Each entry carries
   *  ``blocks_correction`` — true entries render loud red,
   *  false entries amber. Suppressed when empty. */
  escalation_requests?: import("./auditTypes").EscalationRequest[];
  /** v5 supervisor's headline assessment (1-2 line summary).
   *  Canonical source; mirrored to
   *  ``AuditEvidence.overall_assessment``. Render target not yet
   *  defined; rides for forward-compat. */
  overall_assessment?: string | null;
  /** Schema-discriminator stamped by the agent build process,
   *  format ``agents@<short-sha>/<schema-tag>``. Canonical
   *  source; mirrored to ``AuditEvidence.agent_version`` and
   *  ``AuditReport.agent_version``. */
  agent_version?: string | null;
}

export interface CuratorCheckboxes {
  design_correct: boolean | null;
  tags_correct: boolean | null;
  ontology_terms_correct: boolean | null;
  sample_assignment_correct: boolean | null;
  close_but_not_quite: boolean | null;
}

/**
 * One curator-attached "what's wrong here" annotation, scoped to a
 * specific factor / FV / tag (or proposal-wide). The v2 ProposalCard
 * surfaces these via the per-row "+ flag" affordance.
 *
 * Categorical key + optional one-line note. The fixed category set
 * per surface gives discrete labels for prompt-tuning / DPO; the note
 * lets the curator add detail when the categories don't fit.
 *
 * Server-side persistence is forward-looking — the mock API's
 * pydantic schemas use ``extra="ignore"`` so unknown fields are
 * silently dropped today; once the Python schema picks up an
 * ``issue_tags`` field, the same wire format will round-trip.
 */
export interface IssueTag {
  /** Free-form scope tag — same convention as
   *  ``SubtaskDecision.target_id``. Examples:
   *  ``""`` (proposal-wide), ``"factor:disease"``,
   *  ``"factor:disease/fv:0"``, ``"tag:0"``. */
  target_id: string;
  /** Categorical key from a fixed per-surface vocabulary. */
  category: string;
  /** Optional one-line note when the category set doesn't fit. */
  note?: string;
}

export interface CuratorFeedback {
  status: ProposalStatus;
  reviewer: string;
  reviewed_at?: string;
  checkboxes: CuratorCheckboxes;
  reviewer_notes: string;
  edits?: Proposal | null;
  /** Free-text guidance for future agent runs ("treat ATF3 as a
   *  TF", "look for RBP-perturbation patterns"). Persisted in the
   *  feedback log; used by the prompt-tuning pipeline. */
  prompt_feedback?: string;
  /** Per-row problem tags from the v2 ProposalCard. */
  issue_tags?: IssueTag[];
}

export interface ProposalListResponse {
  items: Proposal[];
  total: number;
}
