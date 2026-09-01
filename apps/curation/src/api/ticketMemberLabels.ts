import { useQuery } from "@tanstack/react-query";

import { api, ApiError } from "./client";

/**
 * Accession + title for a ticket's members.
 *
 * 🛑 **Gemma sends `displayLabel` and `displayName` as NULL on every
 * ticket target.** The fields are on the wire — measured on ticket 6,
 * all 500 rows — so the popover rendered "31491 (no title)" fifty times
 * over and its filter box had nothing to filter on. That is a backend
 * gap, not a render bug; asked of gembro. This resolves the ids itself
 * so the list is readable meanwhile, and costs nothing once the labels
 * arrive — a populated `displayLabel` wins and this never renders.
 *
 * 🛑 **`limit` caps at 100** (101 is a 400, not a clamp), so a
 * 500-member ticket is five requests. They are cached under the id list
 * and only fire when the popover opens, which is the one place that
 * needs them — the walker's "298/500" and its prev/next never did.
 */

export interface MemberLabel {
  short_name?: string | null;
  name?: string | null;
}

const PAGE = 100;
/** 2,000 members. Far past any real ticket; a guard against a runaway
 *  loop if `total_elements` ever disagrees with what comes back. */
const MAX_PAGES = 20;

export function useTicketMemberLabels(ids: number[], enabled = true) {
  // Sorted so two orderings of the same membership share a cache entry.
  const key = [...ids].sort((a, b) => a - b).join(",");
  return useQuery<Record<number, MemberLabel>>({
    queryKey: ["ticket-member-labels", key],
    enabled: enabled && ids.length > 0,
    queryFn: async () => {
      const out: Record<number, MemberLabel> = {};
      for (let page = 0; page < MAX_PAGES; page++) {
        const params = new URLSearchParams({
          limit: String(PAGE),
          offset: String(page * PAGE),
        });
        let rows: Array<{ id: number } & MemberLabel> = [];
        try {
          const r = await api.get<Array<{ id: number } & MemberLabel> | null>(
            `/rest/v2/datasets/${encodeURIComponent(key)}?${params.toString()}`,
          );
          rows = Array.isArray(r) ? r : [];
        } catch (e) {
          // A label is an ornament. Losing it must never take the
          // navigator down — the ids still walk.
          if (e instanceof ApiError) break;
          throw e;
        }
        for (const row of rows) {
          out[row.id] = { short_name: row.short_name, name: row.name };
        }
        if (rows.length < PAGE) break;
      }
      return out;
    },
    staleTime: 30 * 60_000,
    retry: false,
  });
}
