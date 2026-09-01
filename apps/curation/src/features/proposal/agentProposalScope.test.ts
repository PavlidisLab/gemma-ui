/**
 * A proposal's SCOPE varies; the proposal is still one thing.
 *
 * Paul, 2026-09-01: *"a proposal can contain any number of things at
 * once … the scope might be limited to factors or tags or the entire
 * experiment, either way that's a proposal."* So one agent run is one
 * proposal, and a run that proposed no tags writes no `tags` key.
 *
 * The adapter used to call `payload.tags.map` and
 * `payload.design.proposed_factors.map` unguarded, against types that
 * declared both required. Annotation set 4 on dataset 27438 — a real
 * `design_proposer` run on gemma2, 94,368 bytes — has three
 * `proposed_factors` and no `tags` key at all, so the required types
 * were contradicted by production data and every read of one was a
 * TypeError waiting for the panel to fetch it.
 */
import { describe, expect, it } from "vitest";

import type { AgentProposal, AgentProposalPayload } from "@/api/agentProposals";

import {
  agentProposalToApplyArgs,
  agentProposalToLegacyProposal,
} from "./agentProposalAdapter";

const ENVELOPE: AgentProposal = {
  proposal_id: 4,
  run_id: "2026-07-22_v1.1_master_400",
  agent_version: "v1.1",
  model: "claude-sonnet-5",
  ran_at: "2026-07-21T20:33:46Z",
  payload_json: "{}",
  dataset_id: 27438,
  kind: "proposal",
} as AgentProposal;

/** Shaped like set 4: factors, no `tags` key. */
const FACTOR_ONLY = {
  gse: "GSE27438",
  run_id: "2026-07-22_v1.1_master_400",
  design: {
    proposed_factors: [
      {
        name_in_design: "Treatment",
        category: "treatment",
        category_uri: null,
        factor_type: "categorical",
        description: "",
        n_fvs: 1,
        factor_values: [
          {
            label: "control",
            n_samples: 2,
            samples: ["GSM1", "GSM2"],
            statements: [],
            is_baseline: true,
            biomaterial_assignment_meta: [],
          },
        ],
      },
    ],
    n_proposed: 1,
  },
} as unknown as AgentProposalPayload;

/** The mirror case: a run that proposed only tags. */
const TAG_ONLY = {
  gse: "GSE27438",
  run_id: "r2",
  tags: [
    {
      category: "organism part",
      value: "liver",
      value_uri: null,
      evidence_quote: "liver tissue was dissected",
      badge: "proposed",
    },
  ],
} as unknown as AgentProposalPayload;

describe("a factor-only proposal — the shape production actually holds", () => {
  it("🛑 adapts to apply-args without touching an absent `tags`", () => {
    const args = agentProposalToApplyArgs(FACTOR_ONLY);
    expect(args.tags).toEqual([]);
    expect(args.factors).toHaveLength(1);
  });

  it("🛑 adapts to a legacy Proposal without touching an absent `tags`", () => {
    const p = agentProposalToLegacyProposal(ENVELOPE, FACTOR_ONLY);
    expect(p.tags).toEqual([]);
    expect(p.factors).toHaveLength(1);
  });
});

describe("a tag-only proposal — the same claim, other scope", () => {
  it("adapts without touching an absent `design`", () => {
    const args = agentProposalToApplyArgs(TAG_ONLY);
    expect(args.factors).toEqual([]);
    expect(args.tags).toHaveLength(1);
  });

  it("adapts to a legacy Proposal without touching an absent `design`", () => {
    const p = agentProposalToLegacyProposal(ENVELOPE, TAG_ONLY);
    expect(p.factors).toEqual([]);
    expect(p.tags).toHaveLength(1);
  });
});

describe("a proposal that scoped to neither", () => {
  it("is empty rather than a throw", () => {
    const empty = { gse: "GSE1", run_id: "r3" } as unknown as AgentProposalPayload;
    expect(agentProposalToApplyArgs(empty)).toEqual({ tags: [], factors: [] });
  });
});
