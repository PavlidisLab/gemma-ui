import { useQueries } from "@tanstack/react-query";

import { api, ApiError } from "./client";
import { ticketsBase } from "./tickets";

/**
 * Corpus-wide curation counts for the dashboard's "Under curation"
 * panel — how much work is outstanding, by kind.
 *
 * 🛑 **This is NOT "who is holding a lock right now", and it must not
 * be read as that.** That question needs an inverse lock query nobody
 * has built: `GET /datasets/curation/locks` takes a `datasets` list and
 * answers per-id, and calling it with no ids returns `{}` — which means
 * "I checked nothing", not "the corpus is quiet". Building a panel on
 * that empty object would render a confident, wrong all-clear, which is
 * the one failure the panel's earlier placeholder existed to avoid.
 *
 * What IS answerable, measured on gemma2 `41f45962c5` and all under
 * 100 ms:
 *
 *     /datasets/count?filter=curationDetails.needsAttention = true   211
 *     /datasets/count?filter=troubled = true                           4
 *     /tickets/summary   { totalOpen, scratchpadOpen, byType }
 *
 * Counts and statuses, which is what the panel was asked for — the list
 * of experiments already has its own link on the page, so this does not
 * try to be a list.
 */

/** One countable curation status.
 *
 *  🛑 The filter strings are Gemma's property paths and are checked
 *  against the live API, not guessed: `curationNote.troubled` is a 400
 *  ("the entity cannot be filtered by"), while `troubled` and
 *  `curationDetails.troubled` both work and agree. Anything added here
 *  must be probed the same way — an unknown property is a 400, so a
 *  typo fails loudly, but a property that exists and means something
 *  else fails silently.
 *
 *  🛑 **Every filter here names `curationDetails.troubled`, and that is
 *  deliberate.** `AbstractCuratableDao.shouldHideTroubled` is
 *  `!isUserAdmin() && !mentionsTroubled(filters)`, and `mentionsTroubled`
 *  matches that full property path — so a session without `GROUP_ADMIN`
 *  gets `curationDetails.troubled = false` ANDed onto any count that
 *  does not name it. A "Troubled" row that reads 0 while four exist is
 *  the worst answer this panel can give, and the panel exists because
 *  its predecessor gave a confident wrong all-clear.
 *
 *  🛑 **The bare spelling `troubled` does NOT satisfy the check** —
 *  read from `AbstractCuratableDao` by gembro, 2026-09-01. It resolves
 *  to the joined `CurationDetails` alias (`s.troubled`), while the
 *  hiding clause is added at the object alias
 *  (`ee.curationDetails.troubled`), and `mentionsTroubled` compares the
 *  pair. So for a non-admin `filter=troubled = true` became
 *  `s.troubled = true and ee.curationDetails.troubled = false` — the
 *  same single-valued association reached two ways, a contradiction:
 *  **0 rows against 4.** This row was showing that. The OpenAPI
 *  metadata describes the short form as "alias for
 *  curationDetails.troubled", so the two look interchangeable from
 *  outside and are, for every purpose except this one.
 *
 *  Counts are unchanged on an admin session, where the hiding never
 *  engages: needsAttention 211 either way, troubled 4 either spelling,
 *  isPublic 2145 either way (gemma2 `16dfb28512ce`). */
export interface CurationStatusCount {
  key: string;
  label: string;
  /** What the number means, for the tooltip. */
  hint: string;
  filter: string;
}

export const CURATION_STATUS_COUNTS: CurationStatusCount[] = [
  {
    key: "needsAttention",
    label: "Needs attention",
    hint: "A curator flagged this dataset as needing another look.",
    filter:
      "curationDetails.needsAttention = true and curationDetails.troubled in (true, false)",
  },
  {
    key: "troubled",
    label: "Troubled",
    hint: "Flagged as having a data problem that blocks use.",
    filter: "curationDetails.troubled = true",
  },
  {
    key: "private",
    label: "Not yet public",
    hint: "Held back from the public site — still in curation, or deliberately private.",
    filter: "isPublic = false and curationDetails.troubled in (true, false)",
  },
];

/** `/tickets/summary`, post-`snakeify`. */
export interface TicketSummary {
  total_open?: number | null;
  /** Broken out by the server rather than hidden inside `total_open` —
   *  a scratchpad is never "done", so counting it as outstanding work
   *  would make every curator permanently behind. Shown separately for
   *  the same reason. */
  scratchpad_open?: number | null;
  by_type?: Record<string, number> | null;
}

async function countWith(filter: string): Promise<number | null> {
  try {
    const n = await api.get<number>(
      `/rest/v2/datasets/count?filter=${encodeURIComponent(filter)}`,
    );
    return typeof n === "number" ? n : null;
  } catch (e) {
    // Local mode serves no such route, and a 400 means the filter
    // property is wrong. Both yield "cannot say" — never zero.
    if (e instanceof ApiError) return null;
    throw e;
  }
}

/**
 * The counts, each independently resolvable.
 *
 * 🛑 **`null` is "could not ask", and zero is "asked, and none".** They
 * render differently on purpose: a dash for the first, a real 0 for the
 * second. Collapsing them is how a panel tells a curator the corpus is
 * clean when it has simply failed to look.
 */
export function useCurationCounts() {
  const results = useQueries({
    queries: [
      ...CURATION_STATUS_COUNTS.map((s) => ({
        queryKey: ["curation-count", s.key] as const,
        queryFn: () => countWith(s.filter),
        staleTime: 5 * 60_000,
        retry: false,
      })),
      {
        queryKey: ["tickets", "summary"] as const,
        queryFn: async (): Promise<TicketSummary | null> => {
          try {
            return await api.get<TicketSummary>(`${ticketsBase()}/tickets/summary`);
          } catch (e) {
            if (e instanceof ApiError) return null;
            throw e;
          }
        },
        staleTime: 5 * 60_000,
        retry: false,
      },
    ],
  });

  const statusResults = results.slice(0, CURATION_STATUS_COUNTS.length);
  const summaryResult = results[results.length - 1];

  return {
    statuses: CURATION_STATUS_COUNTS.map((s, i) => ({
      ...s,
      count: (statusResults[i]?.data ?? null) as number | null,
    })),
    summary: (summaryResult?.data ?? null) as TicketSummary | null,
    isLoading: results.some((r) => r.isLoading),
  };
}
