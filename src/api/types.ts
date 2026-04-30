/**
 * Hand-written TypeScript mirror of the mock API's pydantic schemas
 * (gemma_curation_agents/agents/curation_proposer/schemas.py).
 *
 * Replace this file with `npm run gen-types` once the mock API is
 * running locally — that calls openapi-typescript against
 * http://localhost:8080/openapi.json and writes a generated schema.ts.
 * Until then this file keeps the UI buildable.
 */

export type ProposalStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "needs_changes";

export interface OntologyTerm {
  label: string;
  uri: string | null;
  resolver: string | null;
  score: number | null;
}

export interface TagProposal {
  category: OntologyTerm;
  value: OntologyTerm;
  evidence_quote: string;
  confidence: string;
}

export interface StatementProposal {
  category: OntologyTerm | null;
  subject: OntologyTerm;
  predicate: OntologyTerm | null;
  object: OntologyTerm | null;
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
}

export interface FactorProposal {
  category: OntologyTerm;
  name_in_design: string;
  factor_values: FactorValueProposal[];
}

/**
 * One decision made by a specialist sub-agent on the way to a
 * Proposal. The proposer is being decomposed (see
 * `PLAN-proposer-v2.md`) into a chain of sub-agents (baseline
 * picker, forbidden-EFC detector, statement template selector,
 * etc.); each emits a structured decision with a citation pointing
 * to the Confluence guideline that grounded it.
 */
export interface SubtaskDecision {
  subtask: string;       // "S6_baseline" / "S2_forbidden_efc" / etc.
  label: string;         // human-friendly section label
  verdict: string;       // plain-English summary of what was decided
  citation: string;      // short Confluence page reference
  citation_url: string;  // optional full URL
  /** Free-form scope tag — "factor:42" / "fv:813" / "tag:7" / ""
   *  (proposal-wide). UI groups decisions by this. */
  target_id: string;
  /** Structured confidence tier. Optional; existing subtasks leave
   *  it unset. ``zero`` is the kill switch — the UI auto-unchecks
   *  the targeted entity (e.g. zero-coverage factors are removed
   *  from the accept set by default). Eval scoring treats ``zero``
   *  as a coverage failure regardless of UI filtering. */
  confidence?: "zero" | "low" | "medium" | "high";
}

export interface ProposalEvidence {
  skeleton_excerpt: string;
  paper_source: string | null;
  paper_excerpt: string;
  exemplar_experiment_ids: number[];
  extra: Record<string, string>;
  /** Per-decision provenance from the new sub-agent chain. Absent
   *  on proposals submitted by the legacy single-shot pipeline. */
  subtask_decisions?: SubtaskDecision[];
}

export interface Proposal {
  proposal_id: string | null;
  experiment_id: number;
  experiment_short_name: string;
  submitted_by: string;
  submitted_at: string;
  model: string | null;
  status: ProposalStatus;
  tags: TagProposal[];
  factors: FactorProposal[];
  evidence: ProposalEvidence;
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
