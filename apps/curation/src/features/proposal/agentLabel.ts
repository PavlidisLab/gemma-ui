/**
 * Provenance-badge label for an agent proposal.
 *
 * The agent is NOT the model: two different agent builds can call the
 * same LLM, so a badge that reads ``claude-sonnet-5`` names the model a
 * stage invoked, not the agent that produced the work. Prefer the agent
 * BUILD identity (``v1.1-87-g5344f2e``); the model demotes to the
 * tooltip. Old rows (blank ``agent_version``) fall back to the model,
 * prefixed so it still reads as a model.
 */
import type { Proposal } from "@/api/types";

export interface AgentBadge {
  /** Small uppercase prefix — "agent" (identity) or "model" (fallback). */
  prefix: string;
  /** The value shown in the chip. */
  label: string;
  /** Hover title with the full provenance. */
  title: string;
}

export function agentBadge(proposal: Proposal): AgentBadge {
  const id = proposal.agent_version?.trim();
  if (id) {
    return {
      prefix: "agent",
      label: id,
      title: proposal.model
        ? `Agent build ${id} · ran on ${proposal.model}`
        : `Agent build ${id}`,
    };
  }
  return {
    prefix: "model",
    label: proposal.model ?? "",
    title: proposal.model ? `AI model: ${proposal.model}` : "",
  };
}
