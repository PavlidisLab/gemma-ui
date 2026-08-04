import { describe, expect, it } from "vitest";
import type { Proposal } from "@/api/types";
import { agentBadge } from "./agentLabel";

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    proposal_id: "1",
    experiment_id: 51,
    experiment_short_name: "GSE1",
    submitted_by: "agent",
    submitted_at: "",
    model: "claude-sonnet-5",
    status: "pending",
    tags: [],
    factors: [],
    evidence: {} as Proposal["evidence"],
    ...overrides,
  } as Proposal;
}

describe("agentBadge — name the agent by build, not model", () => {
  it("names the agent by its build identity, model in the tooltip", () => {
    const b = agentBadge(proposal({ agent_version: "v1.1-87-g5344f2e" }));
    expect(b.prefix).toBe("agent");
    expect(b.label).toBe("v1.1-87-g5344f2e");
    expect(b.title).toContain("ran on claude-sonnet-5");
  });

  it("falls back to the model labelled 'model' on old rows (no identity)", () => {
    const b = agentBadge(proposal({ agent_version: null }));
    expect(b.prefix).toBe("model");
    expect(b.label).toBe("claude-sonnet-5");
  });

  it("treats a blank/whitespace identity as absent", () => {
    expect(agentBadge(proposal({ agent_version: "   " })).prefix).toBe("model");
  });
});
