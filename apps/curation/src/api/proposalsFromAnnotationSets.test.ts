/**
 * Reading proposals out of Gemma instead of the local store.
 *
 * Paul, 2026-09-01: *"I think agent proposals can live in Gemma, why
 * not? that way they are central."* The route was always there — it is
 * a `role` VALUE on `/datasets/{id}/annotation-sets`, not a path — and
 * `/curation/v1/…/curation-proposals` is a local-store path Gemma 404s
 * because it never had it.
 *
 * Field shapes here are verbatim from annotation set 4 on dataset
 * 27438 (gemma2, `design_proposer`, 94,368 bytes of `payloadJson`),
 * fetched and run through this code end to end before these were
 * written. Envelope keys are snake_case because `client.ts` snakeifies
 * every response at the boundary.
 */
import { describe, expect, it } from "vitest";

import {
  annotationSetsToProposals,
  isNoProposalsHere,
  parseAgentProposalPayload,
} from "./agentProposals";

/** The envelope, as it arrives post-snakeify. */
const SET_4 = {
  id: 4,
  dataset_id: 27438,
  role: "proposal",
  kind: "proposal",
  source: "agent",
  run_id: "2026-07-22_v1.1_master_400",
  agent_name: "design_proposer",
  agent_version: "v1.1",
  model: "claude-sonnet-5",
  ran_at: "2026-07-21T20:33:46Z",
  payload_json: JSON.stringify({
    gse: "GSE27438",
    // 🛑 Root-level, not under `design` — this is the difference.
    n_proposed: 1,
    proposed_factors: [
      {
        category: "treatment",
        category_uri: null,
        factor_type: "categorical",
        n_fvs: 1,
        rationale: "the series describes a dose response",
        factor_values: [
          {
            label: "control",
            n_samples: 2,
            n_samples_total: 4,
            samples: ["GSM1", "GSM2"],
            is_baseline: true,
            biomaterial_assignment_meta: [],
            statements: [
              {
                subject_label: "reference substance role",
                subject_uri: "http://…/OBI_0000025",
                predicate_label: null,
                predicate_uri: null,
                object_label: null,
                object_uri: null,
              },
            ],
          },
        ],
      },
    ],
  }),
};

describe("annotationSetsToProposals", () => {
  it("maps the envelope onto AgentProposal", () => {
    const [p] = annotationSetsToProposals([SET_4]);
    expect(p.proposal_id).toBe(4);
    expect(p.dataset_id).toBe(27438);
    expect(p.run_id).toBe("2026-07-22_v1.1_master_400");
    expect(p.agent_version).toBe("v1.1");
    expect(p.model).toBe("claude-sonnet-5");
    expect(p.ran_at).toBe("2026-07-21T20:33:46Z");
    expect(p.kind).toBe("proposal");
  });

  it("🛑 drops a set with no payload — a card with nothing in it is worse than no card", () => {
    // `shape=meta` returns `payloadSize` and no `payloadJson`. This
    // hook asks for `shape=full`, so a payload-less row means
    // something else went wrong; passing it on would render an empty
    // proposal rather than say so.
    expect(annotationSetsToProposals([{ ...SET_4, payload_json: undefined }])).toEqual([]);
    expect(annotationSetsToProposals([{ ...SET_4, payload_json: "" }])).toEqual([]);
  });

  it("tolerates a non-array body", () => {
    expect(annotationSetsToProposals(null)).toEqual([]);
    expect(annotationSetsToProposals({ data: [] })).toEqual([]);
  });
});

describe("parseAgentProposalPayload normalizes the two nestings", () => {
  it("🛑 lifts Gemma's root-level proposed_factors under `design`", () => {
    const payload = parseAgentProposalPayload(SET_4.payload_json)!;
    expect(payload.design?.proposed_factors).toHaveLength(1);
    expect(payload.design?.n_proposed).toBe(1);
    expect(payload.design?.proposed_factors[0].factor_values[0].label).toBe("control");
  });

  it("leaves the store's already-nested payload alone", () => {
    const nested = JSON.stringify({
      gse: "GSE1",
      run_id: "r1",
      tags: [],
      design: { proposed_factors: [], n_proposed: 0 },
    });
    expect(parseAgentProposalPayload(nested)?.design?.n_proposed).toBe(0);
  });

  it("falls back to the array length when n_proposed is absent", () => {
    const raw = JSON.stringify({ gse: "G", proposed_factors: [{}, {}] });
    expect(parseAgentProposalPayload(raw)?.design?.n_proposed).toBe(2);
  });

  it("returns null on junk rather than throwing", () => {
    expect(parseAgentProposalPayload("not json")).toBeNull();
    expect(parseAgentProposalPayload("null")).toBeNull();
  });
});

describe("isNoProposalsHere — 404 is an answer, 403 is a failure", () => {
  it("treats 404 as 'no proposals here'", () => {
    // The local-store path 404s on Gemma; the shell must still render.
    expect(isNoProposalsHere({ status: 404 })).toBe(true);
  });

  it("🛑 does NOT treat 403 as 'no proposals'", () => {
    // annotation-sets needs GROUP_CURATOR / ADMIN / AGENT. Swallowing
    // this would render an auth failure as an empty panel — the
    // curator would read "this dataset has no proposals" and be wrong.
    expect(isNoProposalsHere({ status: 403 })).toBe(false);
  });

  it("does not swallow 401 or 500 either", () => {
    expect(isNoProposalsHere({ status: 401 })).toBe(false);
    expect(isNoProposalsHere({ status: 500 })).toBe(false);
  });

  it("does not swallow a non-HTTP failure", () => {
    expect(isNoProposalsHere(new Error("network down"))).toBe(false);
    expect(isNoProposalsHere(null)).toBe(false);
  });
});
