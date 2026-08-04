/**
 * Pre-run agent configuration — what models + options the running agent
 * will use, so the AgentRunDialog can ANNOUNCE them for confirmation
 * before a proposal/audit fires (the run itself is not parameterized
 * from the UI; the curator confirms the agent's own config).
 *
 * AGENT-PENDING (handoff AGENT_CONFIG_ANNOUNCE_2026_08_03): the agents
 * side exposes `GET /config` reporting the resolved per-stage models +
 * the default options/switches. Until it ships, `useAgentConfig` 404s
 * and the dialog simply omits the settings block. Shape is read
 * defensively — any string/number/boolean value renders; unknown extra
 * keys are shown too, so a new switch surfaces without a UI change.
 */

import { useQuery } from "@tanstack/react-query";

export interface AgentConfig {
  /** Schema/build discriminator, e.g. ``agents@<sha>/v5``. */
  agent_version?: string | null;
  /** Per-stage resolved model ids — e.g.
   *  ``{ proposer, design, arbiter, boss_critic }``. Rendered as a
   *  labelled list; stage names come straight from the keys. */
  models?: Record<string, string> | null;
  /** Default options / switches the run will use — e.g.
   *  ``{ default_tier, with_comparison, fresh_preboarding, resolvers }``.
   *  Values may be string / number / boolean / string[]. */
  options?: Record<string, unknown> | null;
}

async function fetchAgentConfig(): Promise<AgentConfig | null> {
  try {
    const r = await fetch("/config", { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as AgentConfig;
  } catch {
    return null;
  }
}

/** Fetch the agent's resolved config. Cached for the session (config
 *  doesn't drift mid-session); no retry so a missing endpoint fails fast
 *  to ``null`` and the dialog just omits the block. */
export function useAgentConfig() {
  return useQuery({
    queryKey: ["agent-config"],
    queryFn: fetchAgentConfig,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
