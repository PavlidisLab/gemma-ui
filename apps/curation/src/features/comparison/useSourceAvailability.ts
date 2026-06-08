import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import {
  isPolishedSource,
  polishedCuratorOf,
  polishedSourceFor,
  SYSTEM_SOURCES,
  type Source,
} from "./sources";

/** One row returned by the unified /curation-versions endpoint
 *  (agents-repo `local_api/curation_versions.py`, Phase 1 of the
 *  2026-06-08 unified-curation-versions reframe). The chip strip's
 *  source-availability discovery prefers this endpoint and falls
 *  back to the three legacy probes only if the call fails. */
interface CurationVersionRow {
  version_id: string;
  kind: string;
  producer: string;
  label: string;
  description?: string;
  created_at?: string | null;
}

interface CurationVersionListResponse {
  items: CurationVersionRow[];
  total: number;
}

/** Fetch the unified curation-versions list for an experiment.
 *  Returns ``null`` on 404 (endpoint not yet deployed on this
 *  local_api / Gemma instance) so callers can route to the legacy
 *  probe fallback path without a hard error. */
function useCurationVersions(experimentId: number | string) {
  return useQuery({
    enabled: Boolean(experimentId),
    queryKey: ["curation-versions", experimentId] as const,
    staleTime: 30_000,
    queryFn: async (): Promise<CurationVersionListResponse | null> => {
      try {
        const raw = await api.get<CurationVersionListResponse>(
          `/rest/v2/datasets/${experimentId}/curation-versions`,
        );
        return raw;
      } catch (e: unknown) {
        if (
          e &&
          typeof e === "object" &&
          "status" in e &&
          (e as { status: number }).status === 404
        ) {
          // Endpoint not deployed on this local_api / Gemma instance.
          // Caller falls back to the three legacy probes.
          return null;
        }
        throw e;
      }
    },
  });
}

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

/** The dynamic enumeration of sources that exist for one experiment:
 *  system sources (empty / preboard / agent_proposal) plus one
 *  polished:<curator> entry for each curator who has a loaded
 *  polished pack. Order: system sources first, then polished sources
 *  in the order returned by the backend. */
export interface SourceUniverse {
  /** All sources to render in the chip dropdown — even if currently
   *  unavailable for this experiment (e.g. probe still loading). */
  sources: readonly Source[];
  availability: AvailabilityMap;
  isLoading: boolean;
}

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

/** List the curators with a polished design on file for this
 *  experiment. Each returned username spawns one ``polished:<name>``
 *  source in the chip dropdown. Lowercase / canonical usernames per
 *  storage normalisation; the labelling step Title-Cases them. */
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

/** Report availability of every source that applies to one
 *  experiment. ``empty`` is always available (sentinel); preboard
 *  and agent_proposal probe their respective endpoints; polished
 *  sources are listed one per curator returned by the
 *  ``/polished`` endpoint. */
export function useSourceUniverse(
  experimentId: number | string,
): SourceUniverse {
  // Phase 2 of the 2026-06-08 unified-curation-versions reframe:
  // /curation-versions is now the source of truth for what versions
  // exist for an experiment, regardless of backend. We still issue
  // the three legacy probes so a local_api / Gemma instance that
  // hasn't deployed /curation-versions yet (or returns 404) falls
  // through to the prior behaviour. Once every consuming instance
  // has the unified endpoint, the legacy probes can come out (and
  // the polished-curator enumeration will come straight from the
  // version list's curator_polish rows).
  const versions = useCurationVersions(experimentId);
  const preboard = usePreboardAvailable(experimentId);
  const agent = useAgentProposalAvailable(experimentId);
  const polished = usePolishedCurators(experimentId);

  // Derive availability from the unified endpoint when it returns
  // data. ``versions.data === null`` means the endpoint 404'd
  // (instance hasn't been upgraded); fall back to legacy probes.
  const unified = versions.data;
  const usingUnified = unified != null;

  // Polished-curator enumeration: prefer the unified endpoint's
  // curator_polish rows when available. Falls back to the dedicated
  // /polished probe otherwise.
  const polishedCurators: string[] = usingUnified
    ? unified.items
        .filter((v) => v.kind === "curator_polish")
        .map((v) => v.producer)
    : (polished.data ?? []);

  // The dynamic enumeration. System sources first (stable order:
  // empty → preboard → agent_proposal), then polished:<curator> in
  // the order returned by the backend.
  const sources: Source[] = [
    ...SYSTEM_SOURCES,
    ...polishedCurators.map((c) => polishedSourceFor(c)),
  ];

  // ``isLoading`` covers whichever probes are actually feeding
  // availability. With the unified endpoint up, the three legacy
  // probes still complete in the background (cheap, cached), but
  // they don't gate render — only the unified call does.
  const isLoading = usingUnified
    ? versions.isLoading
    : preboard.isLoading || agent.isLoading || polished.isLoading;

  // Helper: is a kind present in the unified list? Used to decide
  // availability of preboard / agent_proposal under unified mode.
  const unifiedHas = (kind: string): boolean =>
    !!unified?.items.some((v) => v.kind === kind);

  const availability = {} as AvailabilityMap;
  for (const s of sources) {
    if (s === "empty") {
      availability[s] = { available: true, reason: "", comingSoon: false };
    } else if (s === "preboard") {
      const available = usingUnified
        ? unifiedHas("preboard")
        : !!preboard.data;
      availability[s] = available
        ? { available: true, reason: "", comingSoon: false }
        : {
            available: false,
            reason: versions.isLoading || preboard.isLoading
              ? "checking…"
              : "no preboard snapshot stored for this experiment",
            comingSoon: false,
          };
    } else if (s === "live") {
      // ``live`` is unified-only — there's no legacy probe. When the
      // unified endpoint hasn't been deployed, treat live as
      // unavailable so the chip strip falls through to other
      // sources rather than rendering a broken option.
      const available = usingUnified && unifiedHas("live");
      availability[s] = available
        ? { available: true, reason: "", comingSoon: false }
        : {
            available: false,
            reason: versions.isLoading
              ? "checking…"
              : "no live curation state available for this experiment",
            comingSoon: false,
          };
    } else if (s === "agent_proposal") {
      // Unified mode: present iff ANY agent_proposal row exists. The
      // chip dropdown today picks "the latest" implicitly via the
      // legacy /proposals fetch path; once the chip strip surfaces
      // each version separately (Phase 3 — give the curator a list
      // of agent runs to choose from), this collapses to one row per
      // version_id.
      const available = usingUnified
        ? unifiedHas("agent_proposal")
        : !!agent.data;
      availability[s] = available
        ? { available: true, reason: "", comingSoon: false }
        : {
            available: false,
            reason: versions.isLoading || agent.isLoading
              ? "checking…"
              : "no agent proposal found for this experiment",
            comingSoon: false,
          };
    } else if (isPolishedSource(s)) {
      // Polished sources are only enumerated for curators the
      // backend returned, so they're available by construction.
      availability[s] = { available: true, reason: "", comingSoon: false };
    } else {
      availability[s] = {
        available: false,
        reason: "unknown source",
        comingSoon: false,
      };
    }
  }
  return { sources, availability, isLoading };
}

/** Convenience wrapper for callers that only care about the
 *  availability map (legacy API). Prefer ``useSourceUniverse`` for
 *  new code so the dynamic ``sources`` list is reachable. */
export function useSourceAvailability(
  experimentId: number | string,
): AvailabilityMap {
  return useSourceUniverse(experimentId).availability;
}

/** Convenience: just the curator usernames with a polished pack for
 *  this experiment, in backend-returned order. Useful for callers
 *  that need to pick a default (e.g. ``defaultSlots(..., {
 *  polishedCurators })``). */
export function usePolishedCuratorList(
  experimentId: number | string,
): string[] {
  const universe = useSourceUniverse(experimentId);
  return universe.sources
    .filter(isPolishedSource)
    .map(polishedCuratorOf);
}
