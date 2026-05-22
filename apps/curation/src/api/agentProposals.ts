import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import type { ProposalListResponse } from "./types";
import type {
  AttachedDefenderVerdict,
  BossVerdict,
  FindingEvidence,
  SubtaskDecision,
} from "./justification";

/**
 * Wire shape for the new `agent_proposal` row returned by
 * `GET /rest/v2/datasets/{eid}/curation-proposals` when an
 * agent-proposal exists for the dataset (kind=dataset). When no
 * agent_proposal row exists the endpoint falls back to the legacy
 * `{items, total}` envelope (`ProposalListResponse`).
 *
 * Contract source: `EVAL_PKG_PROPOSALS_AS_DATASET_PROPOSALS_HANDOFF.md`
 * lines 90–153 in the agents repo (bro, 2026-05-22). The endpoint is
 * `gemma_curation_agents/local_api/server.py:list_for_experiment`
 * around line 515 with `shape=auto`.
 */
export interface AgentProposal {
  proposal_id: number;
  run_id: string;
  agent_version: string | null;
  model: string | null;
  ran_at: string | null;
  /** JSON string; parse with `parseAgentProposalPayload`. */
  payload_json: string;
  dataset_id: number;
  /** Discriminator on the unified `AgentCuration` table when Java's
   *  `RECCE_AGENT_CURATION_UNIFICATION.md` work lands. Today's mock
   *  serves proposal-kind rows only; we send `?kind=proposal` on the
   *  GET to be defensive against the audit-rows-on-same-endpoint
   *  forward shape. Field stays optional for backwards-compat with
   *  the pre-discriminator rows. */
  kind?: "proposal" | "audit";
}

export interface AgentProposalTag {
  category: string;
  value: string;
  value_uri: string | null;
  evidence_quote: string;
  badge: string;
  /** Defender / arbiter / boss verdicts attached to this tag.
   *  Landed 2026-05-22 per the unified-justification schema. */
  defender_verdicts?: AttachedDefenderVerdict[];
  /** Per-element rationale + citation + supporting evidence. NOT
   *  populated by today's payloads (producer migration 4b pending);
   *  optional so consumers can render when present. */
  rationale?: string;
  citation?: string;
  citation_url?: string;
  supporting_evidence?: FindingEvidence[];
  /** S2j / S2m / S2r-style decisions targeted at this tag. */
  subtask_decisions?: SubtaskDecision[];
  /** Deterministic detector slugs (multi_factor_collapse /
   *  multi_factor_split). Not populated today. */
  proposer_flags?: string[];
}

export interface AgentProposalStatement {
  subject_label: string;
  subject_uri: string | null;
  predicate_label: string;
  predicate_uri: string | null;
  object_label: string;
  object_uri: string | null;
  /** Subtask decisions targeted at this statement (target_id matches
   *  factor:N/fv:M/subject etc). */
  subtask_decisions?: SubtaskDecision[];
}

export interface AgentProposalBiomaterialAssignment {
  biomaterial_short_name: string;
  confidence: string;
  source: string;
  rationale?: string;
}

export interface AgentProposalFactorValue {
  label: string;
  n_samples: number;
  samples: string[];
  statements: AgentProposalStatement[];
  is_baseline: boolean;
  biomaterial_assignment_meta: AgentProposalBiomaterialAssignment[];
  match_type?: "exact" | "close" | "new";
  /** Justification fields — NOT populated by today's payloads, but
   *  typed for forward-compat with the unified schema. */
  defender_verdicts?: AttachedDefenderVerdict[];
  subtask_decisions?: SubtaskDecision[];
  rationale?: string;
  citation?: string;
  citation_url?: string;
  supporting_evidence?: FindingEvidence[];
  debate_badge?: string;
  proposer_flags?: string[];
}

export interface AgentProposalFactor {
  category: string;
  category_uri: string | null;
  factor_type: "categorical" | "continuous";
  n_fvs: number;
  factor_values: AgentProposalFactorValue[];
  baseline_relevance?: "required" | "not_applicable" | "uncertain";
  baseline_relevance_reason?: string;
  match_type?: "exact" | "close" | "new";
  /** Defender / arbiter / boss verdicts on this factor. Populated
   *  by today's payloads. */
  defender_verdicts?: AttachedDefenderVerdict[];
  /** Subtask decisions targeted at this factor (target_id matches
   *  factor:N or factor:<categoryLabel>). Sometimes populated. */
  subtask_decisions?: SubtaskDecision[];
  /** Per-element rationale + supporting evidence. NOT populated
   *  today (producer migration 4b pending). */
  rationale?: string;
  citation?: string;
  citation_url?: string;
  supporting_evidence?: FindingEvidence[];
  debate_badge?: string;
  proposer_flags?: string[];
}

export interface AgentProposalDesign {
  proposed_factors: AgentProposalFactor[];
  n_proposed: number;
}

export interface AgentProposalPayload {
  gse: string;
  run_id: string;
  tags: AgentProposalTag[];
  design: AgentProposalDesign;
  notes: unknown[];
  /** Proposal-wide subtask decisions (target_id = "" or referencing
   *  a specific element). Populated today across all 50 GSEs. */
  subtask_decisions?: SubtaskDecision[];
  /** Proposal-wide Boss ruling. NOT populated today — Boss
   *  per-element verdicts ride in `defender_verdicts[side="boss"]`,
   *  top-level ruling is producer-stubbed pending. */
  boss_verdict?: BossVerdict | null;
}

export function parseAgentProposalPayload(
  raw: string,
): AgentProposalPayload | null {
  try {
    return JSON.parse(raw) as AgentProposalPayload;
  } catch {
    return null;
  }
}

/**
 * Discriminated union for the proposals endpoint's auto-shape
 * response: new-shape (array of `AgentProposal`) when an agent_proposal
 * row exists for the dataset, otherwise legacy `{items, total}`. Callers
 * branch on `kind` and never touch the other arm's fields.
 */
export type ProposalsResponse =
  | { kind: "new"; items: AgentProposal[] }
  | { kind: "legacy"; items: ProposalListResponse["items"]; total: number };

function isAgentProposalArray(data: unknown): data is AgentProposal[] {
  return Array.isArray(data);
}

/**
 * Same endpoint as `useProposalsForExperiment`, but returns the
 * auto-shape discriminated union so callers can render the new
 * agent_proposal payload directly when present and fall through to the
 * legacy `Proposal` shape otherwise.
 *
 * Sharing a query key with `useProposalsForExperiment` would let the
 * two paths read each other's cache, but the response types diverge —
 * keep this hook's cache separate to avoid cross-contamination.
 *
 * Sends `?kind=proposal` so audits served through the unified
 * `AgentCuration` endpoint (per Java recce
 * `RECCE_AGENT_CURATION_UNIFICATION.md`) don't bleed into the
 * proposals sidebar. Today's local mock ignores the param (all rows
 * are proposal-kind anyway); server-side filtering kicks in once the
 * Java migration adds the discriminator column.
 */
export function useProposalsAutoShape(experimentId: number) {
  return useQuery({
    queryKey: ["proposals-auto", "experiment", experimentId] as const,
    queryFn: async (): Promise<ProposalsResponse> => {
      const raw = await api.get<unknown>(
        `/rest/v2/datasets/${experimentId}/curation-proposals?kind=proposal`,
      );
      if (isAgentProposalArray(raw)) {
        // Defensive client-side filter in case the server hasn't
        // landed the ?kind= query param yet (returns all kinds).
        // No-op against today's mock; protects the transient window
        // between Java's discriminator column landing and the GET
        // endpoint honouring the filter param.
        const proposals = raw.filter(
          (p) => p.kind === undefined || p.kind === "proposal",
        );
        return { kind: "new", items: proposals };
      }
      const legacy = raw as ProposalListResponse;
      return {
        kind: "legacy",
        items: legacy.items ?? [],
        total: legacy.total ?? 0,
      };
    },
  });
}
