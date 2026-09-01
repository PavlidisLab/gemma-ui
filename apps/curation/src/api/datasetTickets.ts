import { useQuery } from "@tanstack/react-query";

import { api, ApiError } from "./client";
import type { TicketSearchHit } from "./tickets";

/**
 * Which tickets hold each of these datasets —
 * `POST /rest/v2/datasets/tickets` (gembro `16dfb28512ce`).
 *
 * 🛑 **Keyed on PRESENCE.** Only datasets that are on a ticket get a
 * key, so a page of fifty quiet rows is not sent fifty empty arrays —
 * the same contract as `POST /datasets/curation/locks/query`. An absent
 * id means "on no ticket", which is a real answer here, unlike the
 * locks route's `{}` for an empty request.
 *
 * Before this existed the experiment list could only mark a ticket it
 * already held, so the `#` glyph was 100%-on inside a ticket queue and
 * absent everywhere else. Rows carry ticket SUMMARIES, not targets —
 * `targetCount` comes from a scalar count, so fifty rows never hydrate
 * a 500-member ticket.
 */
export function useDatasetTickets(
  datasetIds: number[],
  enabled = true,
) {
  // Sorted so two orderings of one page share a cache entry.
  const key = [...new Set(datasetIds)].sort((a, b) => a - b);
  return useQuery<Record<number, TicketSearchHit[]>>({
    queryKey: ["datasets", "tickets", key.join(",")],
    enabled: enabled && key.length > 0,
    queryFn: async () => {
      try {
        const r = await api.post<Record<string, TicketSearchHit[]>>(
          "/rest/v2/datasets/tickets",
          { datasetIds: key },
        );
        const out: Record<number, TicketSearchHit[]> = {};
        for (const [id, rows] of Object.entries(r ?? {})) {
          if (Array.isArray(rows) && rows.length > 0) out[Number(id)] = rows;
        }
        return out;
      } catch (e) {
        // Local mode serves no such route. An empty map means "no ticket
        // known", and the glyph is only ever shown, never negated — so
        // a failure here hides a mark rather than inventing one.
        if (e instanceof ApiError) return {};
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}
