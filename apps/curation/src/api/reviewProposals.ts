/**
 * React-query hooks for the **proposal-kind** CurationReview
 * endpoints. Pairs with the local-api refactor that split the shared
 * ``curation_review`` table into ``kind='audit'`` and
 * ``kind='proposal'`` rows.
 *
 * Wire shape is identical to audits (the same ``AuditReport`` /
 * forthcoming ``CurationReviewReport`` type); only the read filter
 * differs (kind=proposal vs kind=audit). Per-finding dispositions
 * and finalize routes are kind-agnostic, so this file imports those
 * mutations from ``audits.ts`` rather than duplicating them.
 *
 * Query keys live under ``["curation-reviews", "proposal", …]`` to
 * keep them distinct from:
 *   - ``["audits", …]`` (the audit-kind reviews — same table, other
 *     half), and
 *   - ``["proposals", …]`` (the **legacy** ``agent_proposal`` rows
 *     still served by the live proposer at
 *     ``/datasets/{id}/curation-proposals``).
 *
 * The legacy `proposals.ts` client stays in place during transition;
 * this file is for the new rich-review proposal flow only.
 */
import { useQueries, useQuery } from "@tanstack/react-query";
import { resolveGemmaMode } from "@/lib/gemmaMode";
import { api } from "./client";
import { annotationSetsToReviews } from "./annotationSetReviews";
import type { AuditReport } from "./auditTypes";

export interface ReviewProposalListResponse {
  items: AuditReport[];
  total: number;
}

const KEY = {
  byExperiment: (experimentId: number | string) =>
    ["curation-reviews", "proposal", "by-experiment", experimentId] as const,
};

async function get404AsEmpty(path: string): Promise<unknown> {
  try {
    return await api.get<unknown>(path);
  } catch (e: unknown) {
    if (
      e &&
      typeof e === "object" &&
      "status" in e &&
      (e as { status: number }).status === 404
    ) {
      return null;
    }
    throw e;
  }
}

/** Shared fetcher so the single- and multi-experiment hooks (and
 *  ``api/proposals.ts``'s ``useProposalsForExperiment``, which needs
 *  the exact same source-of-truth question answered) populate the
 *  same cache entries (mirrors ``fetchAuditsForExperiment``).
 *
 * 🛑 **Remote mode reads BOTH the local store AND Gemma — not
 * either/or.** The store exists so a curator can run a proposal and
 * review it before anything reaches Gemma (``GEMMA_RECORD_RESULTS``
 * unset / ``"store"`` — Amanda's deliberate setup, 2026-10-08: stay on
 * the remote UI for shared tickets, but proposals must NOT go straight
 * into Gemma without review). A build that instead read Gemma-only in
 * remote mode is what sent a fully-submitted, cached-and-correct
 * proposal into a sidebar reading "Nothing proposed yet" — the
 * proposal was real, it just lived somewhere this query never looked.
 * The ORIGINAL reason remote mode read Gemma at all is real too (cab,
 * 2026-09-03, GSE6966): some setups run ``GEMMA_RECORD_RESULTS=gemma``/
 * ``both`` and write proposals straight into Gemma's own annotation-
 * sets, which the local store never sees either. Neither source is
 * reliably empty, so this merges both rather than picking one — a
 * proposal is findable regardless of which path a given deployment's
 * agent actually submits through.
 */
export async function fetchProposalReviewsForExperiment(
  experimentId: number | string,
): Promise<ReviewProposalListResponse> {
  const storeRaw = await get404AsEmpty(
    `/curation/v1/datasets/${experimentId}/proposals`,
  );
  const storeItems = (storeRaw as ReviewProposalListResponse | null)?.items ?? [];

  const remote = resolveGemmaMode().mode === "remote";
  if (!remote) {
    return { items: storeItems, total: storeItems.length };
  }

  const gemmaRaw = await get404AsEmpty(
    `/rest/v2/datasets/${experimentId}/annotation-sets?role=proposal&shape=full`,
  );
  const gemmaItems = gemmaRaw
    ? annotationSetsToReviews(gemmaRaw, "proposal").items
    : [];

  // Different id spaces (store UUIDs vs Gemma annotation-set numeric
  // ids) — no cross-source collision to dedupe, just order newest
  // first across both.
  const items = [...storeItems, ...gemmaItems].sort((a, b) =>
    (b.audited_at ?? "").localeCompare(a.audited_at ?? ""),
  );
  return { items, total: items.length };
}

/** Per-experiment list of proposal-kind CurationReviews, most recent
 *  first. Feeds the Proposal sidebar panel. Same 404-fallback as
 *  ``useAuditsForExperiment`` — production Gemma 2.0 doesn't yet
 *  serve this endpoint, so a 404 means "no proposals" rather than
 *  an error to surface. */
export function useProposalReviewsForExperiment(
  experimentId: number | string,
  options: { enabled?: boolean } = {},
) {
  const enabled = (options.enabled ?? true) && Boolean(experimentId);
  return useQuery({
    queryKey: KEY.byExperiment(experimentId),
    queryFn: () => fetchProposalReviewsForExperiment(experimentId),
    enabled,
    refetchOnWindowFocus: true,
  });
}

/** Proposal-review lists for MANY experiments — the ticket queue's
 *  disposition filter reads BOTH review kinds, because a ticket's
 *  findings live as ``kind='proposal'`` rows for review tickets and
 *  ``kind='audit'`` rows for audit tickets, and the queue can't know
 *  which up front. Same cache keys as the single-experiment hook;
 *  same gating rationale as ``useAuditsForExperiments``. */
export function useProposalReviewsForExperiments(
  experimentIds: Array<number | string>,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  return useQueries({
    queries: experimentIds.map((id) => ({
      queryKey: KEY.byExperiment(id),
      queryFn: () => fetchProposalReviewsForExperiment(id),
      enabled: enabled && Boolean(id),
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    })),
  });
}

/** Re-export the query-key namespace so callers (e.g. the panel's
 *  optimistic-cache update) can derive matching keys without
 *  hard-coding the tuple. */
export const REVIEW_PROPOSAL_KEYS = KEY;
