/**
 * Liveness probes for the two backends the curation UI depends on:
 *
 *   - **Gemma curation REST** (local_api in local mode, real Gemma in
 *     remote mode) — backs every ``/rest/v2/...`` call.
 *   - **Agent service** (proposer / auditor / find-* FastAPI) —
 *     backs ``/propose``, ``/audit``, ``/find-publication``,
 *     ``/find-term``.
 *
 * Both are probed through Vite/Nginx proxy rules at ``/__health/gemma``
 * and ``/__health/agent`` (rewriting to ``/openapi.json`` on the
 * upstream, which every FastAPI app auto-exposes without an
 * agent-side change). HEAD would be cheaper but the proxied targets
 * may not implement it; a GET against ``/openapi.json`` is cheap
 * enough on the 5-30s polling cadence we use here.
 *
 * Used to:
 *   - render the HealthChip next to ModeChip in TopBar so curators
 *     can see at a glance whether a Run-proposal / Run-audit is even
 *     possible right now.
 *   - gate the unified AgentRunDialog's submit button — if the agent
 *     is down, the dialog explains and disables submit.
 */

import { useQuery } from "@tanstack/react-query";

export type ServiceStatus = "up" | "down" | "unknown";

export interface ServicesHealth {
  gemma: ServiceStatus;
  agent: ServiceStatus;
  /** ISO 8601 of the last probe attempt. */
  checkedAt: string | null;
}

async function probe(path: string, signal: AbortSignal): Promise<boolean> {
  try {
    const r = await fetch(path, {
      method: "GET",
      signal,
      // no Authorization header — /openapi.json is public on both
      // services (FastAPI default).
      cache: "no-store",
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Poll both backends on a 15s cadence. The interval is short enough
 *  that a curator who just brought a service up sees the green dot
 *  within a screen-glance, but long enough to not be noisy in
 *  devtools. */
export function useServicesHealth() {
  return useQuery<ServicesHealth>({
    queryKey: ["services-health"],
    queryFn: async ({ signal }) => {
      const [gemmaOk, agentOk] = await Promise.all([
        probe("/__health/gemma", signal),
        probe("/__health/agent", signal),
      ]);
      return {
        gemma: gemmaOk ? "up" : "down",
        agent: agentOk ? "up" : "down",
        checkedAt: new Date().toISOString(),
      };
    },
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    // Initial render before the first probe lands: don't claim
    // "down" — say "unknown" so the chip renders amber-grey instead
    // of red for the 50ms the first GET takes.
    placeholderData: {
      gemma: "unknown",
      agent: "unknown",
      checkedAt: null,
    },
    // Treat probe failures as data (state is "down"), not errors.
    retry: false,
  });
}
