/**
 * Liveness probes for the three backends the curation UI depends on:
 *
 *   - **local_api** — the curation DB / FastAPI mock. Default upstream
 *     for `/rest/v2/...` calls (dataset metadata, workflow management,
 *     curation state, audit-trail fallback when gemma-rest 404s).
 *   - **gemma-rest** — the live Gemma 2.0 REST. Fallback for endpoints
 *     local_api doesn't carry (SVD-based diagnostics) and the
 *     canonical source for the experiment audit trail when the id is
 *     loaded into Gemma.
 *   - **Agent service** (proposer / auditor / find-* FastAPI) — backs
 *     `/propose`, `/audit`, `/find-publication`, `/find-term`.
 *
 * All three are probed through Vite/Nginx proxy rules at
 * ``/__health/{local-api,gemma,agent}`` (rewriting to ``/openapi.json``
 * on local_api + agent and ``/rest/v2/openapi.json`` on gemma-rest —
 * the spec is versioned there). A GET against the openapi route is
 * cheap on the 15s polling cadence we use.
 *
 * Used to:
 *   - render the HealthChip cluster next to ModeChip in TopBar so
 *     curators can see at a glance which backends are reachable.
 *   - gate the unified AgentRunDialog's submit button — if the agent
 *     is down, the dialog explains and disables submit.
 */

import { useQuery } from "@tanstack/react-query";

export type ServiceStatus = "up" | "down" | "unknown";

export interface ServicesHealth {
  /** local_api — the curation DB / FastAPI mock. */
  localApi: ServiceStatus;
  /** gemma-rest 2.0 — the live Gemma REST. */
  gemma: ServiceStatus;
  /** Proposer / auditor agent service. */
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
      const [localApiOk, gemmaOk, agentOk] = await Promise.all([
        probe("/__health/local-api", signal),
        probe("/__health/gemma", signal),
        probe("/__health/agent", signal),
      ]);
      return {
        localApi: localApiOk ? "up" : "down",
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
      localApi: "unknown",
      gemma: "unknown",
      agent: "unknown",
      checkedAt: null,
    },
    // Treat probe failures as data (state is "down"), not errors.
    retry: false,
  });
}
