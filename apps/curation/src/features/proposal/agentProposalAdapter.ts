import type {
  AgentProposal,
  AgentProposalBiomaterialAssignment,
  AgentProposalFactor,
  AgentProposalFactorValue,
  AgentProposalPayload,
  AgentProposalStatement,
  AgentProposalTag,
} from "@/api/agentProposals";
import type {
  BiomaterialAssignmentMeta,
  FactorProposal,
  FactorValueProposal,
  OntologyTerm,
  Proposal,
  StatementProposal,
  TagProposal,
} from "@/api/types";

/**
 * Shape that `applyProposalToDesign` (in `features/design/mutations.ts`)
 * takes for its tag-args parameter. Mirroring the structural type here
 * keeps the adapter compile-time-checked against the mutation
 * signature.
 */
export interface ApplyTagArg {
  category: { label: string; uri?: string | null };
  value: { label: string; uri?: string | null };
}

export interface ApplyStatementArg {
  category?: { label: string; uri?: string | null } | null;
  subject: { label: string; uri?: string | null };
  predicate?: { label: string; uri?: string | null } | null;
  object?: { label: string; uri?: string | null } | null;
}

export interface ApplyFactorValueArg {
  free_text_label: string;
  is_baseline: boolean;
  numeric_value?: number | null;
  statements: ApplyStatementArg[];
  biomaterial_short_names: string[];
}

export interface ApplyFactorArg {
  category: { label: string; uri?: string | null };
  name_in_design: string;
  factor_type?: "categorical" | "continuous";
  baseline_relevance?: "required" | "not_applicable" | "uncertain";
  baseline_relevance_reason?: string;
  factor_values: ApplyFactorValueArg[];
}

function statementToArg(s: AgentProposalStatement): ApplyStatementArg {
  const hasPredicate = !!(s.predicate_label || s.predicate_uri);
  const hasObject = !!(s.object_label || s.object_uri);
  return {
    // The new-shape payload doesn't carry a per-statement category;
    // applyProposalToDesign inherits the parent factor's category when
    // null is passed.
    category: null,
    subject: { label: s.subject_label, uri: s.subject_uri },
    predicate: hasPredicate
      ? { label: s.predicate_label, uri: s.predicate_uri }
      : null,
    object: hasObject
      ? { label: s.object_label, uri: s.object_uri }
      : null,
  };
}

function tagToArg(t: AgentProposalTag): ApplyTagArg {
  return {
    // Tags in the new shape carry no category_uri — only the label.
    // applyProposalToDesign accepts the label-only category and the
    // dedup key (tagKey) compares on labels too.
    category: { label: t.category, uri: null },
    value: { label: t.value, uri: t.value_uri },
  };
}

function factorToArg(f: AgentProposalFactor): ApplyFactorArg {
  return {
    category: { label: f.category, uri: f.category_uri },
    // No separate name_in_design field in the new shape — use the
    // category label as the default factor name. Matches what
    // applyProposalToDesign already does when name_in_design is empty.
    name_in_design: f.category,
    factor_type: f.factor_type,
    baseline_relevance: f.baseline_relevance,
    baseline_relevance_reason: f.baseline_relevance_reason,
    factor_values: f.factor_values.map((fv) => ({
      free_text_label: fv.label,
      is_baseline: fv.is_baseline,
      // New shape has no numeric_value on FVs; continuous-factor support
      // here can land later if needed.
      numeric_value: null,
      statements: fv.statements.map(statementToArg),
      biomaterial_short_names: [...fv.samples],
    })),
  };
}

/**
 * Adapt a parsed `AgentProposalPayload` to the arg pair expected by
 * `applyProposalToDesign(design, tags, factors)`.
 */
export function agentProposalToApplyArgs(payload: AgentProposalPayload): {
  tags: ApplyTagArg[];
  factors: ApplyFactorArg[];
} {
  return {
    tags: (payload.tags ?? []).map(tagToArg),
    factors: (payload.design?.proposed_factors ?? []).map(factorToArg),
  };
}

// ---------------------------------------------------------------------------
// Adapter to the legacy ``Proposal`` envelope so the rich ProposalCardV2
// renderer can be reused against new-shape agent_proposal data. Legacy
// fields the new shape doesn't carry get sensible defaults; the
// envelope is render-only — accept/reject PATCHes against the legacy
// /curation-proposals endpoint will 404 (new shape has its own endpoint
// path under preboarding), and ProposalCardV2's onError already handles
// 404 as "proposal gone" without crashing.
// ---------------------------------------------------------------------------

function term(label: string, uri: string | null): OntologyTerm {
  return { label, uri, resolver: null, score: null };
}

function bmMetaFromAgent(
  m: AgentProposalBiomaterialAssignment,
): BiomaterialAssignmentMeta {
  return {
    biomaterial_short_name: m.biomaterial_short_name,
    confidence: m.confidence,
    source: m.source,
    rationale: m.rationale,
  };
}

/** Flat agent statement (``subject_label`` / ``subject_uri`` / …) →
 *  nested ``StatementProposal`` (``subject: {label, uri}``). Exported
 *  because the audit side needs the same conversion: an add-factor
 *  finding's ``apply_action.new_factor_payload`` carries whichever of
 *  the two statement shapes its producer emitted. */
export function statementFromAgent(
  s: AgentProposalStatement,
): StatementProposal {
  const hasPredicate = !!(s.predicate_label || s.predicate_uri);
  const hasObject = !!(s.object_label || s.object_uri);
  return {
    category: null,
    subject: term(s.subject_label, s.subject_uri),
    predicate: hasPredicate ? term(s.predicate_label, s.predicate_uri) : null,
    object: hasObject ? term(s.object_label, s.object_uri) : null,
    subtask_decisions: s.subtask_decisions,
  };
}

function factorValueFromAgent(
  fv: AgentProposalFactorValue,
): FactorValueProposal {
  return {
    free_text_label: fv.label,
    is_baseline: fv.is_baseline,
    statements: fv.statements.map(statementFromAgent),
    biomaterial_short_names: [...fv.samples],
    biomaterial_assignment_meta: (fv.biomaterial_assignment_meta ?? []).map(
      bmMetaFromAgent,
    ),
    numeric_value: null,
    match_type: fv.match_type,
    defender_verdicts: fv.defender_verdicts,
    subtask_decisions: fv.subtask_decisions,
    rationale: fv.rationale,
    citation: fv.citation,
    citation_url: fv.citation_url,
    supporting_evidence: fv.supporting_evidence,
    debate_badge: fv.debate_badge,
    proposer_flags: fv.proposer_flags,
  };
}

function factorFromAgent(f: AgentProposalFactor): FactorProposal {
  return {
    category: term(f.category, f.category_uri),
    name_in_design: f.category,
    factor_type: f.factor_type,
    baseline_relevance: f.baseline_relevance,
    baseline_relevance_reason: f.baseline_relevance_reason,
    factor_values: f.factor_values.map(factorValueFromAgent),
    match_type: f.match_type,
    defender_verdicts: f.defender_verdicts,
    subtask_decisions: f.subtask_decisions,
    rationale: f.rationale,
    citation: f.citation,
    citation_url: f.citation_url,
    supporting_evidence: f.supporting_evidence,
    debate_badge: f.debate_badge,
    proposer_flags: f.proposer_flags,
  };
}

function tagFromAgent(t: AgentProposalTag): TagProposal {
  return {
    category: term(t.category, null),
    value: term(t.value, t.value_uri),
    evidence_quote: t.evidence_quote,
    confidence: "",
    badge: t.badge,
    defender_verdicts: t.defender_verdicts,
    subtask_decisions: t.subtask_decisions,
    rationale: t.rationale,
    citation: t.citation,
    citation_url: t.citation_url,
    supporting_evidence: t.supporting_evidence,
    proposer_flags: t.proposer_flags,
  };
}

/**
 * Synthesize a legacy `Proposal` envelope from a new-shape
 * `agent_proposal` + its parsed payload. Used to feed the rich
 * ProposalCardV2 layout for new-shape experiments. The new
 * `proposal_id` is numeric — stringified here so the legacy
 * envelope's string-keyed identity works for cache invalidation
 * paths, though the actual PATCH /curation-proposals/{id} endpoint
 * doesn't exist for these rows and will 404 (handled gracefully by
 * ProposalCardV2's onError path).
 */
export function agentProposalToLegacyProposal(
  agentProposal: AgentProposal,
  payload: AgentProposalPayload,
): Proposal {
  return {
    proposal_id: String(agentProposal.proposal_id),
    experiment_id: agentProposal.dataset_id,
    experiment_short_name: payload.gse,
    submitted_by: "agent",
    submitted_at: agentProposal.ran_at ?? "",
    model: agentProposal.model,
    // The agent BUILD identity (v1.1-87-g5344f2e) — distinct from the
    // LLM ``model`` a stage called. The badge names the agent by this;
    // ``model`` demotes to a secondary chip / tooltip. Was dropped here
    // (built with ``extra: {}`` and never copied), so proposals read as
    // the model id.
    agent_version: agentProposal.agent_version,
    status: "pending",
    tags: (payload.tags ?? []).map(tagFromAgent),
    factors: (payload.design?.proposed_factors ?? []).map(factorFromAgent),
    evidence: {
      preboarding_excerpt: "",
      paper_source: null,
      paper_excerpt: "",
      exemplar_experiment_ids: [],
      extra: {},
      subtask_decisions: payload.subtask_decisions,
    },
    subtask_decisions: payload.subtask_decisions,
    boss_verdict: payload.boss_verdict ?? null,
  };
}
