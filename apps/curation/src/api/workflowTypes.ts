/**
 * TS mirrors of the Pydantic schemas in
 * `gemma_curation_agents/mock_gemma_curation_api/workflow_schemas.py`.
 *
 * Wire contract is documented in WORKFLOW_MANAGEMENT_HANDOFF.md.
 * When my brother updates the Python schemas, regenerate these to match.
 */

// ---------------------------------------------------------------------------
// Pipeline step status
// ---------------------------------------------------------------------------

export type StepStatus =
  | "not_run"
  | "ok"
  | "failed"
  | "in_progress"
  | "needs_attention"
  | "na";

export interface PipelineStep {
  status: StepStatus;
  last_run: string | null;
  details: string | null;
}

export interface AnalysisTrack {
  missing_value_analysis: PipelineStep;
  batch_info: PipelineStep;
  preprocessing: PipelineStep;
  dea: PipelineStep;
  diagnostics: PipelineStep;
}

export interface CurationTrack {
  design: PipelineStep;
  tags: PipelineStep;
  outlier_review: PipelineStep;
  batch_decision: PipelineStep;
  audit: PipelineStep;
}

export interface CandidateProvenance {
  candidate_id: string;
  accession: string;
  source: string;
  source_batch: string | null;
  approved_by: string | null;
  approved_at: string | null;
}

export interface GeeqScores {
  quality: number | null;
  suitability: number | null;
  batch_confound: boolean | null;
  batch_effect: string | null;
  manual_batch_confound_active: boolean;
  manual_batch_effect_active: boolean;
  manual_quality_override: boolean;
  manual_suitability_override: boolean;
  q_sample_mean_correlation: number | null;
  q_sample_correlation_variance: number | null;
  q_sample_median_correlation: number | null;
  q_outliers: number | null;
  q_platforms_tech: number | null;
  q_replicates: number | null;
  q_batch_info: number | null;
  q_batch_confound: number | null;
  q_batch_effect: number | null;
  s_publication: number | null;
  s_platform_amount: number | null;
  s_sample_size: number | null;
  s_raw_data: number | null;
  s_missing_values: number | null;
}

export interface ExperimentPipelineStatus {
  dataset_id: number | string;
  analysis: AnalysisTrack;
  curation: CurationTrack;
  is_public: boolean;
  is_troubled: boolean;
  needs_attention: boolean;
  curation_note: string | null;
  geeq_quality: number | null;
  geeq_suitability: number | null;
  candidate_provenance: CandidateProvenance | null;
}

// ---------------------------------------------------------------------------
// Async task (pipeline dispatch)
// ---------------------------------------------------------------------------

export type TaskStatus = "running" | "completed" | "failed";

export type PipelineStepName =
  | "missing_value"
  | "batch_info"
  | "preprocess"
  | "pca"
  | "dea"
  | "coexpression";

export interface AsyncTask {
  task_id: string;
  experiment_id: number;
  step: PipelineStepName;
  status: TaskStatus;
  started_at: string;
  completed_at: string | null;
  message: string;
}

export interface DifferentialAnalysisRunRequest {
  factor_ids?: number[];
  include_interactions?: boolean;
  subset_factor_id?: number | null;
}

// ---------------------------------------------------------------------------
// Outlier / QT write shapes
// ---------------------------------------------------------------------------

export interface OutlierPatch {
  outlier: boolean;
}

export interface QuantitationTypePatch {
  is_preferred: boolean;
}

// ---------------------------------------------------------------------------
// Groups (typed: screening / pipeline / review)
// ---------------------------------------------------------------------------

export type GroupType = "screening" | "pipeline" | "review";

/** Per-member experiment summary for the set-navigator popover.
 *  Returned alongside ``member_ids`` when the caller opts in with
 *  ``?include_summaries=true`` on the group read endpoints. Parallel
 *  to ``member_ids`` (same length, same order); index by position.
 *
 *  Edge cases:
 *  - Members that aren't numeric experiment IDs (screening-group
 *    candidate UUIDs) get ``experiment_id=0`` with the raw member_id
 *    in ``short_name``.
 *  - Numeric members missing a Design row get
 *    ``short_name="experiment_<id>"`` with the rest defaulted; the UI
 *    can render them as "unknown".
 */
/** Per-experiment audit-progress hint surfaced in the set-navigator
 *  popover so curators walking a calibration set can see at a glance
 *  which members they haven't started yet vs which ones are
 *  in-progress vs finalized.
 *
 *  - ``none`` — no AuditReport exists for this experiment.
 *  - ``in_progress`` — at least one AuditReport row exists but none
 *    are finalized; OR a finalized report exists with pending
 *    dispositions remaining.
 *  - ``closed`` — at least one AuditReport is finalized AND every
 *    finding on the latest report has a non-pending disposition.
 *
 *  ``undefined`` on older agents that pre-date the field. */
export type ExperimentAuditStatus = "none" | "in_progress" | "closed";

export interface ExperimentSummary {
  experiment_id: number;
  short_name: string;
  title: string;
  taxon: string;
  troubled: boolean;
  needs_attention: boolean;
  is_public: boolean;
  /** See ``ExperimentAuditStatus``. Optional / undefined on older
   *  agents — UI renders no audit glyph in that case rather than
   *  guessing. */
  audit_status?: ExperimentAuditStatus;
}

/** Fine-grained "what's the curator's job on this set" classifier,
 *  parallel to ``Ticket.kind``. ``Group.type`` is the coarse
 *  surface (screening / pipeline / review queues); ``task_kind``
 *  narrows it to the specific job. Free string by design — new
 *  task kinds can be added without a schema migration; the UI's
 *  label lookup table degrades gracefully on unknown values
 *  (renders the raw slug).
 *
 *  Known values (mirror of agents-side
 *  ``SET_TASK_KIND_HANDOFF.md``):
 *  - ``review_proposal``    — calibration packages
 *  - ``audit_existing``     — re-audit batches
 *  - ``curate_from_scratch``— preboarded GSEs (no prior curation)
 *  - ``screening``          — screening-type groups
 *
 *  Optional / undefined on older Groups predating the field; UI
 *  callers fall back to deriving from ``type``. */
export type GroupTaskKind =
  | "review_proposal"
  | "audit_existing"
  | "curate_from_scratch"
  | "screening"
  | (string & {});

/** Aggregate of per-member ``audit_status`` across a group's
 *  members, pre-computed server-side so the dashboard doesn't have
 *  to issue N per-card fetches. Keys are snake_case on the wire
 *  (verified by cab's reply 2026-05-25). Always populated — never
 *  null — so consumers can read the counts without a None-guard.
 *
 *  Bucket semantics (mirror of agents-side
 *  ``GROUP_FINALIZE_AND_LIST_STATUS_HANDOFF.md``):
 *  - ``done``        — finalized review on the latest audit
 *  - ``in_progress`` — curation_review exists, latest not
 *                      finalized (today still includes the
 *                      "agent ran, curator hasn't acted" case;
 *                      §3 of the handoff asks for a refinement)
 *  - ``untouched``   — no curation_review row at all */
export interface MemberStatusCounts {
  done: number;
  in_progress: number;
  untouched: number;
}

export interface Group {
  id: string;
  name: string;
  type: GroupType;
  /** See ``GroupTaskKind``. Optional on older backends + groups
   *  that pre-date the column; consumers default per ``type``
   *  when absent. */
  task_kind?: GroupTaskKind | null;
  description: string;
  created_by: string;
  created_at: string;
  /** ISO 8601 of the curator's set-level "I'm done with this
   *  grouping" press. Null on open sets. Idempotent-refresh on
   *  re-POST (matches per-experiment finalize). Set-level only —
   *  does NOT cascade to per-member ``curation_review.finalized_at``.
   *  Per ``GROUP_FINALIZE_AND_LIST_STATUS_HANDOFF.md`` §1. */
  finalized_at?: string | null;
  /** Reviewer who finalized, when finalized. Pairs with
   *  ``finalized_at``. */
  finalized_by?: string | null;
  /** Free-text note the curator attached at finalize time. Survives
   *  reopen — only ``finalized_at`` + ``finalized_by`` clear on
   *  reopen, so a refinalize prefills the dialog. */
  finalized_notes?: string | null;
  /** Server-aggregated counts of per-member audit_status. Drops
   *  the per-card ``useGroup({includeSummaries: true})`` pattern
   *  for the dashboard's progress bar — one fetch, all the
   *  counts. Optional / undefined on older agents pre-dating the
   *  field; consumers fall back to deriving from member_summaries
   *  in that case. */
  member_status_counts?: MemberStatusCounts | null;
  /** Ordered by ``added_at`` (insertion time) — predictable + stable
   *  across reads, so the navigator's prev/next can index by
   *  position. */
  member_ids: string[];
  member_count: number;
  /** Populated only when the request set ``?include_summaries=true``.
   *  ``null`` (or undefined on older agents) means the caller
   *  asked the chip-light path; the navigator must re-fetch with
   *  the flag on. */
  member_summaries?: ExperimentSummary[] | null;
}

export interface GroupCreate {
  name: string;
  type: GroupType;
  description?: string;
}

export interface GroupPatch {
  name?: string;
  description?: string;
}

export interface GroupMembersAdd {
  member_ids: (string | number)[];
}

// ---------------------------------------------------------------------------
// Candidates (pre-Gemma screening entities)
// ---------------------------------------------------------------------------

export type CandidateSource = "GEO" | "ArrayExpress" | "SRA" | "manual";

export type CandidateStatus =
  | "pending"
  | "in_review"
  | "approved"
  | "excluded"
  | "deferred"
  | "loaded";

export interface Candidate {
  id: string;
  accession: string;
  source: CandidateSource;
  title: string | null;
  organism: string | null;
  platform: string | null;
  sample_count: number | null;
  status: CandidateStatus;
  decision_reason: string | null;
  reviewer: string | null;
  reviewed_at: string | null;
  notes: string | null;
  gemma_id: number | null;
  loaded_at: string | null;
  added_by: string;
  added_at: string;
  source_batch: string | null;
}

export interface CandidateCreate {
  accession: string;
  source: CandidateSource;
  title?: string;
  organism?: string;
  platform?: string;
  sample_count?: number;
  notes?: string;
  source_batch?: string;
}

export interface CandidateBulkCreateItem {
  accession: string;
  title?: string;
  organism?: string;
  platform?: string;
  sample_count?: number;
  notes?: string;
}

export interface CandidateBulkCreate {
  source: CandidateSource;
  source_batch: string;
  items: CandidateBulkCreateItem[];
}

export interface CandidatePatch {
  status?: CandidateStatus;
  decision_reason?: string;
  reviewer?: string;
  notes?: string;
  gemma_id?: number;
}

// ---------------------------------------------------------------------------
// Paginated dataset list (WorkflowDatasetRow)
// ---------------------------------------------------------------------------

/** One row in the workflow queue dataset list.
 *  Mirrors workflow_schemas.WorkflowDatasetRow in the Python mock. */
export interface WorkflowDatasetRow {
  id: number;
  short_name: string;
  name: string;
  taxon_common_name: string;
  technology_type: string;
  number_of_bio_assays: number;
  last_updated: string;
  troubled: boolean;
  needs_attention: boolean;
  is_public: boolean;
  curation_note: string | null;
  geeq_public_quality_score: number | null;
  geeq_public_suitability_score: number | null;
  n_pending_proposals: number;
  n_unactioned_blocker: number;
  n_unactioned_major: number;
  latest_audit_verdict: string | null;
}

export interface WorkflowDatasetListResponse {
  data: WorkflowDatasetRow[];
  total_elements: number;
  offset: number;
  limit: number;
}

export interface DatasetListParams {
  query?: string;
  filter?: string;
  sort?: string;
  limit?: number;
  offset?: number;
  ids?: string;
}
