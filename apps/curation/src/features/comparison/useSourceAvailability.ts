import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { ALL_SOURCES, type Source } from "./sources";

/** Per-source availability report. ``available`` is the only signal
 *  the chip menu needs to grey an entry; ``reason`` provides the
 *  tooltip explanation when it's disabled. */
export interface SourceAvailability {
  available: boolean;
  /** Tooltip text shown when ``available === false``. Empty string
   *  when the source is available. */
  reason: string;
  /** ``true`` when unavailability is "backend not yet built" rather
   *  than "no data for this experiment" — drives a different UI
   *  affordance (italic + "(coming soon)" suffix in the menu). */
  comingSoon: boolean;
}

export type AvailabilityMap = Record<Source, SourceAvailability>;

/** Probe for a stored preboard snapshot. 404 ⇒ not available. */
function usePreboardAvailable(experimentId: number | string) {
  return useQuery({
    enabled: Boolean(experimentId),
    queryKey: ["preboard-available", experimentId] as const,
    // The endpoint either returns the full Design or 404s; we only
    // need the bit. ``HEAD`` would be lighter but FastAPI's auto-GET
    // route doesn't expose one — a cached GET is fine.
    staleTime: Infinity,
    queryFn: async (): Promise<boolean> => {
      try {
        await api.get<unknown>(
          `/rest/v2/datasets/${experimentId}/design/snapshot`,
        );
        return true;
      } catch (e: unknown) {
        if (
          e &&
          typeof e === "object" &&
          "status" in e &&
          (e as { status: number }).status === 404
        ) {
          return false;
        }
        throw e;
      }
    },
  });
}

/** List which curators have a polished design on file for this
 *  experiment. Used to grey/light the ``Cy polished`` / ``Am polished``
 *  chip entries. Lowercase curator keys (``cy``, ``am``) per
 *  storage normalisation. */
function usePolishedCurators(experimentId: number | string) {
  return useQuery({
    enabled: Boolean(experimentId),
    queryKey: ["polished-curators", experimentId] as const,
    staleTime: 30_000,
    queryFn: async (): Promise<string[]> => {
      try {
        const raw = await api.get<string[] | { items?: string[] }>(
          `/rest/v2/datasets/${experimentId}/polished`,
        );
        if (Array.isArray(raw)) return raw;
        return raw?.items ?? [];
      } catch (e: unknown) {
        if (
          e &&
          typeof e === "object" &&
          "status" in e &&
          (e as { status: number }).status === 404
        ) {
          return [];
        }
        throw e;
      }
    },
  });
}

/** Probe for an agent original proposal. Reuses the existing
 *  ``curation-proposals?kind=proposal`` endpoint; any non-empty
 *  payload means the source is available. */
function useAgentProposalAvailable(experimentId: number | string) {
  return useQuery({
    enabled: Boolean(experimentId),
    queryKey: ["agent-proposal-available", experimentId] as const,
    staleTime: Infinity,
    queryFn: async (): Promise<boolean> => {
      try {
        const raw = await api.get<unknown>(
          `/rest/v2/datasets/${experimentId}/curation-proposals?kind=proposal&limit=1`,
        );
        if (Array.isArray(raw)) return raw.length > 0;
        if (
          raw &&
          typeof raw === "object" &&
          "items" in raw &&
          Array.isArray((raw as { items: unknown[] }).items)
        ) {
          return (raw as { items: unknown[] }).items.length > 0;
        }
        return false;
      } catch (e: unknown) {
        if (
          e &&
          typeof e === "object" &&
          "status" in e &&
          (e as { status: number }).status === 404
        ) {
          return false;
        }
        throw e;
      }
    },
  });
}

/** Report availability of all 5 sources for one experiment. ``empty``
 *  is always available (it's the absence-of-data sentinel); preboard
 *  and agent_proposal probe their respective endpoints; polished
 *  sources are gated on a backend ingest path that hasn't landed yet
 *  (spec Gotcha #1) — surface as ``comingSoon`` for now. */
export function useSourceAvailability(
  experimentId: number | string,
): AvailabilityMap {
  const preboard = usePreboardAvailable(experimentId);
  const agent = useAgentProposalAvailable(experimentId);
  const polished = usePolishedCurators(experimentId);

  // Curator keys → chip sources. ``cy`` ⇒ ``cy_polished`` etc.
  const polishedSet = new Set(polished.data ?? []);
  const cyHas = polishedSet.has("cy") || polishedSet.has("cyan");
  const amHas = polishedSet.has("am") || polishedSet.has("amanda");

  // Defaults to ``available: false`` while a probe is in flight so
  // the chip menu shows the entry as disabled — flickering between
  // available / disabled is worse than waiting for the first hit.
  const map: AvailabilityMap = {
    empty: { available: true, reason: "", comingSoon: false },
    preboard: preboard.data
      ? { available: true, reason: "", comingSoon: false }
      : {
          available: false,
          reason: preboard.isLoading
            ? "checking…"
            : "no preboard snapshot stored for this experiment",
          comingSoon: false,
        },
    cy_polished: cyHas
      ? { available: true, reason: "", comingSoon: false }
      : {
          available: false,
          reason: polished.isLoading
            ? "checking…"
            : "no Cy polished design ingested for this experiment",
          comingSoon: false,
        },
    am_polished: amHas
      ? { available: true, reason: "", comingSoon: false }
      : {
          available: false,
          reason: polished.isLoading
            ? "checking…"
            : "amanda's polished design not yet ingested",
          comingSoon: false,
        },
    agent_proposal: agent.data
      ? { available: true, reason: "", comingSoon: false }
      : {
          available: false,
          reason: agent.isLoading
            ? "checking…"
            : "no agent proposal found for this experiment",
          comingSoon: false,
        },
  };

  // Defensive: make sure every Source key is populated.
  for (const s of ALL_SOURCES) {
    if (!(s in map)) {
      map[s] = {
        available: false,
        reason: "unknown source",
        comingSoon: false,
      };
    }
  }
  return map;
}
