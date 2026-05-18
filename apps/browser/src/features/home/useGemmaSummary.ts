/**
 * Aggregate counts for the home-page summary panel.
 *
 * What we have today:
 *   - Total datasets   — `totalElements` from /rest/v2/datasets?limit=1
 *   - Total platforms  — `totalElements` from /rest/v2/platforms?limit=1
 *
 * What we'd like but don't have a REST endpoint for (Paul, 2026-05-17):
 *   The "Summary and updates this week" panel on the legacy site
 *   (per-taxon dataset totals, samples total, and "updated"/"new"
 *   deltas over the last seven days) is served by a **DWR** call
 *   on the old ExtJS frontend — Java backend, no JSON wrapper, not
 *   reachable from a REST client. To bring it back on the new UI
 *   we need a REST endpoint (e.g. `/rest/v2/summary` or a parametric
 *   `/rest/v2/datasets/counts?since=…&groupBy=taxon`) that returns:
 *     - dataset count (overall + per top taxon: Human, Mouse, Rat)
 *     - platform count
 *     - sample / bioassay count
 *     - "updated in last N days" count per row
 *     - "new in last N days" count per row
 *
 *   Ask is on the Gemma Java REST team (eclipseworkspace/Gemma);
 *   filed as a TODO here so it doesn't get lost. Until the endpoint
 *   ships, the UI renders the unavailable rows as "—" and continues
 *   to populate datasets / platforms from the count-via-`limit=1`
 *   trick below.
 *
 * If a samples-total endpoint lands separately, wire it where the
 * `samples: null` line is and the variants pick it up automatically.
 */

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/api/client";

interface Aggregate {
  totalElements?: number;
}

function useTotal(path: string, key: string) {
  return useQuery({
    queryKey: ["summary", key],
    queryFn: async ({ signal }) => {
      try {
        const r = await apiGet<Aggregate>(`${path}?limit=1`, { signal });
        return r;
      } catch (e) {
        // Surface to console so curators can see network/auth issues
        // without us needing dev-only UI chrome. The variants below
        // also render an "error" state via the returned ``isError``.
        console.error(`[gemma summary] ${path} failed:`, e);
        throw e;
      }
    },
    staleTime: 5 * 60_000,
  });
}

export interface GemmaSummary {
  datasets: number | null;
  platforms: number | null;
  /** Sample / bioassay total — no single-call endpoint today; null
   *  until the backend exposes one or we wire a sum-of-bioassays
   *  aggregate. */
  samples: number | null;
  /** Counts per taxon — not wired yet; placeholder so the UI can
   *  render the rows with "—" today and gain real data later. */
  byTaxon: Array<{ name: string; total: number | null; updated?: number | null; new?: number | null }>;
  /** Top-line "this week" deltas — not wired yet. */
  updatedThisWeek: number | null;
  newThisWeek: number | null;
  isLoading: boolean;
  isError: boolean;
}

export function useGemmaSummary(): GemmaSummary {
  const datasets = useTotal("/rest/v2/datasets", "datasets");
  const platforms = useTotal("/rest/v2/platforms", "platforms");
  return {
    datasets: datasets.data?.totalElements ?? null,
    platforms: platforms.data?.totalElements ?? null,
    samples: null,
    byTaxon: [
      { name: "Human", total: null },
      { name: "Mouse", total: null },
      { name: "Rat", total: null },
    ],
    updatedThisWeek: null,
    newThisWeek: null,
    isLoading: datasets.isLoading || platforms.isLoading,
    isError: datasets.isError || platforms.isError,
  };
}

/** Format a count for compact display ("23,549" or "23K" / "23.5K").
 *  Use ``compact`` for hero stats; default (full) for the table.
 *  ``null`` renders as "—" (unsupported / not-yet-wired). Pass
 *  ``loading: true`` to render "…" while the underlying query is
 *  pending so the curator sees activity vs. a true zero/missing. */
export function fmtCount(
  n: number | null,
  mode: "full" | "compact" = "full",
  loading = false,
): string {
  if (n === null) return loading ? "…" : "—";
  if (mode === "compact") {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
    return n.toLocaleString();
  }
  return n.toLocaleString();
}
