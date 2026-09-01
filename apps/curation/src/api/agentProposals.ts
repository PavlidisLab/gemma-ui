import { useQuery } from "@tanstack/react-query";
import { resolveGemmaMode } from "@/lib/gemmaMode";

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
 * Wire contract defined on the agents side (2026-05-22). The endpoint is
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
  /** 🛑 Optional: the STORE's payload carries it, Gemma's does not —
   *  there the run identity lives on the annotation-set envelope
   *  (`runId`, `agentVersion`, `model`, `ranAt`), which is the better
   *  home because it stays queryable (`?createdBy=`, `?source=`)
   *  instead of being buried in a string. Nothing reads it off the
   *  payload today; read `AgentProposal.run_id` instead. */
  run_id?: string;
  /** 🛑 **Optional, because a proposal is monolithic and its SCOPE
   *  varies** (Paul, 2026-09-01: *"a proposal can contain any number of
   *  things at once … the scope might be limited to factors or tags or
   *  the entire experiment, either way that's a proposal"*). One agent
   *  run is one proposal, so a `design_proposer` run proposes no tags
   *  and the key is simply absent — annotation set 4 on dataset 27438
   *  is exactly that, and it is valid. Declaring these required made
   *  every consumer's `.map` a crash on a real payload. */
  tags?: AgentProposalTag[];
  design?: AgentProposalDesign;
  notes?: unknown[];
  /** Proposal-wide subtask decisions (target_id = "" or referencing
   *  a specific element). Populated today across all 50 GSEs. */
  subtask_decisions?: SubtaskDecision[];
  /** Proposal-wide Boss ruling. NOT populated today — Boss
   *  per-element verdicts ride in `defender_verdicts[side="boss"]`,
   *  top-level ruling is producer-stubbed pending. */
  boss_verdict?: BossVerdict | null;
}

/**
 * Parse a proposal payload, and normalize the ONE structural
 * difference between its two producers.
 *
 * 🛑 **The store nests the design; Gemma's payload does not.** A set
 * written to Gemma carries `proposed_factors` and `n_proposed` at the
 * payload ROOT (measured on annotation set 4, dataset 27438), while
 * `AgentProposalPayload` — and every consumer — reads
 * `design.proposed_factors`. Lifting it here rather than at each call
 * site is deliberate: the alternative is a `payload.design?.x ?? payload.x`
 * at every read, which is the pattern that keeps failing when one site
 * is forgotten.
 *
 * Gemma stores `payloadJson` verbatim and neither validates nor
 * reshapes it, so this is the only place the two shapes can meet.
 */
export function parseAgentProposalPayload(
  raw: string,
): AgentProposalPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as AgentProposalPayload & {
    proposed_factors?: AgentProposalFactor[];
    n_proposed?: number;
  };
  if (!p.design && Array.isArray(p.proposed_factors)) {
    return {
      ...p,
      design: {
        proposed_factors: p.proposed_factors,
        n_proposed: p.n_proposed ?? p.proposed_factors.length,
      },
    };
  }
  return p;
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
/**
 * Is this error "this dataset has no proposals", or a real failure?
 *
 * 🛑 **404 only.** The local-store path 404s against Gemma, and
 * swallowing that is what keeps the curation shell rendering the rest
 * of the experiment.
 *
 * 🛑 **Never 403.** `/datasets/{id}/annotation-sets` requires
 * `GROUP_CURATOR`, `GROUP_ADMIN` or `GROUP_AGENT` and answers 403 to a
 * session holding none of them. Widening this predicate to cover 403
 * would render an authorization failure as an empty proposals panel —
 * a confident wrong answer, where the throw gives the curator an error
 * they can act on. Extracted from the hook so this stays pinned.
 */
export function isNoProposalsHere(e: unknown): boolean {
  return (
    !!e &&
    typeof e === "object" &&
    "status" in e &&
    (e as { status: number }).status === 404
  );
}

/**
 * One `role=proposal` annotation set → one `AgentProposal`.
 *
 * The envelope maps across cleanly — `client.ts` already snakeifies
 * every response at the boundary, so Gemma's camelCase `runId` /
 * `ranAt` / `payloadJson` arrive in the shape this type declares and
 * there is no per-field renaming to do here.
 *
 * A set with no `payloadJson` is dropped rather than passed on with an
 * empty string: `parseAgentProposalPayload` would return `null` for it
 * and every consumer would render a proposal card with nothing in it.
 * That happens for `shape=meta`, which this hook does not request.
 */
export function annotationSetsToProposals(raw: unknown): AgentProposal[] {
  if (!Array.isArray(raw)) return [];
  const out: AgentProposal[] = [];
  for (const r of raw as Array<Record<string, unknown>>) {
    if (!r || typeof r !== "object") continue;
    const payload = r.payload_json;
    if (typeof payload !== "string" || !payload) continue;
    out.push({
      proposal_id: Number(r.id),
      run_id: typeof r.run_id === "string" ? r.run_id : "",
      agent_version:
        typeof r.agent_version === "string" ? r.agent_version : null,
      model: typeof r.model === "string" ? r.model : null,
      ran_at: typeof r.ran_at === "string" ? r.ran_at : null,
      payload_json: payload,
      dataset_id: Number(r.dataset_id),
      kind: "proposal",
    });
  }
  return out;
}

export function useProposalsAutoShape(experimentId: number | string) {
  return useQuery({
    enabled: Boolean(experimentId),
    queryKey: ["proposals-auto", "experiment", experimentId] as const,
    queryFn: async (): Promise<ProposalsResponse> => {
      // 🛑 **Remote mode reads proposals from Gemma, not the store.**
      // Paul, 2026-09-01: *"I think agent proposals can live in Gemma,
      // why not? that way they are central"* — and the route was always
      // there, expressed as a `role` VALUE rather than a path name,
      // which is why a search of the OpenAPI for `curation-proposal`
      // found nothing and read as "the capability is missing".
      //
      // `/curation/v1/datasets/{id}/curation-proposals` is a
      // LOCAL-STORE path; Gemma 404s it because it never had it. Local
      // mode keeps it — the store still serves proposals there and the
      // @critical suite drives that mode.
      //
      // Forward-only: proposals already in the store are NOT migrated
      // (Paul, 2026-09-01: *"no we don't want to backfill"*), so a
      // dataset whose only proposals are store-side shows none here in
      // remote mode. That is the ruling, not a regression.
      const remote = resolveGemmaMode().mode === "remote";
      let raw: unknown;
      try {
        raw = remote
          ? await api.get<unknown>(
              `/rest/v2/datasets/${experimentId}/annotation-sets?role=proposal&shape=full`,
            )
          : await api.get<unknown>(
              `/curation/v1/datasets/${experimentId}/curation-proposals?kind=proposal`,
            );
      } catch (e: unknown) {
        // 🛑 **404 only, never 403.** The local-store path 404s on
        // Gemma, and treating that as "no proposals" is what keeps the
        // curation shell rendering. The annotation-sets route needs
        // `GROUP_CURATOR`, `GROUP_ADMIN` or `GROUP_AGENT` and answers
        // **403** to a session holding none — widening this to cover
        // 403 would render an auth failure as an empty panel, which is
        // a confident wrong answer rather than an error the curator
        // can act on.
        if (isNoProposalsHere(e)) {
          return { kind: "legacy", items: [], total: 0 };
        }
        throw e;
      }
      if (remote) {
        return { kind: "new", items: annotationSetsToProposals(raw) };
      }
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
